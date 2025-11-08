import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import { CrossMarketOpportunity } from '../strategies/cross-market-arbitrage';

export interface PaperTrade {
  id: string;
  timestamp: number;
  type: 'cross-market' | 'same-platform';

  // Entry details
  entryBuyPlatform: string;
  entrySellPlatform: string;
  entryBuyPrice: number;
  entrySellPrice: number;
  entrySpread: number;
  size: number; // number of contracts
  capitalAllocated: number;

  // Market details
  polymarketMarket?: string;
  kalshiMarket?: string;
  similarityScore?: number;

  // Exit details
  exitTimestamp?: number;
  exitBuyPrice?: number;
  exitSellPrice?: number;
  exitSpread?: number;

  // P&L
  realizedPnL?: number;
  returnPercentage?: number;

  // Status
  status: 'open' | 'closed';
  closeReason?: string;
}

export interface PaperPortfolio {
  initialCapital: number;
  currentCapital: number;
  allocatedCapital: number;
  availableCapital: number;
  openPositions: number;
  closedPositions: number;
  totalPnL: number;
  totalReturn: number;
  winRate: number;
  avgWinAmount: number;
  avgLossAmount: number;
  largestWin: number;
  largestLoss: number;
}

export class PaperTrader {
  private initialCapital: number;
  private currentCapital: number;
  private allocatedCapital: number = 0;
  private trades: Map<string, PaperTrade> = new Map();
  private closedTrades: PaperTrade[] = [];
  private readonly tradesLogPath: string;
  private readonly portfolioLogPath: string;
  private readonly maxPositionSize: number; // Max % of capital per trade
  private readonly defaultPositionSize: number; // Default size in dollars
  private tradeCounter = 0;

  // Auto-close settings
  private readonly autoCloseAfterMs: number = 24 * 60 * 60 * 1000; // 24 hours
  private autoCloseTimer?: NodeJS.Timeout;

  constructor(
    initialCapital: number = 10000,
    maxPositionSize: number = 0.1, // 10% max per trade
    defaultPositionSize: number = 500, // $500 per trade
    logDirectory: string = 'logs'
  ) {
    this.initialCapital = initialCapital;
    this.currentCapital = initialCapital;
    this.maxPositionSize = maxPositionSize;
    this.defaultPositionSize = defaultPositionSize;

    this.tradesLogPath = path.join(logDirectory, 'paper-trades.jsonl');
    this.portfolioLogPath = path.join(logDirectory, 'paper-portfolio.jsonl');

    // Ensure log directory exists
    if (!fs.existsSync(logDirectory)) {
      fs.mkdirSync(logDirectory, { recursive: true });
    }

    logger.info('💰 Paper Trading initialized', {
      initialCapital: `$${initialCapital.toFixed(2)}`,
      maxPositionSize: `${(maxPositionSize * 100).toFixed(0)}%`,
      defaultPositionSize: `$${defaultPositionSize}`,
    });

    // Log initial portfolio state
    this.logPortfolioSnapshot();

    // Start auto-close timer (check every 5 minutes)
    this.startAutoCloseTimer();
  }

