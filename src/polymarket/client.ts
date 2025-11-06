import { ClobClient } from '@polymarket/clob-client';
import { ethers } from 'ethers';
import WebSocket from 'ws';
import { logger } from '../utils/logger';
import { Market, OrderBook, OrderBookLevel } from '../types';
import { EventEmitter } from 'events';

export interface PolymarketConfig {
  apiKey?: string;
  secret?: string;
  passphrase?: string;
  privateKey: string;
  chainId: number;
}

export class PolymarketClient extends EventEmitter {
  private clobClient: ClobClient;
  private wallet: ethers.Wallet;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private subscribedMarkets: Set<string> = new Set();

  constructor(config: PolymarketConfig) {
    super();

    this.wallet = new ethers.Wallet(config.privateKey);

    // Initialize ClobClient - it will auto-generate API credentials if not provided
    const clobConfig = config.apiKey && config.secret && config.passphrase
      ? {
          apiKey: config.apiKey,
          secret: config.secret,
          passphrase: config.passphrase,
        }
      : undefined;

    this.clobClient = new ClobClient(
      'https://clob.polymarket.com',
      config.chainId,
      this.wallet.privateKey,
      clobConfig
    );

    logger.info('Polymarket client initialized', {
      address: this.wallet.address,
      chainId: config.chainId,
      credentialsProvided: !!clobConfig,
    });
  }

  async initialize(): Promise<void> {
    try {
      // Test connection
      await this.clobClient.getMarkets();
      logger.info('Successfully connected to Polymarket API');

      // Initialize WebSocket connection for real-time data
      await this.connectWebSocket();
    } catch (error) {
      logger.error('Failed to initialize Polymarket client', { error });
      throw error;
    }
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        logger.info('WebSocket connection established');
        this.reconnectAttempts = 0;

        // Resubscribe to markets if any
        this.subscribedMarkets.forEach(marketId => {
          this.subscribeToMarket(marketId);
        });

        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(message);
        } catch (error) {
          logger.error('Error parsing WebSocket message', { error });
        }
      });

      this.ws.on('error', (error) => {
        logger.error('WebSocket error', { error });
        reject(error);
      });

      this.ws.on('close', () => {
        logger.warn('WebSocket connection closed');
        this.handleWebSocketClose();
      });

      // Timeout for connection
      setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          reject(new Error('WebSocket connection timeout'));
        }
      }, 10000);
    });
  }

  private handleWebSocketClose(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

      logger.info(`Attempting to reconnect WebSocket (${this.reconnectAttempts}/${this.maxReconnectAttempts})`, {
        delay,
      });

      setTimeout(() => {
        this.connectWebSocket().catch(err => {
          logger.error('WebSocket reconnection failed', { error: err });
        });
      }, delay);
    } else {
      logger.error('Max WebSocket reconnection attempts reached');
      this.emit('disconnected');
    }
  }

  private handleWebSocketMessage(message: any): void {
    const timestamp = Date.now();

    if (message.type === 'book_update') {
      const orderBook: OrderBook = {
        marketId: message.market_id,
        bids: message.bids?.map((b: any) => ({
          price: parseFloat(b.price),
          size: parseFloat(b.size),
        })) || [],
        asks: message.asks?.map((a: any) => ({
          price: parseFloat(a.price),
          size: parseFloat(a.size),
        })) || [],
        timestamp,
      };

      this.emit('orderbook', orderBook);
    } else if (message.type === 'trade') {
      this.emit('trade', {
        marketId: message.market_id,
        price: parseFloat(message.price),
        size: parseFloat(message.size),
        side: message.side,
        timestamp,
      });
    }
  }

  subscribeToMarket(marketId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot subscribe - WebSocket not connected', { marketId });
      this.subscribedMarkets.add(marketId);
      return;
    }

    const subscribeMessage = {
      type: 'subscribe',
      markets: [marketId],
      assets_ids: [marketId],
    };

    this.ws.send(JSON.stringify(subscribeMessage));
    this.subscribedMarkets.add(marketId);

    logger.info('Subscribed to market', { marketId });
  }

  unsubscribeFromMarket(marketId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot unsubscribe - WebSocket not connected', { marketId });
      return;
    }

    const unsubscribeMessage = {
      type: 'unsubscribe',
      markets: [marketId],
    };

    this.ws.send(JSON.stringify(unsubscribeMessage));
    this.subscribedMarkets.delete(marketId);

    logger.info('Unsubscribed from market', { marketId });
  }

  async getMarkets(): Promise<Market[]> {
    try {
      const markets = await this.clobClient.getMarkets();
      return markets.map((m: any) => ({
        id: m.id,
        question: m.question,
        active: m.active,
        closed: m.closed,
        outcomeTokens: m.tokens || [],
        outcomes: m.outcomes || [],
      }));
    } catch (error) {
      logger.error('Error fetching markets', { error });
      throw error;
    }
  }

  async getOrderBook(tokenId: string): Promise<OrderBook> {
    try {
      const book = await this.clobClient.getOrderBook(tokenId);

      return {
        marketId: tokenId,
        bids: book.bids?.map((b: any) => ({
          price: parseFloat(b.price),
          size: parseFloat(b.size),
        })) || [],
        asks: book.asks?.map((a: any) => ({
          price: parseFloat(a.price),
          size: parseFloat(a.size),
        })) || [],
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error('Error fetching order book', { error, tokenId });
      throw error;
    }
  }

  async placeOrder(params: {
    tokenId: string;
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
  }): Promise<any> {
    try {
      const order = await this.clobClient.createOrder({
        tokenID: params.tokenId,
        price: params.price,
        side: params.side,
        size: params.size,
      });

      logger.info('Order placed', { orderId: order.orderID, ...params });
      return order;
    } catch (error) {
      logger.error('Error placing order', { error, ...params });
      throw error;
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    try {
      await this.clobClient.cancelOrder(orderId);
      logger.info('Order cancelled', { orderId });
    } catch (error) {
      logger.error('Error cancelling order', { error, orderId });
      throw error;
    }
  }

  async getBalance(): Promise<any> {
    try {
      const balance = await this.clobClient.getBalance();
      return balance;
    } catch (error) {
      logger.error('Error fetching balance', { error });
      throw error;
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscribedMarkets.clear();
    logger.info('Polymarket client disconnected');
  }
}
