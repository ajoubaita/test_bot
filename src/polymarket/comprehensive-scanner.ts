import { logger } from '../utils/logger';
import { OrderBook } from '../types';
import { MarketWithVolume } from './market-scanner';

/**
 * Comprehensive scanner that periodically fetches order books for ALL markets
 * This ensures no markets are omitted from arbitrage analysis
 */
export class ComprehensiveScanner {
  private apiUrl = 'https://clob.polymarket.com';
  private scanIntervalMs: number;
  private isScanning = false;
  private scanTimer?: NodeJS.Timeout;

  constructor(scanIntervalMs: number = 30000) { // Default: scan every 30 seconds
    this.scanIntervalMs = scanIntervalMs;
  }

  /**
   * Start periodic comprehensive scanning of all markets
   */
  startScanning(
    markets: MarketWithVolume[],
    onOrderBook: (orderBook: OrderBook) => void
  ): void {
    if (this.isScanning) {
      logger.warn('Comprehensive scanner already running');
      return;
    }

    this.isScanning = true;
    logger.info('Starting comprehensive market scanner', {
      markets: markets.length,
      scanInterval: `${this.scanIntervalMs / 1000}s`,
    });

    // Scan immediately
    this.scanAllMarkets(markets, onOrderBook);

    // Then scan periodically
    this.scanTimer = setInterval(() => {
      this.scanAllMarkets(markets, onOrderBook);
    }, this.scanIntervalMs);
  }

  /**
   * Stop the comprehensive scanner
   */
  stopScanning(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = undefined;
    }
    this.isScanning = false;
    logger.info('Comprehensive scanner stopped');
  }

  /**
   * Fetch order books for all markets in batches
   */
  private async scanAllMarkets(
    markets: MarketWithVolume[],
    onOrderBook: (orderBook: OrderBook) => void
  ): Promise<void> {
    const startTime = Date.now();
    logger.info(`📊 COMPREHENSIVE SCAN: Fetching order books for ${markets.length} markets...`);

    let successCount = 0;
    let errorCount = 0;

    // Process markets in batches to avoid overwhelming the API
    const batchSize = 10;
    const batches: MarketWithVolume[][] = [];

    for (let i = 0; i < markets.length; i += batchSize) {
      batches.push(markets.slice(i, i + batchSize));
    }

    // Process batches sequentially (to be nice to the API)
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      // Fetch all order books in this batch in parallel
      const promises = batch.map(market =>
        this.fetchMarketOrderBooks(market)
      );

      const results = await Promise.allSettled(promises);

      // Process results
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          // Emit order books for each token in the market
          for (const orderBook of result.value) {
            onOrderBook(orderBook);
            successCount++;
          }
        } else {
          errorCount++;
        }
      }

      // Small delay between batches
      if (i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`✅ COMPREHENSIVE SCAN: Completed in ${duration}ms`, {
      success: successCount,
      errors: errorCount,
      marketsScanned: markets.length,
    });
  }

  /**
   * Fetch order books for all tokens in a market
   */
  private async fetchMarketOrderBooks(
    market: MarketWithVolume
  ): Promise<OrderBook[]> {
    try {
      // Get token IDs for this market
      const tokens = market.outcomeTokens || [];
      let tokensFetched = false;

      if (tokens.length === 0) {
        // Try to fetch from API if not available
        try {
          const response = await fetch(`https://gamma-api.polymarket.com/markets/${market.id}`);
          if (response.ok) {
            const data: any = await response.json();

            // Parse clobTokenIds from JSON string
            let fetchedTokens: string[] = [];
            if (data.clobTokenIds) {
              try {
                fetchedTokens = typeof data.clobTokenIds === 'string'
                  ? JSON.parse(data.clobTokenIds)
                  : data.clobTokenIds;
              } catch (e) {
                fetchedTokens = data.tokens || [];
              }
            } else {
              fetchedTokens = data.tokens || [];
            }

            tokens.push(...fetchedTokens);
            tokensFetched = true;
          }
        } catch (err) {
          // Silently continue on errors
        }
      }

      if (tokens.length === 0) {
        return [];
      }

      // Fetch order book for each token
      const orderBooks: OrderBook[] = [];

      for (const tokenId of tokens) {
        try {
          const response = await fetch(`${this.apiUrl}/book?token_id=${tokenId}`);

          if (!response.ok) {
            // Silently skip failed fetches (likely rate limited)
            continue;
          }

          const data: any = await response.json();

          const orderBook: OrderBook = {
            marketId: tokenId,
            bids: (data.bids || []).map((b: any) => ({
              price: parseFloat(b.price),
              size: parseFloat(b.size),
            })),
            asks: (data.asks || []).map((a: any) => ({
              price: parseFloat(a.price),
              size: parseFloat(a.size),
            })),
            timestamp: Date.now(),
          };

          orderBooks.push(orderBook);
        } catch (error) {
          // Silently continue on errors
          continue;
        }
      }

      return orderBooks;
    } catch (error) {
      // Silently handle errors
      return [];
    }
  }
}
