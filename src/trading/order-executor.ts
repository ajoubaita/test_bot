import { ArbitrageOpportunity, OrderRequest, OrderResponse, Position } from '../types';
import { PolymarketClient } from '../polymarket/client';
import { LatencyMonitor } from '../monitoring/latency-monitor';
import { logger } from '../utils/logger';
import { EventEmitter } from 'events';

export class OrderExecutor extends EventEmitter {
  private client: PolymarketClient;
  private latencyMonitor: LatencyMonitor;
  private positions: Map<string, Position> = new Map();
  private activeOrders: Map<string, any> = new Map();
  private executionQueue: ArbitrageOpportunity[] = [];
  private isProcessingQueue = false;

  constructor(client: PolymarketClient, latencyMonitor: LatencyMonitor) {
    super();
    this.client = client;
    this.latencyMonitor = latencyMonitor;
  }

  async executeOpportunity(opportunity: ArbitrageOpportunity): Promise<boolean> {
    const endTimer = this.latencyMonitor.startTimer('order_execution');

    try {
      logger.info('Executing arbitrage opportunity', {
        type: opportunity.type,
        marketId: opportunity.marketId,
        expectedProfit: opportunity.expectedProfit,
      });

      let success = false;

      switch (opportunity.type) {
        case 'spread':
          success = await this.executeSpreadArbitrage(opportunity);
          break;
        case 'yes-no-imbalance':
          success = await this.executeYesNoArbitrage(opportunity);
          break;
        case 'cross-market':
          success = await this.executeCrossMarketArbitrage(opportunity);
          break;
        default:
          logger.warn('Unknown opportunity type', { type: opportunity.type });
          success = false;
      }

      const latency = endTimer();

      if (success) {
        logger.info('Opportunity executed successfully', {
          type: opportunity.type,
          marketId: opportunity.marketId,
          executionLatency: latency,
        });
        this.emit('execution-success', { opportunity, latency });
      } else {
        logger.warn('Opportunity execution failed', {
          type: opportunity.type,
          marketId: opportunity.marketId,
        });
        this.emit('execution-failure', { opportunity });
      }

      return success;
    } catch (error) {
      const latency = endTimer();
      logger.error('Error executing opportunity', {
        error,
        opportunity,
        executionLatency: latency,
      });
      this.emit('execution-error', { opportunity, error });
      return false;
    }
  }

  private async executeSpreadArbitrage(opportunity: ArbitrageOpportunity): Promise<boolean> {
    // For crossed books: buy at ask, sell at bid immediately
    try {
      const buyOrder = await this.client.placeOrder({
        tokenId: opportunity.marketId,
        side: 'BUY',
        price: opportunity.buyPrice,
        size: 100, // This should be calculated based on opportunity and risk limits
      });

      if (!buyOrder || !buyOrder.orderID) {
        return false;
      }

      const sellOrder = await this.client.placeOrder({
        tokenId: opportunity.marketId,
        side: 'SELL',
        price: opportunity.sellPrice,
        size: 100,
      });

      if (!sellOrder || !sellOrder.orderID) {
        // Cancel buy order if sell fails
        await this.client.cancelOrder(buyOrder.orderID);
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Error executing spread arbitrage', { error });
      return false;
    }
  }

  private async executeYesNoArbitrage(opportunity: ArbitrageOpportunity): Promise<boolean> {
    // Buy both YES and NO if their combined price < 1.00
    // Or sell both if their combined price > 1.00
    try {
      // This is simplified - in reality you'd need to handle YES and NO tokens separately
      const orders = [];

      if (opportunity.buyPrice < 1.00) {
        // Buy both YES and NO
        const buyYes = await this.client.placeOrder({
          tokenId: opportunity.marketId,
          side: 'BUY',
          price: opportunity.buyPrice / 2, // Simplified
          size: 100,
        });
        orders.push(buyYes);
      } else {
        // Sell both YES and NO
        const sellYes = await this.client.placeOrder({
          tokenId: opportunity.marketId,
          side: 'SELL',
          price: opportunity.sellPrice / 2, // Simplified
          size: 100,
        });
        orders.push(sellYes);
      }

      return orders.every(order => order && order.orderID);
    } catch (error) {
      logger.error('Error executing yes/no arbitrage', { error });
      return false;
    }
  }

  private async executeCrossMarketArbitrage(opportunity: ArbitrageOpportunity): Promise<boolean> {
    // Execute trades across different markets
    // This requires more complex logic based on market relationships
    logger.warn('Cross-market arbitrage execution not fully implemented');
    return false;
  }

  async placeOrder(request: OrderRequest): Promise<OrderResponse> {
    const endTimer = this.latencyMonitor.startTimer('place_order');

    try {
      const order = await this.client.placeOrder({
        tokenId: request.marketId,
        side: request.side,
        price: request.price,
        size: request.size,
      });

      const latency = endTimer();

      if (order && order.orderID) {
        this.activeOrders.set(order.orderID, {
          ...request,
          orderId: order.orderID,
          status: 'active',
          placedAt: Date.now(),
        });

        return {
          orderId: order.orderID,
          success: true,
          executedAt: Date.now(),
          executionLatency: latency,
        };
      }

      return {
        orderId: '',
        success: false,
        message: 'Order placement failed',
        executionLatency: latency,
      };
    } catch (error) {
      const latency = endTimer();
      logger.error('Error placing order', { error, request });

      return {
        orderId: '',
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        executionLatency: latency,
      };
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await this.client.cancelOrder(orderId);
      this.activeOrders.delete(orderId);
      return true;
    } catch (error) {
      logger.error('Error cancelling order', { error, orderId });
      return false;
    }
  }

  async cancelAllOrders(): Promise<void> {
    const orderIds = Array.from(this.activeOrders.keys());

    await Promise.all(
      orderIds.map(orderId => this.cancelOrder(orderId))
    );

    logger.info('All orders cancelled', { count: orderIds.length });
  }

  queueOpportunity(opportunity: ArbitrageOpportunity): void {
    this.executionQueue.push(opportunity);

    if (!this.isProcessingQueue) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.executionQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.executionQueue.length > 0) {
      const opportunity = this.executionQueue.shift();
      if (opportunity) {
        await this.executeOpportunity(opportunity);
      }
    }

    this.isProcessingQueue = false;
  }

  getActiveOrders(): any[] {
    return Array.from(this.activeOrders.values());
  }

  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  getPosition(marketId: string): Position | undefined {
    return this.positions.get(marketId);
  }

  updatePosition(marketId: string, outcome: string, size: number, price: number): void {
    const existingPosition = this.positions.get(marketId);

    if (existingPosition) {
      // Update existing position
      const totalSize = existingPosition.size + size;
      const averagePrice =
        (existingPosition.averagePrice * existingPosition.size + price * size) / totalSize;

      existingPosition.size = totalSize;
      existingPosition.averagePrice = averagePrice;
    } else {
      // Create new position
      this.positions.set(marketId, {
        marketId,
        outcome,
        size,
        averagePrice: price,
        unrealizedPnL: 0,
      });
    }
  }

  getTotalExposure(): number {
    let total = 0;
    for (const position of this.positions.values()) {
      total += Math.abs(position.size * position.averagePrice);
    }
    return total;
  }

  clearPositions(): void {
    this.positions.clear();
  }
}
