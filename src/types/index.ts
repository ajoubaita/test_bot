// Core types for the HFT trading bot

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface OrderBook {
  marketId: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: number;
}

export interface Market {
  id: string;
  question: string;
  active: boolean;
  closed: boolean;
  outcomeTokens: string[];
  outcomes: string[];
}

export interface ArbitrageOpportunity {
  type: 'spread' | 'cross-market' | 'yes-no-imbalance';
  marketId: string;
  expectedProfit: number;
  profitPercentage: number;
  buyPrice: number;
  sellPrice: number;
  buyOutcome?: string;
  sellOutcome?: string;
  detectedAt: number;
  latency: number;
}

export interface Trade {
  id: string;
  marketId: string;
  outcome: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  timestamp: number;
}

export interface Position {
  marketId: string;
  outcome: string;
  size: number;
  averagePrice: number;
  unrealizedPnL: number;
}

export interface PerformanceMetrics {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfit: number;
  totalLoss: number;
  averageLatency: number;
  maxLatency: number;
  minLatency: number;
  opportunitiesDetected: number;
  opportunitiesExecuted: number;
}

export interface LatencyMeasurement {
  operation: string;
  latency: number;
  timestamp: number;
}

export interface RiskLimits {
  maxPositionSize: number;
  maxTotalExposure: number;
  maxLossPerTrade: number;
  minProfitThreshold: number;
  maxSlippage: number;
}

export interface BotConfig {
  polymarketApiKey?: string;
  polymarketSecret?: string;
  polymarketPassphrase?: string;
  privateKey: string;
  chainId: number;
  marketsToMonitor: string[];
  riskLimits: RiskLimits;
  enableTrading: boolean;
  dryRun: boolean;
  latencyWarningMs: number;
  latencyAlertMs: number;
  logLevel: string;
}

export interface OrderRequest {
  marketId: string;
  outcome: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
}

export interface OrderResponse {
  orderId: string;
  success: boolean;
  message?: string;
  executedAt?: number;
  executionLatency?: number;
}
