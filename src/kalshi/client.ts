import { logger } from '../utils/logger';
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import * as crypto from 'crypto';

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
  timestamp?: number;
}

export class KalshiClient extends EventEmitter {
  private apiUrl = 'https://api.elections.kalshi.com/trade-api/v2';
  private wsUrl = 'wss://api.elections.kalshi.com/trade-api/ws/v2';
  private apiKey?: string;
  private privateKey?: string;
  private ws: WebSocket | null = null;
  private markets: Map<string, KalshiMarket> = new Map();
  private orderbooks: Map<string, KalshiOrderBook> = new Map();
  private messageId = 1;
  private subscribedMarkets: Set<string> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private pingInterval: NodeJS.Timeout | null = null;
  private useWebSocket = false;

  constructor(apiKey?: string, privateKey?: string) {
    super();
    this.apiKey = apiKey;
    this.privateKey = privateKey;
    this.useWebSocket = !!(apiKey && privateKey);

    if (this.useWebSocket) {
      logger.info('Kalshi client initialized with WebSocket support (authenticated)');
    } else {
      logger.info('Kalshi client initialized (public REST API only - no credentials provided)');
    }
  }

  /**
   * Initialize the Kalshi client - connect WebSocket if credentials available
   */
  async initialize(): Promise<void> {
    if (this.useWebSocket) {
      await this.connectWebSocket();
    }
  }

  /**
   * Generate HMAC-SHA256 signature for authentication
   */
  private generateSignature(timestamp: string, method: string, path: string): string {
    if (!this.privateKey) {
      throw new Error('Private key required for authentication');
    }

    // Message format: timestamp + method + path
    const message = timestamp + method + path;

    // Generate HMAC-SHA256 signature
    const hmac = crypto.createHmac('sha256', this.privateKey);
    hmac.update(message);
    return hmac.digest('base64');
  }

