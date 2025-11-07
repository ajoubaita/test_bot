import { logger } from '../utils/logger';
import { MarketWithVolume } from '../polymarket/market-scanner';
import { KalshiMarket } from './client';

export interface MarketPair {
  polymarketMarket: MarketWithVolume;
  kalshiMarket: KalshiMarket;
  similarityScore: number;
  matchReason: string;
}

/**
 * Enhanced market matcher with detailed entity recognition and normalization
 * "The devil is in the details" - precise matching prevents false positives
 */
export class EnhancedMarketMatcher {
  /**
   * Normalize numeric values for comparison
   * $100k, $100,000, 100K, 100000 all become "100000"
   */
  private normalizeNumber(text: string): string {
    return text
      .toLowerCase()
      .replace(/\$/, '')
      .replace(/,/g, '')
      .replace(/(\d+)k\b/gi, (_, num) => String(parseFloat(num) * 1000))
      .replace(/(\d+)m\b/gi, (_, num) => String(parseFloat(num) * 1000000))
      .replace(/(\d+)b\b/gi, (_, num) => String(parseFloat(num) * 1000000000));
  }

  /**
   * Extract and normalize all numbers from text
   */
  private extractNumbers(text: string): Set<string> {
    const normalized = this.normalizeNumber(text);
    const numbers = normalized.match(/\d+(\.\d+)?/g) || [];
    return new Set(numbers);
  }

  /**
   * Extract dates and normalize to YYYY-MM-DD format
   */
  private extractDates(text: string): Set<string> {
    const dates = new Set<string>();

    // Match YYYY-MM-DD
    const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/g);
    if (iso) iso.forEach(d => dates.add(d));

