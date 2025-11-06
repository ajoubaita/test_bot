import { logger } from '../utils/logger';
import { MarketWithVolume } from '../polymarket/market-scanner';
import { KalshiMarket } from './client';

export interface MarketPair {
  polymarketMarket: MarketWithVolume;
  kalshiMarket: KalshiMarket;
  similarityScore: number;
}

export class MarketMatcher {
  /**
   * Find matching markets between Polymarket and Kalshi
   * Uses fuzzy string matching on market titles
   */
  findMatches(
    polymarketMarkets: MarketWithVolume[],
    kalshiMarkets: KalshiMarket[],
    minSimilarity: number = 0.7
  ): MarketPair[] {
    const matches: MarketPair[] = [];

    for (const pmMarket of polymarketMarkets) {
      const pmTitle = this.normalizeTitle(pmMarket.question);

      for (const kalshiMarket of kalshiMarkets) {
        const kalshiTitle = this.normalizeTitle(kalshiMarket.title);

        const similarity = this.calculateSimilarity(pmTitle, kalshiTitle);

        if (similarity >= minSimilarity) {
          matches.push({
            polymarketMarket: pmMarket,
            kalshiMarket: kalshiMarket,
            similarityScore: similarity,
          });
        }
      }
    }

    // Sort by similarity score descending
    matches.sort((a, b) => b.similarityScore - a.similarityScore);

    logger.info(`Found ${matches.length} potential market matches`, {
      minSimilarity,
      topMatches: matches.slice(0, 3).map(m => ({
        polymarket: m.polymarketMarket.question.substring(0, 50),
        kalshi: m.kalshiMarket.title.substring(0, 50),
        similarity: m.similarityScore.toFixed(2),
      })),
    });

    return matches;
  }

  /**
   * Normalize market title for comparison
   * - Convert to lowercase
   * - Remove punctuation
   * - Remove common words
   * - Standardize keywords
   */
  private normalizeTitle(title: string): string {
    let normalized = title.toLowerCase();

    // Remove punctuation
    normalized = normalized.replace(/[^\w\s]/g, ' ');

    // Standardize common variations
    const replacements: { [key: string]: string } = {
      'bitcoin': 'btc',
      'president': 'pres',
      'presidential': 'pres',
      'election': 'elect',
      'win': 'winner',
      'wins': 'winner',
      'january': 'jan',
      'february': 'feb',
      'march': 'mar',
      'april': 'apr',
      'june': 'jun',
      'july': 'jul',
      'august': 'aug',
      'september': 'sep',
      'october': 'oct',
      'november': 'nov',
      'december': 'dec',
      '2024': '24',
      '2025': '25',
    };

    for (const [from, to] of Object.entries(replacements)) {
      normalized = normalized.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
    }

    // Remove common words that don't affect meaning
    const stopWords = ['will', 'be', 'the', 'a', 'an', 'by', 'on', 'in', 'at', 'to', 'for', 'of', 'and', 'or'];
    const words = normalized.split(/\s+/).filter(word => !stopWords.includes(word) && word.length > 0);

    return words.join(' ');
  }

  /**
   * Calculate Jaccard similarity between two normalized titles
   * Jaccard = (intersection size) / (union size)
   */
  private calculateSimilarity(title1: string, title2: string): number {
    const words1 = new Set(title1.split(/\s+/));
    const words2 = new Set(title2.split(/\s+/));

    // Calculate intersection
    const intersection = new Set([...words1].filter(word => words2.has(word)));

    // Calculate union
    const union = new Set([...words1, ...words2]);

    if (union.size === 0) return 0;

    return intersection.size / union.size;
  }

  /**
   * Find exact matches by looking for common identifiers
   * (e.g., ticker symbols, event codes, specific dates)
   */
  findExactMatches(
    polymarketMarkets: MarketWithVolume[],
    kalshiMarkets: KalshiMarket[]
  ): MarketPair[] {
    const matches: MarketPair[] = [];

    // Extract key identifiers (tickers, dates, names)
    const identifierPattern = /\b([A-Z]{3,5}|\d{4}-\d{2}-\d{2}|Trump|Biden|Bitcoin|Ethereum)\b/gi;

    for (const pmMarket of polymarketMarkets) {
      const pmIdentifiers = new Set(
        (pmMarket.question.match(identifierPattern) || []).map(id => id.toLowerCase())
      );

      if (pmIdentifiers.size === 0) continue;

      for (const kalshiMarket of kalshiMarkets) {
        const kalshiIdentifiers = new Set(
          (kalshiMarket.title.match(identifierPattern) || []).map(id => id.toLowerCase())
        );

        // Check if they share at least 2 identifiers
        const commonIdentifiers = new Set(
          [...pmIdentifiers].filter(id => kalshiIdentifiers.has(id))
        );

        if (commonIdentifiers.size >= 2) {
          matches.push({
            polymarketMarket: pmMarket,
            kalshiMarket: kalshiMarket,
            similarityScore: 1.0, // Exact match
          });
        }
      }
    }

    logger.info(`Found ${matches.length} exact market matches`);
    return matches;
  }
}
