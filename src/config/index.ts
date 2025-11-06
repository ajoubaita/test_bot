import dotenv from 'dotenv';
import { BotConfig } from '../types';

dotenv.config();

export function loadConfig(): BotConfig {
  // Only private key is required - API credentials will be auto-generated if not provided
  if (!process.env.PRIVATE_KEY) {
    throw new Error('Missing required environment variable: PRIVATE_KEY');
  }

  return {
    polymarketApiKey: process.env.POLYMARKET_API_KEY,
    polymarketSecret: process.env.POLYMARKET_SECRET,
    polymarketPassphrase: process.env.POLYMARKET_PASSPHRASE,
    privateKey: process.env.PRIVATE_KEY,
    chainId: parseInt(process.env.CHAIN_ID || '137', 10),
    marketsToMonitor: process.env.MARKETS_TO_MONITOR?.split(',').filter(Boolean) || [],
    riskLimits: {
      minProfitThreshold: parseFloat(process.env.MIN_PROFIT_THRESHOLD || '0.005'),
      maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE || '1000'),
      maxTotalExposure: parseFloat(process.env.MAX_TOTAL_EXPOSURE || '5000'),
      maxLossPerTrade: parseFloat(process.env.MAX_LOSS_PER_TRADE || '100'),
      maxSlippage: parseFloat(process.env.MAX_SLIPPAGE || '0.001'),
    },
    enableTrading: process.env.ENABLE_TRADING === 'true',
    dryRun: process.env.DRY_RUN !== 'false', // Default to true for safety
    latencyWarningMs: parseInt(process.env.LATENCY_WARNING_MS || '50', 10),
    latencyAlertMs: parseInt(process.env.LATENCY_ALERT_MS || '100', 10),
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

export function validateConfig(config: BotConfig): void {
  // Validate configuration values
  if (config.riskLimits.minProfitThreshold <= 0) {
    throw new Error('MIN_PROFIT_THRESHOLD must be positive');
  }

  if (config.riskLimits.maxPositionSize <= 0) {
    throw new Error('MAX_POSITION_SIZE must be positive');
  }

  if (config.riskLimits.maxTotalExposure <= 0) {
    throw new Error('MAX_TOTAL_EXPOSURE must be positive');
  }

  if (config.riskLimits.maxSlippage < 0 || config.riskLimits.maxSlippage > 1) {
    throw new Error('MAX_SLIPPAGE must be between 0 and 1');
  }

  if (config.chainId !== 137 && config.chainId !== 80001) {
    console.warn('Warning: Unexpected chain ID. Polymarket typically uses Polygon (137)');
  }

  if (config.enableTrading && config.dryRun) {
    console.warn('Warning: ENABLE_TRADING is true but DRY_RUN is also true. No actual trades will be executed.');
  }
}