    // Match MM/DD/YYYY or MM/DD/YY
    const usFormat = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g);
    if (usFormat) {
      usFormat.forEach(d => {
        const [month, day, year] = d.split('/');
        const fullYear = year.length === 2 ? `20${year}` : year;
        dates.add(`${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
      });
    }

    // Match "Dec 31, 2025" or "December 31 2025"
    const monthNames: { [key: string]: string } = {
      'jan': '01', 'january': '01',
      'feb': '02', 'february': '02',
      'mar': '03', 'march': '03',
      'apr': '04', 'april': '04',
      'may': '05',
      'jun': '06', 'june': '06',
      'jul': '07', 'july': '07',
      'aug': '08', 'august': '08',
      'sep': '09', 'sept': '09', 'september': '09',
      'oct': '10', 'october': '10',
      'nov': '11', 'november': '11',
      'dec': '12', 'december': '12',
    };

    const lower = text.toLowerCase();
    for (const [monthName, monthNum] of Object.entries(monthNames)) {
      const pattern = new RegExp(`\\b${monthName}\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'gi');
      const matches = lower.matchAll(pattern);
      for (const match of matches) {
        const day = match[1].padStart(2, '0');
        const year = match[2];
        dates.add(`${year}-${monthNum}-${day}`);
      }
    }

    return dates;
  }

  /**
   * Extract known entities (people, teams, companies, coins)
   */
  private extractEntities(text: string): Set<string> {
    const entities = new Set<string>();
    const lower = text.toLowerCase();

    // Politicians
    const politicians = ['trump', 'biden', 'harris', 'desantis', 'newsom', 'obama', 'clinton', 'pence'];
    politicians.forEach(p => {
      if (lower.includes(p)) entities.add(p);
    });

    // Cryptocurrencies (with normalization)
    const cryptoMap: { [key: string]: string } = {
      'bitcoin': 'btc',
      'btc': 'btc',
      'ethereum': 'eth',
      'eth': 'eth',
      'solana': 'sol',
      'sol': 'sol',
      'cardano': 'ada',
      'ada': 'ada',
    };
    for (const [name, symbol] of Object.entries(cryptoMap)) {
      if (lower.includes(name)) entities.add(symbol);
    }

    // NFL teams (city or nickname)
    const nflTeams = ['chiefs', 'broncos', 'raiders', 'chargers', 'patriots', 'bills',
                      '49ers', 'rams', 'seahawks', 'cowboys', 'eagles', 'packers'];
    nflTeams.forEach(team => {
      if (lower.includes(team)) entities.add(`nfl:${team}`);
    });

    // NBA teams
    const nbaTeams = ['lakers', 'celtics', 'warriors', 'heat', 'knicks', 'nets', 'bulls'];
    nbaTeams.forEach(team => {
      if (lower.includes(team)) entities.add(`nba:${team}`);
    });

    // Companies/Stocks
    const companies = ['apple', 'google', 'amazon', 'tesla', 'microsoft', 'meta', 'nvidia'];
    companies.forEach(co => {
      if (lower.includes(co)) entities.add(`stock:${co}`);
    });

    // Events
    if (lower.includes('super bowl')) entities.add('event:superbowl');
    if (lower.includes('world series')) entities.add('event:worldseries');
    if (lower.includes('nba finals')) entities.add('event:nbafinals');
    if (lower.includes('election')) entities.add('event:election');
    if (lower.includes('airdrop')) entities.add('event:airdrop');

    return entities;
  }

  /**
   * Extract price targets (e.g., "Bitcoin $100k", "above $50,000")
   */
  private extractPriceTargets(text: string): Set<string> {
    const targets = new Set<string>();

    // Match patterns like "$100k", "$100,000", "100k", etc.
    const pricePattern = /\$?\d+[,\d]*\.?\d*[kmb]?/gi;
    const prices = text.match(pricePattern) || [];

    prices.forEach(price => {
      const normalized = this.normalizeNumber(price);
      const numMatch = normalized.match(/\d+/);
      if (numMatch) {
        targets.add(numMatch[0]);
      }
    });

    return targets;
  }

  /**
   * Smart matching with detailed entity and numeric extraction
   */
  match(pmMarket: MarketWithVolume, kalshiMarket: KalshiMarket, minSimilarity: number): MarketPair | null {
    // Category filter (CRITICAL - prevents crypto/sports mixing)
    const pmCategory = this.inferCategory(pmMarket.question);
    const kalshiCategory = kalshiMarket.category?.toLowerCase() || this.inferCategory(kalshiMarket.title);

    if (pmCategory && kalshiCategory && pmCategory !== kalshiCategory) {
      return null; // Different categories = NOT the same event
    }

    const pmText = pmMarket.question;
    const kalshiText = kalshiMarket.title;

    let score = 0;
    let reason = '';

    // 1. Entity Matching (highest weight)
    const pmEntities = this.extractEntities(pmText);
    const kalshiEntities = this.extractEntities(kalshiText);
    const entityIntersection = new Set([...pmEntities].filter(e => kalshiEntities.has(e)));

    if (pmEntities.size > 0 && kalshiEntities.size > 0) {
      const entitySimilarity = entityIntersection.size / Math.max(pmEntities.size, kalshiEntities.size);
      if (entitySimilarity >= 0.5) {
        score = Math.max(score, 0.6 + (entitySimilarity * 0.3));
        reason = 'entity-match';
      }
    }

    // 2. Date Matching (very high confidence)
    const pmDates = this.extractDates(pmText);
    const kalshiDates = this.extractDates(kalshiText);
    const dateIntersection = new Set([...pmDates].filter(d => kalshiDates.has(d)));

    if (dateIntersection.size > 0 && pmDates.size > 0 && kalshiDates.size > 0) {
      // Same date = high confidence same event
      score = Math.max(score, 0.8);
      reason = reason ? `${reason}+date` : 'date-match';
    }

    // 3. Price Target Matching (for financial/crypto markets)
    if (pmCategory === 'crypto' || pmCategory === 'finance') {
      const pmPrices = this.extractPriceTargets(pmText);
      const kalshiPrices = this.extractPriceTargets(kalshiText);
      const priceIntersection = new Set([...pmPrices].filter(p => kalshiPrices.has(p)));

      if (priceIntersection.size > 0 && pmPrices.size > 0 && kalshiPrices.size > 0) {
        score = Math.max(score, 0.75);
        reason = reason ? `${reason}+price` : 'price-target-match';
      }
    }

    // 4. Numeric Matching (dates, percentages, thresholds)
    const pmNumbers = this.extractNumbers(pmText);
    const kalshiNumbers = this.extractNumbers(kalshiText);
    const numberIntersection = new Set([...pmNumbers].filter(n => kalshiNumbers.has(n)));

    if (numberIntersection.size >= 2 && pmNumbers.size > 0 && kalshiNumbers.size > 0) {
      score = Math.max(score, 0.7);
      reason = reason ? `${reason}+numeric` : 'multi-numeric-match';
    }

    // 5. Keyword Jaccard (fallback)
    const pmKeywords = this.extractKeywords(pmText);
    const kalshiKeywords = this.extractKeywords(kalshiText);
    const keywordIntersection = new Set([...pmKeywords].filter(k => kalshiKeywords.has(k)));
    const keywordUnion = new Set([...pmKeywords, ...kalshiKeywords]);

    if (keywordUnion.size > 0) {
      const jaccardScore = keywordIntersection.size / keywordUnion.size;
      if (jaccardScore > score) {
        score = jaccardScore;
        reason = 'keyword-jaccard';
      }
    }

    // Accept match if above threshold
    if (score >= minSimilarity) {
      logger.debug(`Match found: ${reason}`, {
        pmMarket: pmText.substring(0, 60),
        kalshiMarket: kalshiText.substring(0, 60),
        score: score.toFixed(2),
        entities: Array.from(entityIntersection),
        dates: Array.from(dateIntersection),
        numbers: Array.from(numberIntersection),
      });

      return {
        polymarketMarket: pmMarket,
        kalshiMarket: kalshiMarket,
        similarityScore: score,
        matchReason: reason,
      };
    }

    return null;
  }

  /**
   * Extract normalized keywords
   */
  private extractKeywords(text: string): Set<string> {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to',
                                'for', 'of', 'with', 'by', 'from', 'will', 'be', 'have',
                                'has', 'had', 'do', 'does', 'did', 'is', 'are', 'was', 'were',
                                'that', 'this', 'it', 'as', 'if', 'when', 'than', 'before', 'after']);

    let normalized = text.toLowerCase()
      .replace(/['']s\b/g, '') // Remove possessives
      .replace(/[^\w\s]/g, ' '); // Remove punctuation

    // Expand acronyms
    normalized = normalized
      .replace(/\bbtc\b/g, 'bitcoin')
      .replace(/\beth\b/g, 'ethereum')
      .replace(/\bsol\b/g, 'solana');

    const words = normalized.split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    return new Set(words);
  }

  /**
   * Infer category from text
   */
  private inferCategory(title: string): string | null {
    const lower = title.toLowerCase();

    // Crypto - coins, tokens, airdrops, DeFi, NFTs
    if (lower.match(/\b(bitcoin|btc|ethereum|eth|crypto|airdrop|token|solana|defi|blockchain|nft|megaeth|cardano|ada|polygon|matic|avalanche|avax)\b/)) {
      return 'crypto';
    }

    // Esports - gaming, tournaments, teams (CRITICAL: separate from regular sports!)
    if (lower.match(/\b(esports|csgo|cs:go|dota|league of legends|lol|valorant|iem|esl|furia|navi|faze|g2|fnatic|team liquid|overwatch|fortnite|apex legends)\b/)) {
      return 'esports';
    }

    // Soccer/Football - teams, leagues, FIFA (CRITICAL: separate from other sports!)
    if (lower.match(/\b(soccer|football|fifa|uefa|premier league|la liga|bundesliga|serie a|başakşehir|barcelona|real madrid|manchester|liverpool|bayern|juventus|psg|fc |win on 20)\b/)) {
      return 'soccer';
    }

    // American Sports - NFL, NBA, MLB, NHL
    if (lower.match(/\b(nfl|nba|mlb|nhl|touchdown|yards|points scored|super bowl|playoffs|broncos|chiefs|lakers|celtics|yankees|red sox)\b/)) {
      return 'sports-us';
    }

    // Politics - elections, politicians, government
    if (lower.match(/\b(trump|biden|harris|election|president|congress|senate|governor|republican|democrat)\b/)) {
      return 'politics';
    }

    // Finance - stocks, indices, markets, economy
    if (lower.match(/\b(stock|s&p|dow|nasdaq|gdp|recession|fed|interest rate|market index|treasury|inflation)\b/)) {
      return 'finance';
    }

    // Weather - temperature, precipitation, climate
    if (lower.match(/\b(temperature|weather|climate|snow|rain|hurricane|forecast|celsius|fahrenheit)\b/)) {
      return 'weather';
    }

    return null;
  }

  /**
   * Find all matches between market lists
   */
  findMatches(
    polymarketMarkets: MarketWithVolume[],
    kalshiMarkets: KalshiMarket[],
    minSimilarity: number = 0.7
  ): MarketPair[] {
    logger.info(`🔍 Enhanced matching started`, {
      polymarketCount: polymarketMarkets.length,
      kalshiCount: kalshiMarkets.length,
      minSimilarity,
    });

    const matches: MarketPair[] = [];

    for (const pmMarket of polymarketMarkets) {
      for (const kalshiMarket of kalshiMarkets) {
        const match = this.match(pmMarket, kalshiMarket, minSimilarity);
        if (match) {
          matches.push(match);
        }
      }
    }

    // Deduplicate
    const uniqueMatches = new Map<string, MarketPair>();
    for (const match of matches) {
      const key = `${match.polymarketMarket.id}-${match.kalshiMarket.ticker}`;
      const existing = uniqueMatches.get(key);
      if (!existing || match.similarityScore > existing.similarityScore) {
        uniqueMatches.set(key, match);
      }
    }

    const result = Array.from(uniqueMatches.values());
    result.sort((a, b) => b.similarityScore - a.similarityScore);

    logger.info(`✅ Enhanced matching complete`, {
      totalMatches: result.length,
      highConfidence: result.filter(m => m.similarityScore >= 0.85).length,
      mediumConfidence: result.filter(m => m.similarityScore >= 0.7 && m.similarityScore < 0.85).length,
      topMatches: result.slice(0, 3).map(m => ({
        pm: m.polymarketMarket.question.substring(0, 50),
        kalshi: m.kalshiMarket.title.substring(0, 50),
        score: m.similarityScore.toFixed(2),
        reason: m.matchReason,
      })),
    });

    return result;
  }

  /**
   * Legacy compatibility
   */
  findExactMatches(pmMarkets: MarketWithVolume[], kalshiMarkets: KalshiMarket[]): MarketPair[] {
    return this.findMatches(pmMarkets, kalshiMarkets, 0.85);
  }
}
