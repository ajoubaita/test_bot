import { logger } from '../utils/logger';
import { MarketWithVolume } from '../polymarket/market-scanner';
import { KalshiMarket } from './client';

export interface MarketPair {
  polymarketMarket: MarketWithVolume;
  kalshiMarket: KalshiMarket;
  similarityScore: number;
  matchReason: string;
}

export class MarketMatcher {
  /**
   * Find matching markets between Polymarket and Kalshi using multiple strategies
   * AGGRESSIVE matching to maximize arbitrage opportunities
   */
  findMatches(
    polymarketMarkets: MarketWithVolume[],
    kalshiMarkets: KalshiMarket[],
    minSimilarity: number = 0.3  // Lowered from 0.7 to 0.3 for broader coverage
  ): MarketPair[] {
    logger.info(`Starting aggressive market matching...`, {
      polymarketCount: polymarketMarkets.length,
      kalshiCount: kalshiMarkets.length,
      minSimilarity,
    });

    const allMatches: MarketPair[] = [];

    for (const pmMarket of polymarketMarkets) {
      for (const kalshiMarket of kalshiMarkets) {
        // Try multiple matching strategies
        const match = this.matchMarkets(pmMarket, kalshiMarket, minSimilarity);
        if (match) {
          allMatches.push(match);
        }
      }
    }

    // Deduplicate: Keep highest score for each Polymarket-Kalshi pair
    const uniqueMatches = new Map<string, MarketPair>();
    for (const match of allMatches) {
      const key = `${match.polymarketMarket.id}-${match.kalshiMarket.ticker}`;
      const existing = uniqueMatches.get(key);
      if (!existing || match.similarityScore > existing.similarityScore) {
        uniqueMatches.set(key, match);
      }
    }

    const matches = Array.from(uniqueMatches.values());
    matches.sort((a, b) => b.similarityScore - a.similarityScore);

    logger.info(`✅ Found ${matches.length} total market matches`, {
      minSimilarity,
      exactMatches: matches.filter(m => m.similarityScore >= 0.9).length,
      strongMatches: matches.filter(m => m.similarityScore >= 0.6 && m.similarityScore < 0.9).length,
      weakMatches: matches.filter(m => m.similarityScore < 0.6).length,
      topMatches: matches.slice(0, 5).map(m => ({
        polymarket: m.polymarketMarket.question.substring(0, 40),
        kalshi: m.kalshiMarket.title.substring(0, 40),
        similarity: m.similarityScore.toFixed(2),
        reason: m.matchReason,
      })),
    });

    return matches;
  }

  /**
   * Multi-strategy matching: tries all strategies and picks best score
   */
  private matchMarkets(
    pmMarket: MarketWithVolume,
    kalshiMarket: KalshiMarket,
    minSimilarity: number
  ): MarketPair | null {
    // CRITICAL: Reject matches between incompatible categories
    // Prevents false positives like crypto vs sports
    const pmCategory = this.inferCategory(pmMarket.question);
    const kalshiCategory = kalshiMarket.category?.toLowerCase() || this.inferCategory(kalshiMarket.title);

    if (pmCategory && kalshiCategory && pmCategory !== kalshiCategory) {
      // Different categories = definitely not the same event
      return null;
    }

    let bestScore = 0;
    let bestReason = '';

    // Strategy 1: Exact identifier matching (highest priority)
    const exactScore = this.exactIdentifierMatch(pmMarket.question, kalshiMarket.title);
    if (exactScore > bestScore) {
      bestScore = exactScore;
      bestReason = 'exact-identifier-match';
    }

    // Strategy 2: Keyword-based matching
    const keywordScore = this.keywordMatch(pmMarket.question, kalshiMarket.title);
    if (keywordScore > bestScore) {
      bestScore = keywordScore;
      bestReason = 'keyword-match';
    }

    // Strategy 3: Normalized Jaccard similarity
    const jaccardScore = this.jaccardSimilarity(pmMarket.question, kalshiMarket.title);
    if (jaccardScore > bestScore) {
      bestScore = jaccardScore;
      bestReason = 'jaccard-similarity';
    }

    // Strategy 4: Numeric value matching (prices, dates, percentages)
    const numericScore = this.numericMatch(pmMarket.question, kalshiMarket.title);
    if (numericScore > bestScore) {
      bestScore = numericScore;
      bestReason = 'numeric-match';
    }

    // Strategy 5: Category matching (both in same category)
    const categoryScore = this.categoryMatch(pmMarket, kalshiMarket);
    if (categoryScore > 0) {
      // Boost score if categories align
      bestScore = Math.min(1.0, bestScore * 1.2);
      bestReason += '+category-boost';
    }

    // Accept if above minimum threshold
    if (bestScore >= minSimilarity) {
      return {
        polymarketMarket: pmMarket,
        kalshiMarket: kalshiMarket,
        similarityScore: bestScore,
        matchReason: bestReason,
      };
    }

    return null;
  }

