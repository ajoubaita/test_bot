import { logger } from '../utils/logger';
import { EventEmitter } from 'events';
import { KalshiClient, KalshiOrderBook } from '../kalshi/client';
import { OrderBookManager } from '../trading/orderbook-manager';
import { MarketMatcher, MarketPair } from '../kalshi/market-matcher';

export interface CrossMarketOpportunity {
  type: 'cross-market';
  polymarketMarketId: string;
  kalshiMarketTicker: string;
  polymarketQuestion: string;
  kalshiTitle: string;
  direction: 'buy-kalshi-sell-poly' | 'buy-poly-sell-kalshi';
  polymarketPrice: number;
  kalshiPrice: number;
  priceDifference: number;
  expectedProfit: number;
  profitPercentage: number;
  detectedAt: number;
  similarityScore: number;
}

export class CrossMarketArbitrageDetector extends EventEmitter {
  private kalshiClient: KalshiClient;
  private polymarketOrderBooks: OrderBookManager;
  private marketMatcher: MarketMatcher;
  private marketPairs: MarketPair[] = [];
  private minPriceDifference: number;
  private minSimilarity: number;

  constructor(
    kalshiClient: KalshiClient,
    polymarketOrderBooks: OrderBookManager,
    minPriceDifference: number = 0.03, // 3 cent minimum price difference
    minSimilarity: number = 0.75 // 75% title similarity minimum
  ) {
    super();
    this.kalshiClient = kalshiClient;
    this.polymarketOrderBooks = polymarketOrderBooks;
    this.marketMatcher = new MarketMatcher();
    this.minPriceDifference = minPriceDifference;
    this.minSimilarity = minSimilarity;

    logger.info('Cross-market arbitrage detector initialized', {
      minPriceDifference,
      minSimilarity,
    });
  }

  /**
   * Update the list of matched markets between Kalshi and Polymarket
   */
  async updateMarketPairs(polymarketMarkets: any[]): Promise<void> {
    try {
      // Fetch latest Kalshi markets
      const kalshiMarkets = await this.kalshiClient.fetchMarkets({ limit: 500 });

      if (kalshiMarkets.length === 0) {
        logger.warn('No Kalshi markets fetched');
        return;
      }

      // Find matches
      const fuzzyMatches = this.marketMatcher.findMatches(
        polymarketMarkets,
        kalshiMarkets,
        this.minSimilarity
      );

      const exactMatches = this.marketMatcher.findExactMatches(
        polymarketMarkets,
        kalshiMarkets
      );

      // Combine and deduplicate
      const allMatches = [...exactMatches, ...fuzzyMatches];
      const uniqueMatches = new Map<string, MarketPair>();

      for (const match of allMatches) {
        const key = `${match.polymarketMarket.id}-${match.kalshiMarket.ticker}`;
        if (!uniqueMatches.has(key) || uniqueMatches.get(key)!.similarityScore < match.similarityScore) {
          uniqueMatches.set(key, match);
        }
      }

      this.marketPairs = Array.from(uniqueMatches.values());

      logger.info(`Updated cross-market pairs`, {
        totalPairs: this.marketPairs.length,
        exactMatches: exactMatches.length,
        fuzzyMatches: fuzzyMatches.length,
      });

      if (this.marketPairs.length > 0) {
        logger.info('Sample cross-market pairs:', {
          samples: this.marketPairs.slice(0, 3).map(pair => ({
            polymarket: pair.polymarketMarket.question.substring(0, 40),
            kalshi: pair.kalshiMarket.title.substring(0, 40),
            similarity: pair.similarityScore.toFixed(2),
          })),
        });
      }
    } catch (error) {
      logger.error('Error updating market pairs', { error });
    }
  }

