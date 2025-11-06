import { OrderBook, OrderBookLevel } from '../types';
import { EventEmitter } from 'events';

export class OrderBookManager extends EventEmitter {
  private orderBooks: Map<string, OrderBook> = new Map();
  private updateCounts: Map<string, number> = new Map();

  constructor() {
    super();
  }

  updateOrderBook(orderBook: OrderBook): void {
    const previousBook = this.orderBooks.get(orderBook.marketId);
    this.orderBooks.set(orderBook.marketId, orderBook);

    // Track update count
    const count = (this.updateCounts.get(orderBook.marketId) || 0) + 1;
    this.updateCounts.set(orderBook.marketId, count);

    // Emit update event with diff information
    const hasSignificantChange = this.hasSignificantChange(previousBook, orderBook);

    if (hasSignificantChange || !previousBook) {
      this.emit('orderbook-update', {
        marketId: orderBook.marketId,
        orderBook,
        isSignificant: hasSignificantChange,
      });
    }
  }

  private hasSignificantChange(previous: OrderBook | undefined, current: OrderBook): boolean {
    if (!previous) return true;

    // Check if best bid/ask changed significantly (>0.1% price change)
    const prevBestBid = this.getBestBid(previous);
    const currBestBid = this.getBestBid(current);
    const prevBestAsk = this.getBestAsk(previous);
    const currBestAsk = this.getBestAsk(current);

    if (!prevBestBid || !currBestBid || !prevBestAsk || !currBestAsk) {
      return true;
    }

    const bidPriceChange = Math.abs(currBestBid.price - prevBestBid.price) / prevBestBid.price;
    const askPriceChange = Math.abs(currBestAsk.price - prevBestAsk.price) / prevBestAsk.price;

    return bidPriceChange > 0.001 || askPriceChange > 0.001;
  }

  getOrderBook(marketId: string): OrderBook | undefined {
    return this.orderBooks.get(marketId);
  }

  getBestBid(orderBookOrMarketId: OrderBook | string): OrderBookLevel | null {
    const orderBook =
      typeof orderBookOrMarketId === 'string'
        ? this.orderBooks.get(orderBookOrMarketId)
        : orderBookOrMarketId;

    if (!orderBook || orderBook.bids.length === 0) return null;

    // Bids are sorted descending by price
    return orderBook.bids.reduce((best, bid) =>
      bid.price > best.price ? bid : best
    );
  }

  getBestAsk(orderBookOrMarketId: OrderBook | string): OrderBookLevel | null {
    const orderBook =
      typeof orderBookOrMarketId === 'string'
        ? this.orderBooks.get(orderBookOrMarketId)
        : orderBookOrMarketId;

    if (!orderBook || orderBook.asks.length === 0) return null;

    // Asks are sorted ascending by price
    return orderBook.asks.reduce((best, ask) =>
      ask.price < best.price ? ask : best
    );
  }

  getSpread(marketId: string): number | null {
    const bestBid = this.getBestBid(marketId);
    const bestAsk = this.getBestAsk(marketId);

    if (!bestBid || !bestAsk) return null;

    return bestAsk.price - bestBid.price;
  }

  getMidPrice(marketId: string): number | null {
    const bestBid = this.getBestBid(marketId);
    const bestAsk = this.getBestAsk(marketId);

    if (!bestBid || !bestAsk) return null;

    return (bestBid.price + bestAsk.price) / 2;
  }

  getDepth(marketId: string, side: 'bid' | 'ask', levels: number = 5): OrderBookLevel[] {
    const orderBook = this.orderBooks.get(marketId);
    if (!orderBook) return [];

    const orders = side === 'bid' ? orderBook.bids : orderBook.asks;
    return orders.slice(0, levels);
  }

  getVolumeWeightedPrice(
    marketId: string,
    side: 'bid' | 'ask',
    targetSize: number
  ): number | null {
    const orderBook = this.orderBooks.get(marketId);
    if (!orderBook) return null;

    const orders = side === 'bid' ? orderBook.bids : orderBook.asks;
    let remainingSize = targetSize;
    let totalCost = 0;

    for (const order of orders) {
      if (remainingSize <= 0) break;

      const sizeToTake = Math.min(order.size, remainingSize);
      totalCost += sizeToTake * order.price;
      remainingSize -= sizeToTake;
    }

    if (remainingSize > 0) {
      // Not enough liquidity
      return null;
    }

    return totalCost / targetSize;
  }

  getSlippage(marketId: string, side: 'bid' | 'ask', size: number): number | null {
    const vwap = this.getVolumeWeightedPrice(marketId, side, size);
    const midPrice = this.getMidPrice(marketId);

    if (!vwap || !midPrice) return null;

    return Math.abs(vwap - midPrice) / midPrice;
  }

  hasLiquidity(marketId: string, side: 'bid' | 'ask', minSize: number): boolean {
    const orderBook = this.orderBooks.get(marketId);
    if (!orderBook) return false;

    const orders = side === 'bid' ? orderBook.bids : orderBook.asks;
    const totalSize = orders.reduce((sum, order) => sum + order.size, 0);

    return totalSize >= minSize;
  }

  getAllMarkets(): string[] {
    return Array.from(this.orderBooks.keys());
  }

  getUpdateCount(marketId: string): number {
    return this.updateCounts.get(marketId) || 0;
  }

  getStats() {
    const markets = this.getAllMarkets();

    return {
      totalMarkets: markets.length,
      totalUpdates: Array.from(this.updateCounts.values()).reduce((a, b) => a + b, 0),
      marketStats: markets.map(marketId => {
        const orderBook = this.orderBooks.get(marketId)!;
        return {
          marketId,
          bestBid: this.getBestBid(marketId)?.price,
          bestAsk: this.getBestAsk(marketId)?.price,
          spread: this.getSpread(marketId),
          midPrice: this.getMidPrice(marketId),
          updates: this.getUpdateCount(marketId),
          lastUpdate: orderBook.timestamp,
        };
      }),
    };
  }

  clear(): void {
    this.orderBooks.clear();
    this.updateCounts.clear();
  }
}
