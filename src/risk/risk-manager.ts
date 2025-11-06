import { RiskLimits, ArbitrageOpportunity, Position } from '../types';
import { OrderExecutor } from '../trading/order-executor';
import { logger } from '../utils/logger';

export class RiskManager {
  private riskLimits: RiskLimits;
  private orderExecutor: OrderExecutor;
  private dailyPnL: number = 0;
  private dailyTradeCount: number = 0;
  private maxDrawdown: number = 0;
  private peakEquity: number = 0;

  constructor(riskLimits: RiskLimits, orderExecutor: OrderExecutor) {
    this.riskLimits = riskLimits;
    this.orderExecutor = orderExecutor;
  }

  canExecuteOpportunity(opportunity: ArbitrageOpportunity): {
    allowed: boolean;
    reason?: string;
  } {
    // Check minimum profit threshold
    if (opportunity.expectedProfit < this.riskLimits.minProfitThreshold) {
      return {
        allowed: false,
        reason: `Profit below threshold: ${opportunity.expectedProfit} < ${this.riskLimits.minProfitThreshold}`,
      };
    }

    // Check if profit percentage meets minimum
    if (opportunity.profitPercentage < 0.001) {
      // 0.1%
      return {
        allowed: false,
        reason: `Profit percentage too low: ${opportunity.profitPercentage * 100}%`,
      };
    }

    // Check total exposure
    const currentExposure = this.orderExecutor.getTotalExposure();
    const estimatedNewExposure = opportunity.buyPrice * 100; // Assuming 100 unit size

    if (currentExposure + estimatedNewExposure > this.riskLimits.maxTotalExposure) {
      return {
        allowed: false,
        reason: `Total exposure limit exceeded: ${currentExposure + estimatedNewExposure} > ${this.riskLimits.maxTotalExposure}`,
      };
    }

    // Check position size limit
    if (estimatedNewExposure > this.riskLimits.maxPositionSize) {
      return {
        allowed: false,
        reason: `Position size limit exceeded: ${estimatedNewExposure} > ${this.riskLimits.maxPositionSize}`,
      };
    }

    // Check slippage tolerance
    const estimatedSlippage = this.estimateSlippage(opportunity);
    if (estimatedSlippage > this.riskLimits.maxSlippage) {
      return {
        allowed: false,
        reason: `Slippage exceeds limit: ${estimatedSlippage * 100}% > ${this.riskLimits.maxSlippage * 100}%`,
      };
    }

    // Check daily loss limit
    if (this.dailyPnL < -this.riskLimits.maxLossPerTrade * 10) {
      // Stop if daily loss exceeds 10x max loss per trade
      return {
        allowed: false,
        reason: `Daily loss limit reached: ${this.dailyPnL}`,
      };
    }

    // All checks passed
    return { allowed: true };
  }

  private estimateSlippage(opportunity: ArbitrageOpportunity): number {
    // Estimate potential slippage based on opportunity type and market conditions
    // This is simplified - in reality you'd check order book depth
    return 0.0005; // 0.05% default estimate
  }

  recordTrade(profit: number, successful: boolean): void {
    this.dailyPnL += profit;
    this.dailyTradeCount++;

    // Update peak equity and drawdown
    if (this.dailyPnL > this.peakEquity) {
      this.peakEquity = this.dailyPnL;
    }

    const currentDrawdown = this.peakEquity - this.dailyPnL;
    if (currentDrawdown > this.maxDrawdown) {
      this.maxDrawdown = currentDrawdown;
    }

    logger.info('Trade recorded', {
      profit,
      successful,
      dailyPnL: this.dailyPnL,
      tradeCount: this.dailyTradeCount,
      maxDrawdown: this.maxDrawdown,
    });
  }

  shouldHaltTrading(): boolean {
    // Check if we should stop trading based on risk metrics

    // Halt if daily loss exceeds threshold
    if (this.dailyPnL < -this.riskLimits.maxLossPerTrade * 10) {
      logger.error('Trading halted: Daily loss limit exceeded', {
        dailyPnL: this.dailyPnL,
      });
      return true;
    }

    // Halt if drawdown is too large
    if (this.maxDrawdown > this.riskLimits.maxLossPerTrade * 20) {
      logger.error('Trading halted: Maximum drawdown exceeded', {
        maxDrawdown: this.maxDrawdown,
      });
      return true;
    }

    // Halt if exposure is too high
    const exposure = this.orderExecutor.getTotalExposure();
    if (exposure > this.riskLimits.maxTotalExposure * 1.5) {
      logger.error('Trading halted: Exposure limit breached', {
        exposure,
        limit: this.riskLimits.maxTotalExposure,
      });
      return true;
    }

    return false;
  }

  getDailyPnL(): number {
    return this.dailyPnL;
  }

  getDailyTradeCount(): number {
    return this.dailyTradeCount;
  }

  getMaxDrawdown(): number {
    return this.maxDrawdown;
  }

  resetDailyStats(): void {
    this.dailyPnL = 0;
    this.dailyTradeCount = 0;
    this.maxDrawdown = 0;
    this.peakEquity = 0;
    logger.info('Daily statistics reset');
  }

  getStats() {
    return {
      dailyPnL: this.dailyPnL,
      dailyTradeCount: this.dailyTradeCount,
      maxDrawdown: this.maxDrawdown,
      peakEquity: this.peakEquity,
      currentExposure: this.orderExecutor.getTotalExposure(),
      riskLimits: this.riskLimits,
    };
  }
}
