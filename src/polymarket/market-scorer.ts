import { MarketWithVolume } from './market-scanner';
import { logger } from '../utils/logger';

export interface ScoredMarket extends MarketWithVolume {
  score: number;
  reason: string;
}

export class MarketScorer {
  /**
   * Score markets based on arbitrage opportunity potential using spread-based prioritization
   * Formula: Priority = (Bid-Ask Spread × Volume) / 100
   * Higher score = more likely to have arbitrage opportunities
   */
  scoreMarket(market: MarketWithVolume): ScoredMarket {
    let score = 0;
    let reasons: string[] = [];

    // Spread-based scoring (Strategy A)
    // Markets with wider spreads have more arbitrage potential
    if (market.spread && market.spread > 0) {
      // Priority = (Spread × Volume) / 100
      score = (market.spread * market.volume) / 100;

      if (market.spread > 0.05) {
        reasons.push('wide-spread');
      }
      if (market.volume > 50000) {
        reasons.push('high-volume');
      }
    } else {
      // Fallback to volume-based scoring if spread not available
      score = market.volume / 1000;
      reasons.push('volume-only');
    }

    // Bonus for binary markets (easier to arbitrage)
    if (market.outcomes.length === 2) {
      score *= 1.2; // 20% bonus
      reasons.push('binary-market');
    }

    // Bonus for markets ending soon (more volatility)
    if (market.endDate) {
      try {
        const endDate = new Date(market.endDate);
        const now = new Date();
        const daysUntilEnd = (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

        if (daysUntilEnd <= 7) {
          score *= 1.3; // 30% bonus for markets ending within 7 days
          reasons.push('ending-soon');
        }
      } catch (e) {
        // Ignore date parsing errors
      }
    }

    return {
      ...market,
      score: Math.round(score * 100) / 100,
      reason: reasons.join(', '),
    };
  }

  private getVolumeScore(volume: number): number {
    // Optimal volume is in the middle of our range
    const minVolume = 10000;
    const maxVolume = 100000;
    const optimalVolume = 50000;

    if (volume < minVolume || volume > maxVolume) return 0;

    // Distance from optimal
    const distance = Math.abs(volume - optimalVolume);
    const maxDistance = optimalVolume - minVolume;

    return 1 - (distance / maxDistance);
  }

  private estimateVolatilityScore(market: MarketWithVolume): number {
    // Markets with certain keywords tend to be more volatile
    const question = market.question.toLowerCase();
    const volatileKeywords = [
      'election', 'debate', 'price', 'launch', 'release',
      'win', 'lose', 'beat', 'reach', 'hit', 'exceed',
      'crypto', 'stock', 'market', 'economy'
    ];

    let matches = 0;
    for (const keyword of volatileKeywords) {
      if (question.includes(keyword)) matches++;
    }

    return Math.min(matches / 3, 1); // Max score at 3+ keywords
  }

  private getRecencyScore(market: MarketWithVolume): number {
    // Newer markets tend to be more active
    // This is a simplified heuristic - in production we'd use actual creation date
    // For now, higher volume relative to historical = more recent activity
    return market.volume24h > market.volume * 0.8 ? 1 : 0.5;
  }

  /**
   * Score and rank all markets, return top N
   * Note: Markets should have spreads pre-calculated before calling this
   */
  selectTopMarkets(markets: MarketWithVolume[], topN: number): ScoredMarket[] {
    logger.info(`Scoring ${markets.length} markets with spread-based algorithm...`);

    const scoredMarkets = markets.map(m => this.scoreMarket(m));

    // Sort by score descending
    scoredMarkets.sort((a, b) => b.score - a.score);

    const topMarkets = scoredMarkets.slice(0, topN);

    logger.info(`Selected top ${topMarkets.length} markets using spread-based scoring`, {
      avgScore: (topMarkets.reduce((sum, m) => sum + m.score, 0) / topMarkets.length).toFixed(2),
      topScore: topMarkets[0]?.score,
      bottomScore: topMarkets[topMarkets.length - 1]?.score,
    });

    // Log top 5 markets
    logger.info('Top 5 markets by spread-based score:', {
      markets: topMarkets.slice(0, 5).map(m => ({
        question: m.question.substring(0, 50) + '...',
        volume: `$${Math.round(m.volume).toLocaleString()}`,
        spread: m.spread?.toFixed(4) || 'N/A',
        score: m.score,
        reason: m.reason,
      })),
    });

    return topMarkets;
  }
}
