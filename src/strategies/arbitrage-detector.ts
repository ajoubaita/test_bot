import { ArbitrageOpportunity, OrderBook, RiskLimits } from '../types';
import { OrderBookManager } from '../trading/orderbook-manager';
import { logger } from '../utils/logger';
import { EventEmitter } from 'events';

export class ArbitrageDetector extends EventEmitter {
  private orderBookManager: OrderBookManager;
  private riskLimits: RiskLimits;
  private detectedOpportunities: ArbitrageOpportunity[] = [];

  constructor(orderBookManager: OrderBookManager, riskLimits: RiskLimits) {
    super();
    this.orderBookManager = orderBookManager;
    this.riskLimits = riskLimits;
  }

  detectOpportunities(): ArbitrageOpportunity[] {
    const startTime = process.hrtime.bigint();
    const opportunities: ArbitrageOpportunity[] = [];

    const markets = this.orderBookManager.getAllMarkets();

    for (const marketId of markets) {
      // Detect spread arbitrage
      const spreadOpp = this.detectSpreadArbitrage(marketId);
      if (spreadOpp) {
        opportunities.push(spreadOpp);
      }

      // Detect yes/no imbalance (binary markets should sum to ~1)
      const imbalanceOpp = this.detectYesNoImbalance(marketId);
      if (imbalanceOpp) {
        opportunities.push(imbalanceOpp);
      }
    }

    // Detect cross-market arbitrage (between related markets)
    const crossMarketOpps = this.detectCrossMarketArbitrage(markets);
    opportunities.push(...crossMarketOpps);

    const endTime = process.hrtime.bigint();
    const latencyMs = Number(endTime - startTime) / 1_000_000;

    // Filter opportunities by minimum profit threshold
    const validOpportunities = opportunities.filter(
      opp => opp.expectedProfit >= this.riskLimits.minProfitThreshold
    );

    if (validOpportunities.length > 0) {
      logger.info('Arbitrage opportunities detected', {
        count: validOpportunities.length,
        latencyMs,
      });

      validOpportunities.forEach(opp => {
        opp.latency = latencyMs;
        this.detectedOpportunities.push(opp);
        this.emit('opportunity', opp);
      });
    }

    return validOpportunities;
  }

  private detectSpreadArbitrage(marketId: string): ArbitrageOpportunity | null {
    const orderBook = this.orderBookManager.getOrderBook(marketId);
    if (!orderBook) return null;

    const bestBid = this.orderBookManager.getBestBid(orderBook);
    const bestAsk = this.orderBookManager.getBestAsk(orderBook);

    if (!bestBid || !bestAsk) return null;

    const spread = bestAsk.price - bestBid.price;

    // Tight spread can be exploited with market making
    // If spread is negative (crossed book), immediate arbitrage exists
    if (spread < 0) {
      const expectedProfit = Math.abs(spread) * Math.min(bestBid.size, bestAsk.size);
      const profitPercentage = Math.abs(spread) / bestAsk.price;

      return {
        type: 'spread',
        marketId,
        expectedProfit,
        profitPercentage,
        buyPrice: bestAsk.price,
        sellPrice: bestBid.price,
        detectedAt: Date.now(),
        latency: 0, // Will be set by caller
      };
    }

    return null;
  }

  private detectYesNoImbalance(marketId: string): ArbitrageOpportunity | null {
    // For binary markets, YES + NO prices should equal ~1.00
    // If YES_bid + NO_bid > 1, we can sell both and profit
    // If YES_ask + NO_ask < 1, we can buy both and profit

    const orderBook = this.orderBookManager.getOrderBook(marketId);
    if (!orderBook) return null;

    const bestBid = this.orderBookManager.getBestBid(orderBook);
    const bestAsk = this.orderBookManager.getBestAsk(orderBook);

    if (!bestBid || !bestAsk) return null;

    // Assuming binary market where complementary price is (1 - price)
    // YES_ask + NO_ask should equal 1.00
    // If YES_ask + NO_ask < 1, we can buy both for profit
    const impliedNoAsk = 1 - bestBid.price; // If we buy YES, we're selling NO
    const impliedNoBid = 1 - bestAsk.price;

    // Check if we can buy YES and NO for less than 1.00
    const totalCost = bestAsk.price + impliedNoAsk;
    if (totalCost < 0.99) {
      // Profitable to buy both
      const expectedProfit = (1.00 - totalCost) * Math.min(bestBid.size, bestAsk.size);
      const profitPercentage = (1.00 - totalCost) / totalCost;

      return {
        type: 'yes-no-imbalance',
        marketId,
        expectedProfit,
        profitPercentage,
        buyPrice: totalCost,
        sellPrice: 1.00,
        detectedAt: Date.now(),
        latency: 0,
      };
    }

    // Check if we can sell YES and NO for more than 1.00
    const totalRevenue = bestBid.price + impliedNoBid;
    if (totalRevenue > 1.01) {
      // Profitable to sell both
      const expectedProfit = (totalRevenue - 1.00) * Math.min(bestBid.size, bestAsk.size);
      const profitPercentage = (totalRevenue - 1.00) / 1.00;

      return {
        type: 'yes-no-imbalance',
        marketId,
        expectedProfit,
        profitPercentage,
        buyPrice: 1.00,
        sellPrice: totalRevenue,
        detectedAt: Date.now(),
        latency: 0,
      };
    }

    return null;
  }

  private detectCrossMarketArbitrage(marketIds: string[]): ArbitrageOpportunity[] {
    // This is a simplified version - in practice, you'd need to identify
    // correlated or related markets (e.g., "Will X happen?" and "Will Y happen?" where X and Y are mutually exclusive)

    const opportunities: ArbitrageOpportunity[] = [];

    // For demonstration, we check if any two markets have pricing inconsistencies
    // In reality, you'd need domain knowledge to identify related markets

    for (let i = 0; i < marketIds.length; i++) {
      for (let j = i + 1; j < marketIds.length; j++) {
        const marketA = marketIds[i];
        const marketB = marketIds[j];

        const oppA = this.orderBookManager.getOrderBook(marketA);
        const oppB = this.orderBookManager.getOrderBook(marketB);

        if (!oppA || !oppB) continue;

        // Check for price discrepancies
        const midPriceA = this.orderBookManager.getMidPrice(marketA);
        const midPriceB = this.orderBookManager.getMidPrice(marketB);

        if (!midPriceA || !midPriceB) continue;

        // This is a placeholder - real cross-market arbitrage requires
        // understanding the relationship between markets
        // Example: If markets are for same event on different platforms,
        // or correlated events, etc.
      }
    }

    return opportunities;
  }

  getDetectedOpportunities(): ArbitrageOpportunity[] {
    return this.detectedOpportunities;
  }

  getOpportunityCount(): number {
    return this.detectedOpportunities.length;
  }

  clearHistory(): void {
    this.detectedOpportunities = [];
  }
}