  /**
   * Strategy 1: Exact identifier matching
   * Look for specific entities (Bitcoin, Trump, specific dates, tickers)
   */
  private exactIdentifierMatch(title1: string, title2: string): number {
    // Extract important identifiers
    const identifiers = /\b(bitcoin|btc|ethereum|eth|trump|biden|harris|[A-Z]{3,5}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d+k|\$\d+)/gi;

    const ids1 = new Set((title1.match(identifiers) || []).map(id => id.toLowerCase()));
    const ids2 = new Set((title2.match(identifiers) || []).map(id => id.toLowerCase()));

    if (ids1.size === 0 || ids2.size === 0) return 0;

    const intersection = new Set([...ids1].filter(id => ids2.has(id)));

    // If they share 3+ identifiers, it's almost certainly the same event
    if (intersection.size >= 3) return 1.0;
    if (intersection.size >= 2) return 0.85;
    if (intersection.size >= 1) return 0.6;

    return 0;
  }

  /**
   * Strategy 2: Keyword matching
   * Extract important keywords and check overlap
   */
  private keywordMatch(title1: string, title2: string): number {
    const keywords1 = this.extractKeywords(title1);
    const keywords2 = this.extractKeywords(title2);

    if (keywords1.size === 0 || keywords2.size === 0) return 0;

    const intersection = new Set([...keywords1].filter(kw => keywords2.has(kw)));
    const union = new Set([...keywords1, ...keywords2]);

    // Jaccard on keywords
    return intersection.size / union.size;
  }

  /**
   * Extract important keywords (nouns, numbers, names)
   */
  private extractKeywords(title: string): Set<string> {
    let normalized = title.toLowerCase();

    // Standardize common variations
    const replacements: { [key: string]: string } = {
      'bitcoin': 'btc',
      'ethereum': 'eth',
      'president': 'pres',
      'presidential': 'pres',
      'election': 'elect',
      'win': 'winner',
      'wins': 'winner',
      'winning': 'winner',
      'reach': 'hit',
      'reaches': 'hit',
      'january': 'jan', 'february': 'feb', 'march': 'mar',
      'april': 'apr', 'june': 'jun', 'july': 'jul',
      'august': 'aug', 'september': 'sep', 'october': 'oct',
      'november': 'nov', 'december': 'dec',
      '2024': '24', '2025': '25', '2026': '26',
      'thousand': 'k', 'million': 'm', 'billion': 'b',
    };

    for (const [from, to] of Object.entries(replacements)) {
      normalized = normalized.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
    }

    // Remove punctuation but keep numbers and $
    normalized = normalized.replace(/[^\w\s\$]/g, ' ');

    // Stop words to remove
    const stopWords = new Set(['will', 'be', 'the', 'a', 'an', 'by', 'on', 'in', 'at',
                                'to', 'for', 'of', 'and', 'or', 'is', 'are', 'was',
                                'were', 'have', 'has', 'had', 'do', 'does', 'did']);

    const words = normalized.split(/\s+/)
      .filter(word => word.length > 1 && !stopWords.has(word));

    return new Set(words);
  }