  /**
   * Connect to Kalshi WebSocket with authentication
   */
  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.apiKey || !this.privateKey) {
        reject(new Error('API key and private key required for WebSocket connection'));
        return;
      }

      try {
        // Generate authentication headers
        const timestamp = Date.now().toString();
        const signature = this.generateSignature(timestamp, 'GET', '/trade-api/ws/v2');

        const headers = {
          'KALSHI-ACCESS-KEY': this.apiKey,
          'KALSHI-ACCESS-SIGNATURE': signature,
          'KALSHI-ACCESS-TIMESTAMP': timestamp,
        };

        logger.info('Connecting to Kalshi WebSocket...', {
          wsUrl: this.wsUrl,
          apiKey: this.apiKey.substring(0, 8) + '...',
        });

        this.ws = new WebSocket(this.wsUrl, { headers });

        this.ws.on('open', () => {
          logger.info('Kalshi WebSocket connection established');
          this.reconnectAttempts = 0;

          // Subscribe to ticker channel for all markets
          this.subscribeToTicker();

          // Resubscribe to markets if any
          if (this.subscribedMarkets.size > 0) {
            const marketsArray = Array.from(this.subscribedMarkets);
            logger.info(`Resubscribing to ${marketsArray.length} Kalshi markets`);
            this.subscribeToMarkets(marketsArray);
          }

          resolve();
        });

        this.ws.on('message', (data: Buffer) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleWebSocketMessage(message);
          } catch (error) {
            logger.error('Error parsing Kalshi WebSocket message', { error, data: data.toString() });
          }
        });

        this.ws.on('error', (error) => {
          logger.error('Kalshi WebSocket error', { error });
          reject(error);
        });

        this.ws.on('close', (code, reason) => {
          logger.warn('Kalshi WebSocket connection closed', {
            code,
            reason: reason.toString(),
            subscribedMarkets: this.subscribedMarkets.size,
          });
          this.handleWebSocketClose();
        });

        // Timeout for connection
        setTimeout(() => {
          if (this.ws?.readyState !== WebSocket.OPEN) {
            reject(new Error('Kalshi WebSocket connection timeout'));
          }
        }, 10000);
      } catch (error) {
        logger.error('Error connecting to Kalshi WebSocket', { error });
        reject(error);
      }
    });
  }

  /**
   * Handle WebSocket close and reconnection
   */
  private handleWebSocketClose(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

      logger.info(`Attempting to reconnect Kalshi WebSocket (${this.reconnectAttempts}/${this.maxReconnectAttempts})`, {
        delay,
      });

      setTimeout(() => {
        this.connectWebSocket().catch(err => {
          logger.error('Kalshi WebSocket reconnection failed', { error: err });
        });
      }, delay);
    } else {
      logger.error('Max Kalshi WebSocket reconnection attempts reached');
      this.emit('disconnected');
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleWebSocketMessage(message: any): void {
    const msgType = message.type;

    if (msgType === 'ticker') {
      // Ticker update: real-time price updates for all markets
      const data = message.data;
      this.emit('ticker', {
        ticker: data.market_ticker,
        bid: data.bid / 100, // Convert cents to dollars
        ask: data.ask / 100,
        volume: data.volume,
        timestamp: Date.now(),
      });
    } else if (msgType === 'orderbook_snapshot') {
      // Full orderbook snapshot
      const data = message.data;
      const orderbook: KalshiOrderBook = {
        market_ticker: data.market_ticker,
        yes: data.yes || [],
        no: data.no || [],
        timestamp: Date.now(),
      };
      this.orderbooks.set(data.market_ticker, orderbook);
      this.emit('orderbook', orderbook);

      logger.debug('Kalshi orderbook snapshot received', {
        ticker: data.market_ticker,
        yesBids: orderbook.yes.length,
        noBids: orderbook.no.length,
      });
    } else if (msgType === 'orderbook_update') {
      // Incremental orderbook update
      const data = message.data;
      const existing = this.orderbooks.get(data.market_ticker);

      if (existing) {
        // Update existing orderbook with delta
        // Note: Kalshi provides full updated sides in the delta
        if (data.yes) existing.yes = data.yes;
        if (data.no) existing.no = data.no;
        existing.timestamp = Date.now();

        this.emit('orderbook', existing);
      } else {
        // No existing orderbook, treat as snapshot
        const orderbook: KalshiOrderBook = {
          market_ticker: data.market_ticker,
          yes: data.yes || [],
          no: data.no || [],
          timestamp: Date.now(),
        };
        this.orderbooks.set(data.market_ticker, orderbook);
        this.emit('orderbook', orderbook);
      }
    } else if (msgType === 'error') {
      const errorCode = message.msg?.code;
      const errorMsg = message.msg?.msg;
      logger.error('Kalshi WebSocket error message', { errorCode, errorMsg });
    } else if (msgType === 'subscribed') {
      logger.debug('Kalshi subscription confirmed', { message });
    }
  }

  /**
   * Subscribe to ticker channel (all markets)
   */
  private subscribeToTicker(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const subscription = {
      id: this.messageId++,
      cmd: 'subscribe',
      params: {
        channels: ['ticker'],
      },
    };

    this.ws.send(JSON.stringify(subscription));
    logger.info('Subscribed to Kalshi ticker channel');
  }

  /**
   * Subscribe to specific markets for orderbook updates
   */
  subscribeToMarkets(marketTickers: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot subscribe to Kalshi markets - WebSocket not connected', {
        marketCount: marketTickers.length,
      });
      marketTickers.forEach(ticker => this.subscribedMarkets.add(ticker));
      return;
    }

    const subscription = {
      id: this.messageId++,
      cmd: 'subscribe',
      params: {
        channels: ['orderbook_delta'],
        market_tickers: marketTickers,
      },
    };

    this.ws.send(JSON.stringify(subscription));
    marketTickers.forEach(ticker => this.subscribedMarkets.add(ticker));

    logger.info('Subscribed to Kalshi orderbook updates', {
      marketCount: marketTickers.length,
      sampleTickers: marketTickers.slice(0, 3),
    });
  }

  /**
   * Get cached orderbook for a market
   */
  getOrderBook(marketTicker: string): KalshiOrderBook | null {
    return this.orderbooks.get(marketTicker) || null;
  }

  /**
   * Fetch all open markets (REST API - no auth required)
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
   * Fetch orderbook for a specific market (REST API - no auth required)
   */
  async fetchOrderBook(marketTicker: string): Promise<KalshiOrderBook | null> {
    try {
      const url = `${this.apiUrl}/markets/${marketTicker}/orderbook`;
      const response = await fetch(url);

      if (!response.ok) {
        return null;
      }

      const data: any = await response.json();
      const orderbook: KalshiOrderBook = {
        ...data.orderbook,
        timestamp: Date.now(),
      };

      // Cache the orderbook
      this.orderbooks.set(marketTicker, orderbook);

      return orderbook;
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
    // Bids are sorted descending (highest first)

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

  /**
   * Get all cached orderbooks
   */
  getAllOrderBooks(): Map<string, KalshiOrderBook> {
    return this.orderbooks;
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.subscribedMarkets.clear();
    logger.info('Kalshi client disconnected');
  }
}
