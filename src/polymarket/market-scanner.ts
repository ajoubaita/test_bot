import { logger } from '../utils/logger';
import { Market } from '../types';

export interface MarketWithVolume extends Market {
  volume: number;
  volume24h: number;
  endDate?: string;
  spread?: number; // Bid-ask spread for scoring
}

export class MarketScanner {
  private apiUrl = 'https://gamma-api.polymarket.com';
  private minVolume: number;
  private maxVolume: number;

  constructor(minVolume: number = 10000, maxVolume: number = 100000) {
    this.minVolume = minVolume;
    this.maxVolume = maxVolume;
  }

  async fetchActiveMarkets(): Promise<MarketWithVolume[]> {
    try {
      logger.info('Fetching ALL active markets from Polymarket...');

      const startTime = Date.now();
      const limit = 500;
      const maxParallelRequests = 2; // Reduced to avoid rate limits
      const maxBatches = 6; // Fetch up to 9,000 markets to avoid rate limits

      let allMarkets: any[] = [];
      let offset = 0;
      let batchNumber = 0;

      // Parallel fetch batches
      while (true) {
        const promises = [];

        // Create parallel requests for next N batches
        for (let i = 0; i < maxParallelRequests; i++) {
          const currentOffset = offset + (i * limit);
          // Try to filter for non-closed markets in API query
          promises.push(
            fetch(`${this.apiUrl}/markets?limit=${limit}&offset=${currentOffset}&closed=false`)
              .then(res => res.ok ? res.json() : null)
              .catch(err => {
                logger.warn(`Failed to fetch batch at offset ${currentOffset}`);
                return null;
              })
          );
        }

        // Wait for all parallel requests
        const results = await Promise.all(promises);

        let hasData = false;
        for (const data of results) {
          if (data) {
            const markets = Array.isArray(data) ? data : (data.data || []);
            if (markets.length > 0) {
              allMarkets = allMarkets.concat(markets);
              hasData = true;
            }
          }
        }

        offset += maxParallelRequests * limit;
        batchNumber++;

        logger.info(`Batch ${batchNumber}: ${allMarkets.length} total active markets fetched`);

        // Stop if no data returned
        if (!hasData) {
          break;
        }

        // Safety limit
        if (batchNumber >= maxBatches) {
          logger.info('Reached batch limit, stopping fetch');
          break;
        }
      }

      const fetchTime = Date.now() - startTime;
      logger.info(`Fetched ${allMarkets.length} total markets in ${fetchTime}ms`);

      // Filter markets - keep only funded markets with token IDs
      const now = new Date();
      const twoWeeksFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

      const filteredMarkets = allMarkets
        .filter((market: any) => {
          // Must be active and not closed
          if (market.closed || market.active === false) {
            return false;
          }
          // Must have clobTokenIds (funded markets only)
          if (!market.clobTokenIds) {
            return false;
          }
          // Must end within 14 days (2 weeks)
          if (market.endDate || market.end_date) {
            try {
              const endDate = new Date(market.endDate || market.end_date);
              if (endDate > twoWeeksFromNow) {
                return false; // Market ends too far in the future
              }
              if (endDate < now) {
                return false; // Market already ended
              }
            } catch (e) {
              // Failed to parse date, include the market anyway
            }
          }
          // Include all active markets regardless of volume
          return true;
        })
        .map((market: any) => {
          // Parse clobTokenIds from JSON string
          let tokenIds: string[] = [];
          try {
            if (typeof market.clobTokenIds === 'string') {
              tokenIds = JSON.parse(market.clobTokenIds);
            } else if (Array.isArray(market.clobTokenIds)) {
              tokenIds = market.clobTokenIds;
            } else if (market.tokens) {
              tokenIds = Array.isArray(market.tokens) ? market.tokens : JSON.parse(market.tokens);
            }
          } catch (e) {
            // Failed to parse, leave empty
          }

          return {
            id: market.id || market.condition_id,
            question: market.question || market.title || 'Unknown',
            active: market.active !== false,
            closed: market.closed === true,
            outcomeTokens: tokenIds,
            outcomes: market.outcomes || ['YES', 'NO'],
            volume: parseFloat(market.volume || market.volume_24h || '0'),
            volume24h: parseFloat(market.volume_24h || market.volume || '0'),
            endDate: market.endDate || market.end_date,
          };
        });

      logger.info(`Found ${filteredMarkets.length} active, funded markets ending within 14 days`);

      // Log sample of markets found
      if (filteredMarkets.length > 0) {
        const marketsWithTokens = filteredMarkets.filter(m => m.outcomeTokens.length > 0);
        logger.info(`${marketsWithTokens.length} markets have valid tokens`);

        logger.info('Sample markets with tokens:', {
          markets: marketsWithTokens.slice(0, 5).map(m => ({
            question: m.question.substring(0, 50),
            volume: `$${Math.round(m.volume)}`,
            id: m.id,
            tokenCount: m.outcomeTokens.length,
            tokens: m.outcomeTokens,
          })),
        });
      }

      return filteredMarkets;
    } catch (error) {
      logger.error('Error fetching markets', { error });
      throw error;
    }
  }