  /**
   * Execute a paper trade from a cross-market opportunity
   */
  executeCrossMarketTrade(opportunity: CrossMarketOpportunity): PaperTrade | null {
    // Calculate position size
    const availableCapital = this.currentCapital - this.allocatedCapital;
    const maxAllowed = this.currentCapital * this.maxPositionSize;
    const positionSize = Math.min(this.defaultPositionSize, availableCapital, maxAllowed);

    if (positionSize < 100) {
      logger.warn('Insufficient capital for paper trade', {
        available: availableCapital,
        required: this.defaultPositionSize,
      });
      return null;
    }

    // Calculate number of contracts (assuming $1 max payout per contract)
    // For arbitrage, we need to buy and sell the same number of contracts
    const buyPrice = opportunity.direction === 'buy-kalshi-sell-poly'
      ? opportunity.kalshiPrice
      : opportunity.polymarketPrice;
    const sellPrice = opportunity.direction === 'buy-kalshi-sell-poly'
      ? opportunity.polymarketPrice
      : opportunity.kalshiPrice;

    // Number of contracts we can afford
    // Cost = buyPrice * contracts, we want to allocate positionSize
    const contracts = Math.floor(positionSize / buyPrice);

    if (contracts === 0) {
      logger.warn('Position size too small for trade', {
        positionSize,
        buyPrice,
      });
      return null;
    }

    // Actual capital allocated
    const capitalAllocated = contracts * buyPrice;

    // Create trade
    const tradeId = `PT-${Date.now()}-${this.tradeCounter++}`;
    const trade: PaperTrade = {
      id: tradeId,
      timestamp: Date.now(),
      type: 'cross-market',
      entryBuyPlatform: opportunity.direction === 'buy-kalshi-sell-poly' ? 'Kalshi' : 'Polymarket',
      entrySellPlatform: opportunity.direction === 'buy-kalshi-sell-poly' ? 'Polymarket' : 'Kalshi',
      entryBuyPrice: buyPrice,
      entrySellPrice: sellPrice,
      entrySpread: opportunity.priceDifference,
      size: contracts,
      capitalAllocated,
      polymarketMarket: opportunity.polymarketQuestion,
      kalshiMarket: opportunity.kalshiTitle,
      similarityScore: opportunity.similarityScore,
      status: 'open',
    };

    // Update capital
    this.allocatedCapital += capitalAllocated;

    // Store trade
    this.trades.set(tradeId, trade);

    // Log trade
    this.logTrade(trade, 'OPEN');

    logger.info('📈 PAPER TRADE EXECUTED', {
      tradeId,
      type: 'cross-market',
      direction: opportunity.direction,
      contracts,
      capitalAllocated: `$${capitalAllocated.toFixed(2)}`,
      entrySpread: opportunity.priceDifference.toFixed(3),
      expectedProfit: `$${(contracts * opportunity.priceDifference).toFixed(2)}`,
      polymarket: opportunity.polymarketQuestion.substring(0, 50),
      kalshi: opportunity.kalshiTitle.substring(0, 50),
      portfolio: {
        allocated: `$${this.allocatedCapital.toFixed(2)}`,
        available: `$${(this.currentCapital - this.allocatedCapital).toFixed(2)}`,
        openPositions: this.trades.size,
      },
    });

    return trade;
  }

  /**
   * Close a paper trade manually
   */
  closeTrade(
    tradeId: string,
    exitBuyPrice: number,
    exitSellPrice: number,
    reason: string = 'manual'
  ): PaperTrade | null {
    const trade = this.trades.get(tradeId);
    if (!trade) {
      logger.warn('Trade not found', { tradeId });
      return null;
    }

    if (trade.status === 'closed') {
      logger.warn('Trade already closed', { tradeId });
      return null;
    }

    // Calculate P&L
    // In arbitrage, we profit from the spread
    // Entry: Buy at entryBuyPrice, Sell at entrySellPrice
    // Exit: Close buy position (sell at exitBuyPrice), Close sell position (buy at exitSellPrice)

    // P&L = (exitBuyPrice - entryBuyPrice) + (entrySellPrice - exitSellPrice)
    // Simplified: (exitBuyPrice - entryBuyPrice - exitSellPrice + entrySellPrice)
    // Or: (exitSpread - entrySpread) where positive spread means we made money on the arb

    const exitSpread = exitSellPrice - exitBuyPrice;
    const spreadChange = exitSpread - trade.entrySpread;

    // For a perfect arbitrage, if prices converge, we make the initial spread
    // If we bought at 0.01 and sold at 0.72, spread = 0.71
    // If they converge to 0.50, we make: (0.50 - 0.01) - (0.72 - 0.50) = 0.49 - 0.22 = 0.27

    const realizedPnL = trade.size * (
      (exitBuyPrice - trade.entryBuyPrice) - (exitSellPrice - trade.entrySellPrice)
    );

    const returnPercentage = realizedPnL / trade.capitalAllocated;

    // Update trade
    trade.exitTimestamp = Date.now();
    trade.exitBuyPrice = exitBuyPrice;
    trade.exitSellPrice = exitSellPrice;
    trade.exitSpread = exitSpread;
    trade.realizedPnL = realizedPnL;
    trade.returnPercentage = returnPercentage;
    trade.status = 'closed';
    trade.closeReason = reason;

    // Update capital
    this.allocatedCapital -= trade.capitalAllocated;
    this.currentCapital += trade.capitalAllocated + realizedPnL;

    // Move to closed trades
    this.trades.delete(tradeId);
    this.closedTrades.push(trade);

    // Log trade
    this.logTrade(trade, 'CLOSE');
    this.logPortfolioSnapshot();

    logger.info('📉 PAPER TRADE CLOSED', {
      tradeId,
      reason,
      holdTime: `${((trade.exitTimestamp - trade.timestamp) / 1000 / 60).toFixed(0)}min`,
      entrySpread: trade.entrySpread.toFixed(3),
      exitSpread: exitSpread.toFixed(3),
      realizedPnL: `$${realizedPnL.toFixed(2)}`,
      returnPercentage: `${(returnPercentage * 100).toFixed(2)}%`,
      portfolio: {
        capital: `$${this.currentCapital.toFixed(2)}`,
        totalPnL: `$${(this.currentCapital - this.initialCapital).toFixed(2)}`,
        openPositions: this.trades.size,
      },
    });

    return trade;
  }

