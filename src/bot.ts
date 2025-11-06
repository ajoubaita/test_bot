import { PolymarketClient } from './polymarket/client';
import { OrderBookManager } from './trading/orderbook-manager';
import { ArbitrageDetector } from './strategies/arbitrage-detector';
import { OrderExecutor } from './trading/order-executor';
import { RiskManager } from './risk/risk-manager';
import { LatencyMonitor } from './monitoring/latency-monitor';
import { BotConfig } from './types';
import { logger } from './utils/logger';

export class PolymarketHFTBot {
  private config: BotConfig;
  private client: PolymarketClient;
  private orderBookManager: OrderBookManager;
  private arbitrageDetector: ArbitrageDetector;
  private orderExecutor: OrderExecutor;
  private riskManager: RiskManager;
  private latencyMonitor: LatencyMonitor;
  private isRunning = false;
  private detectionIntervalMs = 100; // Check for opportunities every 100ms
  private detectionTimer?: NodeJS.Timeout;

  constructor(config: BotConfig) {
    this.config = config;

    // Initialize latency monitor
    this.latencyMonitor = new LatencyMonitor(
      config.latencyWarningMs,
      config.latencyAlertMs
    );

    // Initialize Polymarket client
    this.client = new PolymarketClient({
      apiKey: config.polymarketApiKey,
      secret: config.polymarketSecret,
      passphrase: config.polymarketPassphrase,
      privateKey: config.privateKey,
      chainId: config.chainId,
    });

    // Initialize order book manager
    this.orderBookManager = new OrderBookManager();

    // Initialize arbitrage detector
    this.arbitrageDetector = new ArbitrageDetector(
      this.orderBookManager,
      config.riskLimits
    );

    // Initialize order executor
    this.orderExecutor = new OrderExecutor(this.client, this.latencyMonitor);

    // Initialize risk manager
    this.riskManager = new RiskManager(config.riskLimits, this.orderExecutor);

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle orderbook updates from WebSocket
    this.client.on('orderbook', (orderBook) => {
      const endTimer = this.latencyMonitor.startTimer('orderbook_update');
      this.orderBookManager.updateOrderBook(orderBook);
      endTimer();
    });

    // Handle significant orderbook changes
    this.orderBookManager.on('orderbook-update', (data) => {
      if (data.isSignificant) {
        // Trigger immediate opportunity detection on significant changes
        this.detectAndExecuteOpportunities();
      }
    });

    // Handle detected opportunities
    this.arbitrageDetector.on('opportunity', (opportunity) => {
      this.handleOpportunity(opportunity);
    });

    // Handle execution events
    this.orderExecutor.on('execution-success', (data) => {
      this.riskManager.recordTrade(data.opportunity.expectedProfit, true);
    });

    this.orderExecutor.on('execution-failure', (data) => {
      this.riskManager.recordTrade(0, false);
    });

    this.orderExecutor.on('execution-error', (data) => {
      this.riskManager.recordTrade(-this.config.riskLimits.maxLossPerTrade, false);
    });

    // Handle disconnection
    this.client.on('disconnected', () => {
      logger.error('Polymarket client disconnected');
      this.stop();
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Bot is already running');
      return;
    }

    logger.info('Starting Polymarket HFT Bot', {
      dryRun: this.config.dryRun,
      enableTrading: this.config.enableTrading,
      marketsToMonitor: this.config.marketsToMonitor.length,
    });

    try {
      // Initialize client and WebSocket connection
      await this.client.initialize();

      // Subscribe to markets
      if (this.config.marketsToMonitor.length > 0) {
        for (const marketId of this.config.marketsToMonitor) {
          this.client.subscribeToMarket(marketId);
        }
      } else {
        logger.warn('No markets specified to monitor. Fetching all active markets...');
        const markets = await this.client.getMarkets();
        const activeMarkets = markets.filter(m => m.active && !m.closed).slice(0, 10); // Monitor top 10

        for (const market of activeMarkets) {
          this.client.subscribeToMarket(market.id);
        }

        logger.info(`Monitoring ${activeMarkets.length} active markets`);
      }

      // Start periodic opportunity detection
      this.startOpportunityDetection();

      // Start periodic stats reporting
      this.startStatsReporting();

      this.isRunning = true;

      logger.info('Polymarket HFT Bot started successfully');
    } catch (error) {
      logger.error('Failed to start bot', { error });
      throw error;
    }
  }

  private startOpportunityDetection(): void {
    this.detectionTimer = setInterval(() => {
      this.detectAndExecuteOpportunities();
    }, this.detectionIntervalMs);
  }

  private detectAndExecuteOpportunities(): void {
    if (this.riskManager.shouldHaltTrading()) {
      logger.error('Trading halted due to risk limits');
      this.stop();
      return;
    }

    const endTimer = this.latencyMonitor.startTimer('opportunity_detection');
    const opportunities = this.arbitrageDetector.detectOpportunities();
    const detectionLatency = endTimer();

    if (opportunities.length > 0) {
      logger.info('Opportunities detected', {
        count: opportunities.length,
        detectionLatency,
      });
    }
  }

  private async handleOpportunity(opportunity: any): Promise<void> {
    // Check if we should execute this opportunity
    const riskCheck = this.riskManager.canExecuteOpportunity(opportunity);

    if (!riskCheck.allowed) {
      logger.debug('Opportunity rejected by risk manager', {
        reason: riskCheck.reason,
        opportunity,
      });
      return;
    }

    // Check dry run mode
    if (this.config.dryRun) {
      logger.info('[DRY RUN] Would execute opportunity', {
        type: opportunity.type,
        marketId: opportunity.marketId,
        expectedProfit: opportunity.expectedProfit,
        profitPercentage: opportunity.profitPercentage,
      });
      return;
    }

    // Check if trading is enabled
    if (!this.config.enableTrading) {
      logger.info('[TRADING DISABLED] Opportunity detected but not executed', {
        type: opportunity.type,
        expectedProfit: opportunity.expectedProfit,
      });
      return;
    }

    // Execute the opportunity
    await this.orderExecutor.executeOpportunity(opportunity);
  }

  private startStatsReporting(): void {
    // Report statistics every 60 seconds
    setInterval(() => {
      this.printStats();
    }, 60000);
  }

  private printStats(): void {
    logger.info('=== Bot Statistics ===');

    // Latency stats
    this.latencyMonitor.printStats();

    // Order book stats
    const obStats = this.orderBookManager.getStats();
    logger.info('Order Book Stats:', obStats);

    // Risk stats
    const riskStats = this.riskManager.getStats();
    logger.info('Risk Stats:', riskStats);

    // Arbitrage stats
    logger.info('Arbitrage Opportunities Detected:', {
      total: this.arbitrageDetector.getOpportunityCount(),
    });

    // Execution stats
    logger.info('Active Orders:', {
      count: this.orderExecutor.getActiveOrders().length,
    });

    logger.info('Positions:', {
      count: this.orderExecutor.getPositions().length,
      totalExposure: this.orderExecutor.getTotalExposure(),
    });
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Bot is not running');
      return;
    }

    logger.info('Stopping Polymarket HFT Bot...');

    // Stop detection timer
    if (this.detectionTimer) {
      clearInterval(this.detectionTimer);
    }

    // Cancel all active orders
    await this.orderExecutor.cancelAllOrders();

    // Disconnect client
    this.client.disconnect();

    this.isRunning = false;

    logger.info('Polymarket HFT Bot stopped');

    // Print final stats
    this.printStats();
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      config: {
        dryRun: this.config.dryRun,
        enableTrading: this.config.enableTrading,
        marketsMonitored: this.config.marketsToMonitor.length,
      },
      stats: {
        latency: this.latencyMonitor.getStats(),
        orderBook: this.orderBookManager.getStats(),
        risk: this.riskManager.getStats(),
        opportunities: this.arbitrageDetector.getOpportunityCount(),
        activeOrders: this.orderExecutor.getActiveOrders().length,
        positions: this.orderExecutor.getPositions().length,
      },
    };
  }
}
