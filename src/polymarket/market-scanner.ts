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
      logger.info('Fetching ALL active markets from Polymarket...', {
        minVolume: this.minVolume,
        maxVolume: this.maxVolume,
      });

      let allMarkets: any[] = [];
      let offset = 0;
      const limit = 100;
      let hasMore = true;

      // Paginate through all markets
      while (hasMore) {
        const response = await fetch(
          `${this.apiUrl}/markets?active=true&closed=false&limit=${limit}&offset=${offset}`
        );

        if (!response.ok) {
          logger.warn(`Failed to fetch markets at offset ${offset}: ${response.statusText}`);
          break;
        }

        const data: any = await response.json();
        const markets = Array.isArray(data) ? data : (data.data || []);

        if (markets.length === 0) {
          hasMore = false;
        } else {
          allMarkets = allMarkets.concat(markets);
          offset += limit;

          logger.info(`Fetched ${markets.length} markets (total: ${allMarkets.length})`);

          // If we got less than limit, we've reached the end
          if (markets.length < limit) {
            hasMore = false;
          }

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      logger.info(`Fetched ${allMarkets.length} total markets from Polymarket`);

      // Filter markets by volume
      const filteredMarkets = allMarkets
        .filter((market: any) => {
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
