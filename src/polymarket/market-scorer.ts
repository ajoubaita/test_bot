import { MarketWithVolume } from './market-scanner';
import { logger } from '../utils/logger';

export interface ScoredMarket extends MarketWithVolume {
  score: number;
  reason: string;
}

export class MarketScorer {
  /**
   * Score markets based on arbitrage opportunity potential
   * Higher score = more likely to have arbitrage opportunities
   */
  scoreMarket(market: MarketWithVolume): ScoredMarket {
    let score = 0;
    let reasons: string[] = [];

    // Volume score (sweet spot is our target range)
    const volumeScore = this.getVolumeScore(market.volume);
    score += volumeScore * 40; // 40% weight
    if (volumeScore > 0.7) {
      reasons.push('optimal-volume');
    }

    // Volatility indicator (markets near 0.5 probability have more arbitrage potential)
    // We'll estimate this from the market question for now
    const volatilityScore = this.estimateVolatilityScore(market);
    score += volatilityScore * 30; // 30% weight
    if (volatilityScore > 0.7) {
      reasons.push('high-volatility');
    }

    // Market type score (binary markets easier for arbitrage)
    const typeScore = market.outcomes.length === 2 ? 1 : 0.5;
    score += typeScore * 20; // 20% weight
    if (typeScore === 1) {
      reasons.push('binary-market');
    }

    // Recency boost (newer markets more active)
    const recencyScore = this.getRecencyScore(market);
    score += recencyScore * 10; // 10% weight

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
   */
  selectTopMarkets(markets: MarketWithVolume[], topN: number): ScoredMarket[] {
    logger.info(`Scoring ${markets.length} markets...`);

    const scoredMarkets = markets.map(m => this.scoreMarket(m));

    // Sort by score descending
    scoredMarkets.sort((a, b) => b.score - a.score);

    const topMarkets = scoredMarkets.slice(0, topN);

    logger.info(`Selected top ${topMarkets.length} markets`, {
      avgScore: (topMarkets.reduce((sum, m) => sum + m.score, 0) / topMarkets.length).toFixed(2),
      topScore: topMarkets[0]?.score,
      bottomScore: topMarkets[topMarkets.length - 1]?.score,
    });

    // Log top 5 markets
    logger.info('Top 5 markets by score:', {
      markets: topMarkets.slice(0, 5).map(m => ({
        question: m.question.substring(0, 50) + '...',
        volume: `$${Math.round(m.volume).toLocaleString()}`,
        score: m.score,
        reason: m.reason,
      })),
    });

    return topMarkets;
  }
}
