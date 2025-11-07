import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

export interface TrackedOpportunity {
  timestamp: number;
  type: 'cross-market' | 'same-platform';
  matchQuality: 'HIGH' | 'MEDIUM' | 'LOW';
  similarityScore?: number;

  // Markets
  platform1: string;
  platform2?: string;
  market1: string;
  market2?: string;

  // Prices
  buyPlatform: string;
  sellPlatform: string;
  buyPrice: number;
  sellPrice: number;
  spread: number;

  // Expected returns
  expectedGrossProfit: number;
  expectedGrossReturn: number;

  // Actual execution (if executed)
  executed: boolean;
  actualProfit?: number;
  actualReturn?: number;
  executionError?: string;
}

export class OpportunityTracker {
  private opportunities: TrackedOpportunity[] = [];
  private readonly maxHistorySize = 1000; // Keep last 1000 opportunities
  private readonly logFilePath: string;

  constructor(logDirectory: string = 'logs') {
    this.logFilePath = path.join(logDirectory, 'opportunities.jsonl');

    // Ensure log directory exists
    if (!fs.existsSync(logDirectory)) {
      fs.mkdirSync(logDirectory, { recursive: true });
    }

    logger.info('📊 Opportunity tracker initialized', {
      logFilePath: this.logFilePath,
    });
  }

  /**
   * Track a detected opportunity
   */
  trackOpportunity(opportunity: TrackedOpportunity): void {
    // Add to in-memory history
    this.opportunities.push(opportunity);

    // Keep only recent opportunities in memory
    if (this.opportunities.length > this.maxHistorySize) {
      this.opportunities.shift();
    }

    // Append to log file (JSONL format - one JSON object per line)
    try {
      const logLine = JSON.stringify(opportunity) + '\n';
      fs.appendFileSync(this.logFilePath, logLine);
    } catch (error) {
      logger.error('Failed to write opportunity to log file', { error });
    }
  }

  /**
   * Get statistics about tracked opportunities
   */
  getStats(): {
    totalOpportunities: number;
    byType: { [key: string]: number };
    byQuality: { [key: string]: number };
    avgGrossReturn: number;
    executedCount: number;
    avgActualReturn: number;
    successRate: number;
  } {
    const stats = {
      totalOpportunities: this.opportunities.length,
      byType: {} as { [key: string]: number },
      byQuality: {} as { [key: string]: number },
      avgGrossReturn: 0,
      executedCount: 0,
      avgActualReturn: 0,
      successRate: 0,
    };

    if (this.opportunities.length === 0) {
      return stats;
    }

    // Count by type
    for (const opp of this.opportunities) {
      stats.byType[opp.type] = (stats.byType[opp.type] || 0) + 1;
      stats.byQuality[opp.matchQuality] = (stats.byQuality[opp.matchQuality] || 0) + 1;
    }

    // Calculate average gross return
    const totalGrossReturn = this.opportunities.reduce((sum, opp) => sum + opp.expectedGrossReturn, 0);
    stats.avgGrossReturn = totalGrossReturn / this.opportunities.length;

    // Calculate execution stats
    const executed = this.opportunities.filter(opp => opp.executed);
    stats.executedCount = executed.length;

    if (executed.length > 0) {
      const totalActualReturn = executed.reduce((sum, opp) => sum + (opp.actualReturn || 0), 0);
      stats.avgActualReturn = totalActualReturn / executed.length;

      const successful = executed.filter(opp => (opp.actualProfit || 0) > 0);
      stats.successRate = successful.length / executed.length;
    }

    return stats;
  }

  /**
   * Get recent opportunities
   */
  getRecentOpportunities(count: number = 10): TrackedOpportunity[] {
    return this.opportunities.slice(-count);
  }

  /**
   * Analyze whether opportunities are truly profitable
   * Returns distribution of expected vs actual returns
   */
  analyzeReturnAccuracy(): {
    averageOverestimation: number;
    medianOverestimation: number;
    rmse: number; // Root mean squared error
    sampleSize: number;
  } {
    const executedWithActual = this.opportunities.filter(
      opp => opp.executed && opp.actualReturn !== undefined
    );

    if (executedWithActual.length === 0) {
      return {
        averageOverestimation: 0,
        medianOverestimation: 0,
        rmse: 0,
        sampleSize: 0,
      };
    }

    // Calculate overestimation (expected - actual)
    const overestimations = executedWithActual.map(
      opp => opp.expectedGrossReturn - opp.actualReturn!
    );

    const avgOverestimation = overestimations.reduce((a, b) => a + b, 0) / overestimations.length;

    const sortedOverestimations = overestimations.sort((a, b) => a - b);
    const medianOverestimation = sortedOverestimations[Math.floor(sortedOverestimations.length / 2)];

    const squaredErrors = overestimations.map(e => e * e);
    const rmse = Math.sqrt(squaredErrors.reduce((a, b) => a + b, 0) / squaredErrors.length);

    return {
      averageOverestimation: avgOverestimation,
      medianOverestimation: medianOverestimation,
      rmse: rmse,
      sampleSize: executedWithActual.length,
    };
  }

  /**
   * Generate a summary report
   */
  generateReport(): string {
    const stats = this.getStats();
    const accuracy = this.analyzeReturnAccuracy();
    const recent = this.getRecentOpportunities(5);

    let report = '=== OPPORTUNITY TRACKER REPORT ===\n\n';

    report += '📊 Overall Statistics:\n';
    report += `  Total opportunities detected: ${stats.totalOpportunities}\n`;
    report += `  Average expected gross return: ${(stats.avgGrossReturn * 100).toFixed(2)}%\n`;
    report += `  Executed: ${stats.executedCount}\n`;
    if (stats.executedCount > 0) {
      report += `  Average actual return: ${(stats.avgActualReturn * 100).toFixed(2)}%\n`;
      report += `  Success rate: ${(stats.successRate * 100).toFixed(2)}%\n`;
    }
    report += '\n';

    report += '📈 By Type:\n';
    for (const [type, count] of Object.entries(stats.byType)) {
      report += `  ${type}: ${count}\n`;
    }
    report += '\n';

    report += '🎯 By Match Quality:\n';
    for (const [quality, count] of Object.entries(stats.byQuality)) {
      report += `  ${quality}: ${count}\n`;
    }
    report += '\n';

    if (accuracy.sampleSize > 0) {
      report += '🔍 Return Accuracy Analysis:\n';
      report += `  Sample size: ${accuracy.sampleSize}\n`;
      report += `  Average overestimation: ${(accuracy.averageOverestimation * 100).toFixed(2)}%\n`;
      report += `  Median overestimation: ${(accuracy.medianOverestimation * 100).toFixed(2)}%\n`;
      report += `  RMSE: ${(accuracy.rmse * 100).toFixed(2)}%\n`;
      report += '\n';
    }

    report += '📝 Recent Opportunities (Last 5):\n';
    for (const opp of recent) {
      report += `  [${new Date(opp.timestamp).toISOString()}] ${opp.matchQuality} quality\n`;
      report += `    ${opp.type}: ${opp.buyPlatform} → ${opp.sellPlatform}\n`;
      report += `    Expected: ${(opp.expectedGrossReturn * 100).toFixed(2)}%`;
      if (opp.executed && opp.actualReturn !== undefined) {
        report += ` | Actual: ${(opp.actualReturn * 100).toFixed(2)}%`;
      }
      report += '\n';
    }

    return report;
  }
}
