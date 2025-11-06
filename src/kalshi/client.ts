import { logger } from '../utils/logger';
import { EventEmitter } from 'events';

export interface KalshiMarket {
  ticker: string;
  title: string;
  event_ticker: string;
  series_ticker: string;
  yes_price: number; // Price in cents (0-100)
  no_price: number;  // Price in cents (0-100)
  volume: number;
  open_time: string;
  close_time: string;
  status: string;
  category: string;
}

export interface KalshiOrderBook {
  market_ticker: string;
  yes: [number, number][]; // [price in cents, quantity]
  no: [number, number][];  // [price in cents, quantity]
}

export class KalshiClient extends EventEmitter {
  private apiUrl = 'https://api.elections.kalshi.com/trade-api/v2';
  private markets: Map<string, KalshiMarket> = new Map();

  constructor() {
    super();
    logger.info('Kalshi client initialized (public data only)');
  }

  /**
   * Fetch all open markets, optionally filtered by series or category
   */
  async fetchMarkets(params?: {
    series_ticker?: string;
    category?: string;
    limit?: number;
  }): Promise<KalshiMarket[]> {
    try {
      const queryParams = new URLSearchParams({
        status: 'open',
        limit: (params?.limit || 200).toString(),
      });

      if (params?.series_ticker) {
        queryParams.append('series_ticker', params.series_ticker);
      }
      if (params?.category) {
        queryParams.append('category', params.category);
      }

      const url = `${this.apiUrl}/markets?${queryParams.toString()}`;
      const response = await fetch(url);

      if (!response.ok) {
        logger.error('Failed to fetch Kalshi markets', {
          status: response.status,
          statusText: response.statusText,
        });
        return [];
      }

      const data: any = await response.json();
      const markets: KalshiMarket[] = data.markets || [];

      // Cache markets
      markets.forEach(market => {
        this.markets.set(market.ticker, market);
      });

      logger.info(`Fetched ${markets.length} Kalshi markets`, {
        series: params?.series_ticker,
        category: params?.category,
      });

      return markets;
    } catch (error) {
      logger.error('Error fetching Kalshi markets', { error });
      return [];
    }
  }

  /**
   * Fetch orderbook for a specific market
   */
  async fetchOrderBook(marketTicker: string): Promise<KalshiOrderBook | null> {
    try {
      const url = `${this.apiUrl}/markets/${marketTicker}/orderbook`;
      const response = await fetch(url);

      if (!response.ok) {
        return null;
      }

      const data: any = await response.json();
      return data.orderbook;
    } catch (error) {
      logger.error('Error fetching Kalshi orderbook', { error, marketTicker });
      return null;
    }
  }

  /**
   * Get best bid and ask prices from orderbook
   */
  getBestPrices(orderbook: KalshiOrderBook): {
    yesBid: number | null;
    yesAsk: number | null;
    noBid: number | null;
    noAsk: number | null;
  } {
    // Kalshi orderbook format: [[price_cents, quantity], ...]
    // YES bids are sorted descending (highest first)
    // NO bids are sorted descending (highest first)

    const yesBid = orderbook.yes.length > 0 ? orderbook.yes[0][0] / 100 : null; // Convert cents to dollars
    const yesAsk = orderbook.yes.length > 0 ? orderbook.yes[orderbook.yes.length - 1][0] / 100 : null;

    const noBid = orderbook.no.length > 0 ? orderbook.no[0][0] / 100 : null;
    const noAsk = orderbook.no.length > 0 ? orderbook.no[orderbook.no.length - 1][0] / 100 : null;

    return { yesBid, yesAsk, noBid, noAsk };
  }

  /**
   * Search for markets matching a query string
   */
  async searchMarkets(query: string): Promise<KalshiMarket[]> {
    try {
      // Fetch recent markets and filter locally
      const allMarkets = await this.fetchMarkets({ limit: 500 });

      const normalizedQuery = query.toLowerCase();
      const matches = allMarkets.filter(market =>
        market.title.toLowerCase().includes(normalizedQuery) ||
        market.series_ticker.toLowerCase().includes(normalizedQuery)
      );

      logger.info(`Found ${matches.length} Kalshi markets matching "${query}"`);
      return matches;
    } catch (error) {
      logger.error('Error searching Kalshi markets', { error, query });
      return [];
    }
  }

  /**
   * Get market by ticker
   */
  getMarket(ticker: string): KalshiMarket | undefined {
    return this.markets.get(ticker);
  }

  /**
   * Get all cached markets
   */
  getAllMarkets(): KalshiMarket[] {
    return Array.from(this.markets.values());
  }
}