  /**
   * Strategy 3: Traditional Jaccard similarity
   */
  private jaccardSimilarity(title1: string, title2: string): number {
    const words1 = this.extractKeywords(title1);
    const words2 = this.extractKeywords(title2);

    if (words1.size === 0 || words2.size === 0) return 0;

    const intersection = new Set([...words1].filter(word => words2.has(word)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * Strategy 4: Numeric value matching
   * Match specific numbers (prices, dates, percentages)
   */
  private numericMatch(title1: string, title2: string): number {
    // Extract all numbers (including those with k, m, b suffixes and $)
    const numPattern = /\$?\d+(\.\d+)?[kmb]?%?/gi;

    const nums1 = new Set((title1.match(numPattern) || []).map(n => n.toLowerCase()));
    const nums2 = new Set((title2.match(numPattern) || []).map(n => n.toLowerCase()));

    if (nums1.size === 0 || nums2.size === 0) return 0;

    const intersection = new Set([...nums1].filter(n => nums2.has(n)));

    // If they share 2+ specific numbers, likely same event
    if (intersection.size >= 2) return 0.8;
    if (intersection.size >= 1) return 0.5;

    return 0;
  }

  /**
   * Strategy 5: Category matching
   * Boost score if markets are in same category
   */
  private categoryMatch(pmMarket: MarketWithVolume, kalshiMarket: KalshiMarket): number {
    // Simple heuristic: check if categories/topics align
    // This is a bonus multiplier, not a standalone score

    const pmCategory = this.inferCategory(pmMarket.question);
    const kalshiCategory = kalshiMarket.category?.toLowerCase() || this.inferCategory(kalshiMarket.title);

    if (pmCategory && kalshiCategory && pmCategory === kalshiCategory) {
      return 0.1; // Small boost
    }

    return 0;
  }

  /**
   * Infer category from title
   */
  private inferCategory(title: string): string | null {
    const lower = title.toLowerCase();

    // Crypto: coins, tokens, airdrops, DeFi
    if (lower.includes('bitcoin') || lower.includes('btc') || lower.includes('crypto') ||
        lower.includes('ethereum') || lower.includes('eth') || lower.includes('airdrop') ||
        lower.includes('token') || lower.includes('solana') || lower.includes('defi') ||
        lower.includes('blockchain')) {
      return 'crypto';
    }

    // Sports: NFL, NBA, player names, yards, touchdowns, games
    if (lower.includes('nfl') || lower.includes('nba') || lower.includes('mlb') ||
        lower.includes('nhl') || lower.includes('touchdown') || lower.includes('yards') ||
        lower.includes('points scored') || lower.includes('game') || lower.includes('win') ||
        lower.includes('broncos') || lower.includes('chiefs') || lower.includes('lakers') ||
        lower.includes('celtics') || lower.includes('super bowl')) {
      return 'sports';
    }

    // Politics: elections, politicians, government
    if (lower.includes('trump') || lower.includes('biden') || lower.includes('election') ||
        lower.includes('president') || lower.includes('congress') || lower.includes('senate') ||
        lower.includes('harris') || lower.includes('governor')) {
      return 'politics';
    }

    // Finance: stocks, indices, markets, GDP
    if (lower.includes('stock') || lower.includes('s&p') || lower.includes('dow') ||
        lower.includes('nasdaq') || lower.includes('gdp') || lower.includes('recession') ||
        lower.includes('fed') || lower.includes('interest rate')) {
      return 'finance';
    }

    // Weather: temperature, precipitation, climate
    if (lower.includes('temperature') || lower.includes('weather') || lower.includes('climate') ||
        lower.includes('snow') || lower.includes('rain') || lower.includes('hurricane')) {
      return 'weather';
    }

    return null;
  }

  /**
   * Legacy method for backward compatibility
   */
  findExactMatches(
    polymarketMarkets: MarketWithVolume[],
    kalshiMarkets: KalshiMarket[]
  ): MarketPair[] {
    // This is now handled by the main findMatches method
    // with exactIdentifierMatch strategy
    return this.findMatches(polymarketMarkets, kalshiMarkets, 0.8);
  }
}
