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
  private clobClient: ClobClient | null = null;
  private wallet: ethers.Wallet;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private subscribedMarkets: Set<string> = new Set();

  constructor(config: PolymarketConfig) {
    super();

    this.wallet = new ethers.Wallet(config.privateKey);

    // Skip CLOB client initialization for now - focus on WebSocket
    // Will add proper API integration later
    logger.info('Polymarket client initialized', {
      address: this.wallet.address,
      chainId: config.chainId,
    });
  }

  async initialize(): Promise<void> {
    try {
      // Test connection - simplified to avoid API issues
      logger.info('Polymarket client ready');

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
          logger.info('WebSocket message received', {
            type: message.type,
            event_type: message.event_type,
            market: message.market,
            asset_id: message.asset_id
          });
          this.handleWebSocketMessage(message);
        } catch (error) {
          logger.error('Error parsing WebSocket message', { error, rawData: data.toString() });
        }
      });

      this.ws.on('error', (error) => {
        logger.error('WebSocket error', { error });
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        logger.warn('WebSocket connection closed', {
          code,
          reason: reason.toString(),
          subscribedMarkets: this.subscribedMarkets.size
        });
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

    // Log first 3 subscriptions to see format
    if (this.subscribedMarkets.size < 3) {
      logger.info('Sending WebSocket subscription', {
        marketId: marketId.substring(0, 20) + '...',
        messageFormat: subscribeMessage
      });
    }

    this.ws.send(JSON.stringify(subscribeMessage));
    this.subscribedMarkets.add(marketId);
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
      // Return empty array for now - we'll use WebSocket for market data
      // This avoids API compatibility issues
      logger.info('Using WebSocket for market data');
      return [];
    } catch (error) {
      logger.error('Error fetching markets', { error });
      throw error;
    }
  }

  async getOrderBook(tokenId: string): Promise<OrderBook> {
    try {
      // Return empty order book - we'll use WebSocket updates
      return {
        marketId: tokenId,
        bids: [],
        asks: [],
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error('Error fetching order book', { error });
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
      // Placeholder for order placement
      logger.info('[DRY RUN] Would place order', params);
      return { orderID: 'dry-run-' + Date.now() };
    } catch (error) {
      logger.error('Error placing order', { error, ...params });
      throw error;
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    try {
      logger.info('[DRY RUN] Would cancel order', { orderId });
    } catch (error) {
      logger.error('Error cancelling order', { error, orderId });
      throw error;
    }
  }

  async getBalance(): Promise<any> {
    try {
      logger.info('[DRY RUN] Would fetch balance');
      return { available: 1000, total: 1000 };
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