  async fetchOrderBook(tokenId: string): Promise<{ bestBid: number; bestAsk: number; spread: number } | null> {
    try {
      const response = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`);

      if (!response.ok) {
        return null;
      }

      const data: any = await response.json();

      // Extract best bid and best ask
      const bids = data.bids || [];
      const asks = data.asks || [];

      if (bids.length === 0 || asks.length === 0) {
        return null; // No liquidity
      }

      const bestBid = parseFloat(bids[0].price);
      const bestAsk = parseFloat(asks[0].price);
      const spread = bestAsk - bestBid;

      return { bestBid, bestAsk, spread };
    } catch (error) {
      return null;
    }
  }

  async getMarketSpread(market: MarketWithVolume): Promise<number> {
    try {
      // For markets with token IDs, fetch orderbook and calculate spread
      if (market.outcomeTokens.length === 0) {
        return 0;
      }

      // Fetch orderbooks for all tokens (usually 2 for binary markets)
      const orderbookPromises = market.outcomeTokens.map(tokenId =>
        this.fetchOrderBook(tokenId)
      );

      const orderbooks = await Promise.all(orderbookPromises);

      // Calculate average spread across all tokens
      const validSpreads = orderbooks
        .filter(ob => ob !== null)
        .map(ob => ob!.spread);

      if (validSpreads.length === 0) {
        return 0; // No valid orderbooks
      }

      const avgSpread = validSpreads.reduce((sum, s) => sum + s, 0) / validSpreads.length;
      return avgSpread;
    } catch (error) {
      return 0;
    }
  }

  async getMarketTokens(conditionId: string): Promise<string[]> {
    try {
      // Fetch specific market details to get token IDs
      const response = await fetch(`${this.apiUrl}/markets/${conditionId}`);

      if (!response.ok) {
        logger.warn(`Failed to fetch market details for ${conditionId}`, {
          status: response.status,
          statusText: response.statusText,
        });
        return [];
      }

      const market: any = await response.json();

      // Parse clobTokenIds if it's a string
      let tokens: string[] = [];
      if (market.clobTokenIds) {
        try {
          tokens = typeof market.clobTokenIds === 'string'
            ? JSON.parse(market.clobTokenIds)
            : market.clobTokenIds;
        } catch (e) {
          // Fall back to other token fields
          tokens = market.tokens || market.outcome_tokens || [];
        }
      } else {
        tokens = market.tokens || market.outcome_tokens || [];
      }

      return tokens;
    } catch (error) {
      logger.error('Error fetching market tokens', { error, conditionId });
      return [];
    }
  }

  async scanAndFilterMarkets(): Promise<MarketWithVolume[]> {
    try {
      const markets = await this.fetchActiveMarkets();

      // Sort by volume descending
      markets.sort((a, b) => b.volume - a.volume);

      logger.info('Market scan complete', {
        totalFound: markets.length,
        topVolumeMarkets: markets.slice(0, 5).map(m => ({
          question: m.question.substring(0, 40),
          volume: `$${Math.round(m.volume).toLocaleString()}`,
        })),
      });

      return markets;
    } catch (error) {
      logger.error('Error scanning markets', { error });
      return [];
    }
  }
}
