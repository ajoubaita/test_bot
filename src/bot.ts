import { PolymarketClient } from './polymarket/client';
import { OrderBookManager } from './trading/orderbook-manager';
import { ArbitrageDetector } from './strategies/arbitrage-detector';
import { OrderExecutor } from './trading/order-executor';
import { RiskManager } from './risk/risk-manager';
import { LatencyMonitor } from './monitoring/latency-monitor';
import { MarketScanner } from './polymarket/market-scanner';
import { MarketScorer } from './polymarket/market-scorer';
import { ComprehensiveScanner } from './polymarket/comprehensive-scanner';
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
  private marketScanner: MarketScanner;
  private marketScorer: MarketScorer;
  private comprehensiveScanner: ComprehensiveScanner;
  private isRunning = false;
  private detectionIntervalMs = 100; // Check for opportunities every 100ms
  private detectionTimer?: NodeJS.Timeout;
  private marketRefreshTimer?: NodeJS.Timeout;
  private readonly topMarketsCount = 100; // Monitor top 100 markets via WebSocket to avoid rate limits
  private readonly marketRefreshIntervalMs = 5 * 60 * 1000; // Refresh every 5 minutes
  private readonly comprehensiveScanIntervalMs = 30 * 1000; // Scan ALL markets every 30 seconds

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

    // Initialize market scanner with volume range $10k-$100k
    this.marketScanner = new MarketScanner(10000, 100000);

    // Initialize market scorer for ranking markets
    this.marketScorer = new MarketScorer();

    // Initialize comprehensive scanner for ALL markets (30s interval)
    this.comprehensiveScanner = new ComprehensiveScanner(this.comprehensiveScanIntervalMs);

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
        logger.info('Using manually specified markets');
        for (const marketId of this.config.marketsToMonitor) {
          this.client.subscribeToMarket(marketId);
        }
      } else {
        logger.info('Auto-scanning markets with volume $10k-$100k...');
        await this.discoverAndSubscribeToMarkets();

        // Refresh market list periodically
        this.marketRefreshTimer = setInterval(async () => {
          logger.info('🔄 HYBRID SCAN: Refreshing market rankings...');
          await this.discoverAndSubscribeToMarkets();
        }, this.marketRefreshIntervalMs);
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

  private async discoverAndSubscribeToMarkets(): Promise<void> {
    try {
      logger.info('🔍 DUAL-LAYER DISCOVERY: Scanning and ranking all markets...');

      // Step 1: Scan all markets matching volume criteria
      const allMarkets = await this.marketScanner.scanAndFilterMarkets();

      if (allMarkets.length === 0) {
        logger.warn('No markets found matching volume criteria ($10k-$100k)');
        return;
      }

      logger.info(`Found ${allMarkets.length} markets matching volume criteria`);

      // Filter to markets with volume > $1000 to focus on liquid markets
      const liquidMarkets = allMarkets.filter(m => m.volume >= 1000);
      logger.info(`Filtered to ${liquidMarkets.length} markets with volume >= $1k`);

      // Step 2: Score and rank markets by opportunity potential
      const topMarkets = this.marketScorer.selectTopMarkets(liquidMarkets, this.topMarketsCount);

      logger.info('🎯 WEBSOCKET-ONLY STRATEGY:', {
        monitoring: `Top ${topMarkets.length} highest-volume markets`,
        totalAvailable: `${allMarkets.length} active markets discovered`,
        approach: 'Real-time WebSocket monitoring (avoids rate limits)',
      });

      // Step 3: Subscribe to top markets via WebSocket (fast layer)
      let subscribedCount = 0;
      for (const market of topMarkets) {
        // Get token IDs for this market
        const tokens = await this.marketScanner.getMarketTokens(market.id);

        if (tokens.length > 0) {
          for (const tokenId of tokens) {
            this.client.subscribeToMarket(tokenId);
            subscribedCount++;
          }
        }
      }

      logger.info(`✅ FAST LAYER: Monitoring ${subscribedCount} tokens across ${topMarkets.length} top-ranked markets via WebSocket`);

      // NOTE: Comprehensive REST API scanner disabled due to rate limiting (HTTP 429)
      // Polymarket API limits prevent polling thousands of markets every 30s
      // WebSocket-only approach for now
      logger.info(`⚠️ REST API polling disabled to avoid rate limits. Using WebSocket-only monitoring.`);
    } catch (error) {
      logger.error('Error discovering markets', { error });
    }
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

    // Stop market refresh timer
    if (this.marketRefreshTimer) {
      clearInterval(this.marketRefreshTimer);
    }

    // Stop comprehensive scanner
    this.comprehensiveScanner.stopScanning();

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
