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
      logger.info('Fetching markets from Polymarket (will stop after finding enough)...', {
        minVolume: this.minVolume,
        maxVolume: this.maxVolume,
      });

      const startTime = Date.now();
      const limit = 500;
      const maxParallelRequests = 3; // Reduced from 5 to be less aggressive
      const targetMarketCount = 100; // Stop after finding 100 matching markets
      const maxBatches = 8; // Max 20,000 markets total (was 50,000)

      let allMarkets: any[] = [];
      let filteredCount = 0;
      let offset = 0;
      let batchNumber = 0;

      // Parallel fetch batches
      while (true) {
        const promises = [];

        // Create parallel requests for next N batches
        for (let i = 0; i < maxParallelRequests; i++) {
          const currentOffset = offset + (i * limit);
          promises.push(
            fetch(`${this.apiUrl}/markets?limit=${limit}&offset=${currentOffset}`)
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

        // Count how many markets match our criteria so far
        filteredCount = allMarkets.filter((market: any) => {
          if (market.closed || market.active === false) return false;
          const volume = parseFloat(market.volume || market.volume_24h || '0');
          return volume >= this.minVolume && volume <= this.maxVolume;
        }).length;

        offset += maxParallelRequests * limit;
        batchNumber++;

        logger.info(`Batch ${batchNumber}: ${allMarkets.length} total, ${filteredCount} matching criteria`);

        // Early exit if we have enough markets
        if (filteredCount >= targetMarketCount) {
          logger.info(`Found ${filteredCount} markets matching criteria, stopping fetch`);
          break;
        }

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

      // Filter markets by volume and active status
      const filteredMarkets = allMarkets
        .filter((market: any) => {
          // Must be active and not closed
          if (market.closed || market.active === false) {
            return false;
          }
          // Must match volume criteria
          const volume = parseFloat(market.volume || market.volume_24h || '0');
          return volume >= this.minVolume && volume <= this.maxVolume;
        })
        .map((market: any) => ({
          id: market.id || market.condition_id,
          question: market.question || market.title || 'Unknown',
          active: market.active !== false,
          closed: market.closed === true,
          outcomeTokens: market.tokens || [],
          outcomes: market.outcomes || ['YES', 'NO'],
          volume: parseFloat(market.volume || market.volume_24h || '0'),
          volume24h: parseFloat(market.volume_24h || market.volume || '0'),
        }));

      logger.info(`Found ${filteredMarkets.length} markets matching volume criteria`, {
        minVolume: this.minVolume,
        maxVolume: this.maxVolume,
      });

      // Log sample of markets found
      if (filteredMarkets.length > 0) {
        logger.info('Sample markets:', {
          markets: filteredMarkets.slice(0, 5).map(m => ({
            question: m.question,
            volume: m.volume,
            id: m.id,
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
        logger.warn(`Failed to fetch market details for ${conditionId}`);
        return [];
      }

      const market: any = await response.json();
      return market.tokens || market.outcome_tokens || [];
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
        volumeRange: {
          min: this.minVolume,
          max: this.maxVolume,
        },
      });

      return markets;
    } catch (error) {
      logger.error('Error scanning markets', { error });
      return [];
    }
  }
}