  /**
   * Simulate market resolution (close at market outcome)
   * For simplicity, assume both markets resolve to the same outcome
   */
  closeTradeAtResolution(tradeId: string, resolvedPrice: number): PaperTrade | null {
    // When markets resolve, both converge to 0 (NO) or 1 (YES)
    // For our arbitrage, we profit the full spread if they resolve the same way
    return this.closeTrade(tradeId, resolvedPrice, resolvedPrice, 'market-resolution');
  }

  /**
   * Auto-close old positions (simulate market resolution or exit)
   */
  private autoCloseOldPositions(): void {
    const now = Date.now();
    const positionsToClose: string[] = [];

    for (const [tradeId, trade] of this.trades) {
      const ageMs = now - trade.timestamp;

      if (ageMs >= this.autoCloseAfterMs) {
        positionsToClose.push(tradeId);
      }
    }

    if (positionsToClose.length > 0) {
      logger.info(`Auto-closing ${positionsToClose.length} aged positions`);

      for (const tradeId of positionsToClose) {
        // Simulate favorable resolution (assume the arb worked and prices converged)
        // Use the midpoint of entry prices as the resolution price
        const trade = this.trades.get(tradeId);
        if (trade) {
          const resolutionPrice = (trade.entryBuyPrice + trade.entrySellPrice) / 2;
          this.closeTradeAtResolution(tradeId, resolutionPrice);
        }
      }
    }
  }

  private startAutoCloseTimer(): void {
    // Check every 5 minutes
    this.autoCloseTimer = setInterval(() => {
      this.autoCloseOldPositions();
    }, 5 * 60 * 1000);
  }

  stopAutoClose(): void {
    if (this.autoCloseTimer) {
      clearInterval(this.autoCloseTimer);
    }
  }

  /**
   * Get portfolio summary
   */
  getPortfolio(): PaperPortfolio {
    const wins = this.closedTrades.filter(t => (t.realizedPnL || 0) > 0);
    const losses = this.closedTrades.filter(t => (t.realizedPnL || 0) <= 0);

    const totalPnL = this.currentCapital - this.initialCapital;
    const totalReturn = totalPnL / this.initialCapital;
    const winRate = this.closedTrades.length > 0 ? wins.length / this.closedTrades.length : 0;

    const avgWin = wins.length > 0
      ? wins.reduce((sum, t) => sum + (t.realizedPnL || 0), 0) / wins.length
      : 0;

    const avgLoss = losses.length > 0
      ? losses.reduce((sum, t) => sum + (t.realizedPnL || 0), 0) / losses.length
      : 0;

    const largestWin = wins.length > 0
      ? Math.max(...wins.map(t => t.realizedPnL || 0))
      : 0;

    const largestLoss = losses.length > 0
      ? Math.min(...losses.map(t => t.realizedPnL || 0))
      : 0;

    return {
      initialCapital: this.initialCapital,
      currentCapital: this.currentCapital,
      allocatedCapital: this.allocatedCapital,
      availableCapital: this.currentCapital - this.allocatedCapital,
      openPositions: this.trades.size,
      closedPositions: this.closedTrades.length,
      totalPnL,
      totalReturn,
      winRate,
      avgWinAmount: avgWin,
      avgLossAmount: avgLoss,
      largestWin,
      largestLoss,
    };
  }