  /**
   * Detect arbitrage opportunities across Kalshi and Polymarket
   */
  async detectOpportunities(): Promise<CrossMarketOpportunity[]> {
    const opportunities: CrossMarketOpportunity[] = [];

    if (this.marketPairs.length === 0) {
      return opportunities;
    }

    logger.debug(`Scanning ${this.marketPairs.length} cross-market pairs for arbitrage...`);

    for (const pair of this.marketPairs) {
      try {
        // Get Polymarket orderbook
        const pmTokens = pair.polymarketMarket.outcomeTokens;
        if (pmTokens.length === 0) continue;

        // Assume first token is YES (for binary markets)
        const pmOrderBook = this.polymarketOrderBooks.getOrderBook(pmTokens[0]);
        if (!pmOrderBook) continue;

        const pmBestBid = this.polymarketOrderBooks.getBestBid(pmOrderBook);
        const pmBestAsk = this.polymarketOrderBooks.getBestAsk(pmOrderBook);

        if (!pmBestBid || !pmBestAsk) continue;

        // Get Kalshi orderbook (from WebSocket cache if available, else fetch via REST)
        let kalshiOrderBook = this.kalshiClient.getOrderBook(pair.kalshiMarket.ticker);
        if (!kalshiOrderBook) {
          // Fallback to REST API if WebSocket not available
          kalshiOrderBook = await this.kalshiClient.fetchOrderBook(pair.kalshiMarket.ticker);
        }
        if (!kalshiOrderBook) continue;

        const kalshiPrices = this.kalshiClient.getBestPrices(kalshiOrderBook);
        if (!kalshiPrices.yesBid || !kalshiPrices.yesAsk) continue;

        // Detect arbitrage: Compare YES prices
        const opportunity = this.detectPriceDiscrepancy(
          pair,
          pmBestBid.price,
          pmBestAsk.price,
          kalshiPrices.yesBid!,
          kalshiPrices.yesAsk!,
          Math.min(pmBestBid.size, pmBestAsk.size)
        );

        if (opportunity) {
          opportunities.push(opportunity);
          this.emit('opportunity', opportunity);
        }
      } catch (error) {
        logger.error('Error detecting cross-market arbitrage for pair', {
          error,
          polymarket: pair.polymarketMarket.question.substring(0, 30),
          kalshi: pair.kalshiMarket.title.substring(0, 30),
        });
      }
    }

    if (opportunities.length > 0) {
      logger.info(`🎯 CROSS-MARKET ARBITRAGE: Found ${opportunities.length} opportunities`, {
        topOpportunities: opportunities.slice(0, 3).map(opp => ({
          polymarket: opp.polymarketQuestion.substring(0, 40),
          kalshi: opp.kalshiTitle.substring(0, 40),
          direction: opp.direction,
          profit: `$${opp.expectedProfit.toFixed(2)}`,
          percentage: `${(opp.profitPercentage * 100).toFixed(2)}%`,
        })),
      });
    }

    return opportunities;
  }

  /**
   * Detect price discrepancy between two markets
   */
  private detectPriceDiscrepancy(
    pair: MarketPair,
    pmBid: number,
    pmAsk: number,
    kalshiBid: number,
    kalshiAsk: number,
    availableSize: number
  ): CrossMarketOpportunity | null {
    // Scenario 1: Buy on Kalshi (cheaper), sell on Polymarket (more expensive)
    // We can buy YES on Kalshi at kalshiAsk and sell YES on Polymarket at pmBid
    const buyKalshiSellPoly = pmBid - kalshiAsk;

    // Scenario 2: Buy on Polymarket (cheaper), sell on Kalshi (more expensive)
    // We can buy YES on Polymarket at pmAsk and sell YES on Kalshi at kalshiBid
    const buyPolySellKalshi = kalshiBid - pmAsk;

    let bestDirection: 'buy-kalshi-sell-poly' | 'buy-poly-sell-kalshi' | null = null;
    let priceDifference = 0;
    let buyPrice = 0;
    let sellPrice = 0;

    if (buyKalshiSellPoly >= this.minPriceDifference) {
      bestDirection = 'buy-kalshi-sell-poly';
      priceDifference = buyKalshiSellPoly;
      buyPrice = kalshiAsk;
      sellPrice = pmBid;
    } else if (buyPolySellKalshi >= this.minPriceDifference) {
      bestDirection = 'buy-poly-sell-kalshi';
      priceDifference = buyPolySellKalshi;
      buyPrice = pmAsk;
      sellPrice = kalshiBid;
    }

    if (!bestDirection) return null;

    // Calculate expected profit
    const expectedProfit = priceDifference * availableSize;
    const profitPercentage = priceDifference / buyPrice;

    return {
      type: 'cross-market',
      polymarketMarketId: pair.polymarketMarket.id,
      kalshiMarketTicker: pair.kalshiMarket.ticker,
      polymarketQuestion: pair.polymarketMarket.question,
      kalshiTitle: pair.kalshiMarket.title,
      direction: bestDirection,
      polymarketPrice: bestDirection === 'buy-kalshi-sell-poly' ? pmBid : pmAsk,
      kalshiPrice: bestDirection === 'buy-kalshi-sell-poly' ? kalshiAsk : kalshiBid,
      priceDifference,
      expectedProfit,
      profitPercentage,
      detectedAt: Date.now(),
      similarityScore: pair.similarityScore,
    };
  }

  /**
   * Get current market pairs
   */
  getMarketPairs(): MarketPair[] {
    return this.marketPairs;
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      totalPairs: this.marketPairs.length,
      exactMatches: this.marketPairs.filter(p => p.similarityScore === 1.0).length,
      fuzzyMatches: this.marketPairs.filter(p => p.similarityScore < 1.0).length,
      avgSimilarity: this.marketPairs.length > 0
        ? this.marketPairs.reduce((sum, p) => sum + p.similarityScore, 0) / this.marketPairs.length
        : 0,
    };
  }
}
