import { logger } from '../utils/logger';
import { Market } from '../types';

export interface MarketWithVolume extends Market {
  volume: number;
  volume24h: number;
}

export class MarketScanner {
  private apiUrl = 'https://gamma-api.polymarket.com';
  private minVolume: number;
  private maxVolume: number;

  constructor(minVolume: number = 10000, maxVolume: number = 100000) {
    this.minVolume = minVolume;
    this.maxVolume = maxVolume;
  }

  async fetchActiveMarkets(): Promise<MarketWithVolume[]> {
    try {
      logger.info('Fetching ALL active markets from Polymarket...');

      const startTime = Date.now();
      const limit = 500;
      const maxParallelRequests = 2; // Reduced to avoid rate limits
      const maxBatches = 6; // Fetch up to 9,000 markets to avoid rate limits

      let allMarkets: any[] = [];
      let offset = 0;
      let batchNumber = 0;

      // Parallel fetch batches
      while (true) {
        const promises = [];

        // Create parallel requests for next N batches
        for (let i = 0; i < maxParallelRequests; i++) {
          const currentOffset = offset + (i * limit);
          // Try to filter for non-closed markets in API query
          promises.push(
            fetch(`${this.apiUrl}/markets?limit=${limit}&offset=${currentOffset}&closed=false`)
              .then(res => res.ok ? res.json() : null)
              .catch(err => {
                logger.warn(`Failed to fetch batch at offset ${currentOffset}`);
                return null;
              })
          );
        }

        // Wait for all parallel requests
        const results = await Promise.all(promises);

        let hasData = false;
        for (const data of results) {
          if (data) {
            const markets = Array.isArray(data) ? data : (data.data || []);
            if (markets.length > 0) {
              allMarkets = allMarkets.concat(markets);
              hasData = true;
            }
          }
        }

        offset += maxParallelRequests * limit;
        batchNumber++;

        logger.info(`Batch ${batchNumber}: ${allMarkets.length} total active markets fetched`);

        // Stop if no data returned
        if (!hasData) {
          break;
        }

        // Safety limit
        if (batchNumber >= maxBatches) {
          logger.info('Reached batch limit, stopping fetch');
          break;
        }
      }

      const fetchTime = Date.now() - startTime;
      logger.info(`Fetched ${allMarkets.length} total markets in ${fetchTime}ms`);

      // Filter markets - keep only funded markets with token IDs
      const filteredMarkets = allMarkets
        .filter((market: any) => {
          // Must be active and not closed
          if (market.closed || market.active === false) {
            return false;
          }
          // Must have clobTokenIds (funded markets only)
          if (!market.clobTokenIds) {
            return false;
          }
          // Include all active markets regardless of volume
          return true;
        })
        .map((market: any) => {
          // Parse clobTokenIds from JSON string
          let tokenIds: string[] = [];
          try {
            if (typeof market.clobTokenIds === 'string') {
              tokenIds = JSON.parse(market.clobTokenIds);
            } else if (Array.isArray(market.clobTokenIds)) {
              tokenIds = market.clobTokenIds;
            } else if (market.tokens) {
              tokenIds = Array.isArray(market.tokens) ? market.tokens : JSON.parse(market.tokens);
            }
          } catch (e) {
            // Failed to parse, leave empty
          }

          return {
            id: market.id || market.condition_id,
            question: market.question || market.title || 'Unknown',
            active: market.active !== false,
            closed: market.closed === true,
            outcomeTokens: tokenIds,
            outcomes: market.outcomes || ['YES', 'NO'],
            volume: parseFloat(market.volume || market.volume_24h || '0'),
            volume24h: parseFloat(market.volume_24h || market.volume || '0'),
          };
        });

      logger.info(`Found ${filteredMarkets.length} active, funded markets with token IDs`);

      // Log sample of markets found
      if (filteredMarkets.length > 0) {
        const marketsWithTokens = filteredMarkets.filter(m => m.outcomeTokens.length > 0);
        logger.info(`${marketsWithTokens.length} markets have valid tokens`);

        logger.info('Sample markets with tokens:', {
          markets: marketsWithTokens.slice(0, 5).map(m => ({
            question: m.question.substring(0, 50),
            volume: `$${Math.round(m.volume)}`,
            id: m.id,
            tokenCount: m.outcomeTokens.length,
            tokens: m.outcomeTokens,
          })),
        });
      }

      return filteredMarkets;
    } catch (error) {
      logger.error('Error fetching markets', { error });
      throw error;
    }
  }

  async getMarketTokens(conditionId: string): Promise<string[]> {
    try {
      // Fetch specific market details to get token IDs
      const response = await fetch(`${this.apiUrl}/markets/${conditionId}`);

      if (!response.ok) {
        logger.warn(`Failed to fetch market details for ${conditionId}`, {
          status: response.status,
          statusText: response.statusText,
        });
        return [];
      }

      const market: any = await response.json();

      // Parse clobTokenIds if it's a string
      let tokens: string[] = [];
      if (market.clobTokenIds) {
        try {
          tokens = typeof market.clobTokenIds === 'string'
            ? JSON.parse(market.clobTokenIds)
            : market.clobTokenIds;
        } catch (e) {
          // Fall back to other token fields
          tokens = market.tokens || market.outcome_tokens || [];
        }
      } else {
        tokens = market.tokens || market.outcome_tokens || [];
      }

      return tokens;
    } catch (error) {
      logger.error('Error fetching market tokens', { error, conditionId });
      return [];
    }
  }

  async scanAndFilterMarkets(): Promise<MarketWithVolume[]> {
    try {
      const markets = await this.fetchActiveMarkets();

      // Sort by volume descending
      markets.sort((a, b) => b.volume - a.volume);

      logger.info('Market scan complete', {
        totalFound: markets.length,
        topVolumeMarkets: markets.slice(0, 5).map(m => ({
          question: m.question.substring(0, 40),
          volume: `$${Math.round(m.volume).toLocaleString()}`,
        })),
      });

      return markets;
    } catch (error) {
      logger.error('Error scanning markets', { error });
      return [];
    }
  }
}