  /**
   * Get open trades
   */
  getOpenTrades(): PaperTrade[] {
    return Array.from(this.trades.values());
  }

  /**
   * Get closed trades
   */
  getClosedTrades(limit?: number): PaperTrade[] {
    if (limit) {
      return this.closedTrades.slice(-limit);
    }
    return this.closedTrades;
  }

  /**
   * Log trade to file
   */
  private logTrade(trade: PaperTrade, action: 'OPEN' | 'CLOSE'): void {
    try {
      const logEntry = {
        action,
        trade,
        timestamp: new Date().toISOString(),
      };
      const logLine = JSON.stringify(logEntry) + '\n';
      fs.appendFileSync(this.tradesLogPath, logLine);
    } catch (error) {
      logger.error('Failed to log trade', { error });
    }
  }

  /**
   * Log portfolio snapshot
   */
  private logPortfolioSnapshot(): void {
    try {
      const portfolio = this.getPortfolio();
      const logEntry = {
        ...portfolio,
        timestamp: new Date().toISOString(),
      };
      const logLine = JSON.stringify(logEntry) + '\n';
      fs.appendFileSync(this.portfolioLogPath, logLine);
    } catch (error) {
      logger.error('Failed to log portfolio snapshot', { error });
    }
  }

  /**
   * Generate portfolio report
   */
  generateReport(): string {
    const portfolio = this.getPortfolio();
    const recentTrades = this.getClosedTrades(5);

    let report = '=== PAPER TRADING REPORT ===\n\n';

    report += '💰 Portfolio Summary:\n';
    report += `  Initial Capital: $${portfolio.initialCapital.toFixed(2)}\n`;
    report += `  Current Capital: $${portfolio.currentCapital.toFixed(2)}\n`;
    report += `  Allocated: $${portfolio.allocatedCapital.toFixed(2)}\n`;
    report += `  Available: $${portfolio.availableCapital.toFixed(2)}\n`;
    report += `  Total P&L: $${portfolio.totalPnL.toFixed(2)} (${(portfolio.totalReturn * 100).toFixed(2)}%)\n`;
    report += '\n';

    report += '📊 Trading Statistics:\n';
    report += `  Open Positions: ${portfolio.openPositions}\n`;
    report += `  Closed Positions: ${portfolio.closedPositions}\n`;
    report += `  Win Rate: ${(portfolio.winRate * 100).toFixed(2)}%\n`;
    if (portfolio.closedPositions > 0) {
      report += `  Avg Win: $${portfolio.avgWinAmount.toFixed(2)}\n`;
      report += `  Avg Loss: $${portfolio.avgLossAmount.toFixed(2)}\n`;
      report += `  Largest Win: $${portfolio.largestWin.toFixed(2)}\n`;
      report += `  Largest Loss: $${portfolio.largestLoss.toFixed(2)}\n`;
    }
    report += '\n';

    if (recentTrades.length > 0) {
      report += '📝 Recent Closed Trades:\n';
      for (const trade of recentTrades.reverse()) {
        const holdTime = ((trade.exitTimestamp! - trade.timestamp) / 1000 / 60 / 60).toFixed(1);
        report += `  [${new Date(trade.timestamp).toISOString()}]\n`;
        report += `    ${trade.entryBuyPlatform} → ${trade.entrySellPlatform}\n`;
        report += `    Size: ${trade.size} contracts @ $${trade.capitalAllocated.toFixed(2)}\n`;
        report += `    Entry Spread: ${trade.entrySpread.toFixed(3)} | Exit Spread: ${trade.exitSpread?.toFixed(3)}\n`;
        report += `    P&L: $${trade.realizedPnL?.toFixed(2)} (${((trade.returnPercentage || 0) * 100).toFixed(2)}%)\n`;
        report += `    Hold Time: ${holdTime}h | Reason: ${trade.closeReason}\n`;
        report += '\n';
      }
    }

    return report;
  }
}
