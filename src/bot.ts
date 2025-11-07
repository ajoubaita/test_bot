import { PolymarketClient } from './polymarket/client';
import { OrderBookManager } from './trading/orderbook-manager';
import { ArbitrageDetector } from './strategies/arbitrage-detector';
import { CrossMarketArbitrageDetector } from './strategies/cross-market-arbitrage';
import { OrderExecutor } from './trading/order-executor';
import { RiskManager } from './risk/risk-manager';
import { LatencyMonitor } from './monitoring/latency-monitor';
import { OpportunityTracker } from './monitoring/opportunity-tracker';
import { MarketScanner } from './polymarket/market-scanner';
import { MarketScorer } from './polymarket/market-scorer';
import { ComprehensiveScanner } from './polymarket/comprehensive-scanner';
import { KalshiClient } from './kalshi/client';
import { BotConfig } from './types';
import { logger } from './utils/logger';

export class PolymarketHFTBot {
  private config: BotConfig;
  private client: PolymarketClient;
  private kalshiClient: KalshiClient;
  private orderBookManager: OrderBookManager;
  private arbitrageDetector: ArbitrageDetector;
  private crossMarketDetector: CrossMarketArbitrageDetector;
  private orderExecutor: OrderExecutor;
  private riskManager: RiskManager;
  private latencyMonitor: LatencyMonitor;
  private opportunityTracker: OpportunityTracker;
  private marketScanner: MarketScanner;
  private marketScorer: MarketScorer;
  private comprehensiveScanner: ComprehensiveScanner;
  private isRunning = false;
  private detectionIntervalMs = 100; // Check for opportunities every 100ms
  private detectionTimer?: NodeJS.Timeout;
  private marketRefreshTimer?: NodeJS.Timeout;
  private crossMarketRefreshTimer?: NodeJS.Timeout;
  private readonly topMarketsCount = 200; // Monitor top 200 markets via WebSocket
  private readonly marketRefreshIntervalMs = 5 * 60 * 1000; // Refresh every 5 minutes
  private readonly crossMarketRefreshIntervalMs = 10 * 60 * 1000; // Refresh cross-market pairs every 10 minutes
  private readonly comprehensiveScanIntervalMs = 30 * 1000; // Scan ALL markets every 30 seconds
  private polymarketMarkets: any[] = []; // $10k-$50k volume markets for cross-market arbitrage
  private topPolymarketMarkets: any[] = []; // Top 200 for WebSocket monitoring

  constructor(config: BotConfig) {
    this.config = config;

    // Initialize latency monitor
    this.latencyMonitor = new LatencyMonitor(
      config.latencyWarningMs,
      config.latencyAlertMs
    );

    // Initialize opportunity tracker
    this.opportunityTracker = new OpportunityTracker();

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

    // Initialize Kalshi client for cross-market arbitrage
    this.kalshiClient = new KalshiClient(config.kalshiApiKey, config.kalshiPrivateKey);

    // Initialize cross-market arbitrage detector with CONSERVATIVE matching
    // Higher threshold prevents false positives (e.g., crypto vs sports)
    this.crossMarketDetector = new CrossMarketArbitrageDetector(
      this.kalshiClient,
      this.orderBookManager,
      0.03, // 3 cent minimum price difference
      0.7   // 70% title similarity minimum (conservative to avoid false matches)
    );

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

    // Handle cross-market arbitrage opportunities
    this.crossMarketDetector.on('opportunity', (opportunity) => {
      this.handleCrossMarketOpportunity(opportunity);
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
      // Initialize Polymarket client and WebSocket connection
      await this.client.initialize();

      // Initialize Kalshi client and WebSocket connection (if credentials provided)
      if (this.config.kalshiApiKey && this.config.kalshiPrivateKey) {
        await this.kalshiClient.initialize();
        logger.info('Kalshi WebSocket initialized for real-time cross-market arbitrage');
      } else {
        logger.warn('Kalshi WebSocket not initialized (no credentials) - will use REST API for cross-market arbitrage');
      }

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

        // Initialize cross-market arbitrage pairs
        logger.info('🔄 CROSS-MARKET: Matching markets between Kalshi and Polymarket...');
        await this.crossMarketDetector.updateMarketPairs(this.polymarketMarkets);

        // Subscribe to matched Kalshi markets on WebSocket
        const matchedPairs = this.crossMarketDetector.getMarketPairs();
        if (matchedPairs.length > 0 && this.config.kalshiApiKey && this.config.kalshiPrivateKey) {
          const kalshiTickers = matchedPairs.map(pair => pair.kalshiMarket.ticker);
          this.kalshiClient.subscribeToMarkets(kalshiTickers);
          logger.info(`✅ Subscribed to ${kalshiTickers.length} Kalshi markets for cross-market arbitrage`);
        }

        // Refresh cross-market pairs periodically
        this.crossMarketRefreshTimer = setInterval(async () => {
          logger.info('🔄 CROSS-MARKET: Refreshing market pairs...');
          await this.crossMarketDetector.updateMarketPairs(this.polymarketMarkets);
        }, this.crossMarketRefreshIntervalMs);
      }

      // Start periodic opportunity detection
      this.startOpportunityDetection();

      // Start periodic cross-market detection (slower, every 10 seconds)
      this.startCrossMarketDetection();

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

  private startCrossMarketDetection(): void {
    // Run cross-market detection every 10 seconds (slower than regular detection)
    // This is slower because it requires REST API calls to Kalshi
    setInterval(() => {
      this.detectCrossMarketOpportunities();
    }, 10000); // 10 seconds
  }

  private async discoverAndSubscribeToMarkets(): Promise<void> {
    try {
      logger.info('🔍 DUAL-LAYER DISCOVERY: Scanning and ranking all markets...');

      // Step 1: Scan ALL active markets (14-day expiry filter only)
      const allMarkets = await this.marketScanner.scanAndFilterMarkets();

      if (allMarkets.length === 0) {
        logger.warn('No active markets found');
        return;
      }

      logger.info(`Found ${allMarkets.length} active markets ending within 14 days`);

      // Filter markets for cross-market arbitrage: $10k-$50k volume
      // Sweet spot: liquid enough for execution, but broader than top 200
      const arbitrageMarkets = allMarkets.filter(m => m.volume >= 10000 && m.volume <= 50000);
      this.polymarketMarkets = arbitrageMarkets;
      logger.info(`💰 CROSS-MARKET: Filtered to ${arbitrageMarkets.length} markets with $10k-$50k volume for arbitrage matching`);

      // For WebSocket monitoring, filter to liquid markets with volume > $1000
      const liquidMarkets = allMarkets.filter(m => m.volume >= 1000);
      logger.info(`Filtered to ${liquidMarkets.length} markets with volume >= $1k for WebSocket monitoring`);

      // Step 2: Fetch spreads for liquid markets only (for spread-based scoring)
      logger.info('Fetching orderbook spreads for liquid markets...');
      const spreadFetchStart = Date.now();

      // Fetch spreads in parallel batches to avoid rate limits
      const batchSize = 10;
      for (let i = 0; i < liquidMarkets.length; i += batchSize) {
        const batch = liquidMarkets.slice(i, i + batchSize);
        const spreadPromises = batch.map(async (market) => {
          const spread = await this.marketScanner.getMarketSpread(market);
          market.spread = spread;
        });
        await Promise.all(spreadPromises);

        if ((i + batchSize) % 100 === 0) {
          logger.info(`Fetched spreads for ${Math.min(i + batchSize, liquidMarkets.length)}/${liquidMarkets.length} markets`);
        }
      }

      const spreadFetchTime = Date.now() - spreadFetchStart;
      logger.info(`Fetched spreads for ${liquidMarkets.length} markets in ${spreadFetchTime}ms`);

      // Filter out markets with no spread data (no liquidity)
      const marketsWithSpreads = liquidMarkets.filter(m => m.spread && m.spread > 0);
      logger.info(`${marketsWithSpreads.length} markets have valid spread data`);

      // Step 3: Score and rank markets by opportunity potential using spread-based scoring
      const topMarkets = this.marketScorer.selectTopMarkets(marketsWithSpreads, this.topMarketsCount);

      // Store top markets for WebSocket monitoring (limit to 200 to avoid overload)
      this.topPolymarketMarkets = topMarkets;

      logger.info('🎯 HYBRID STRATEGY:', {
        webSocketMonitoring: `Top ${topMarkets.length} liquid markets by spread × volume`,
        crossMarketMatching: `${arbitrageMarkets.length} markets with $10k-$50k volume`,
        endingWithin: '14 days',
        approach: 'Optimized for liquidity + execution speed',
      });

      // Step 4: Subscribe to top markets via WebSocket (fast layer)
      // Collect all token IDs first, then subscribe in ONE batch
      const allTokenIds: string[] = [];

      for (const market of this.topPolymarketMarkets) {
        // Get token IDs for this market
        const tokens = await this.marketScanner.getMarketTokens(market.id);
        allTokenIds.push(...tokens);
      }

      // Subscribe to all tokens in a SINGLE WebSocket message
      // Add a small delay to ensure WebSocket is fully ready
      if (allTokenIds.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        this.client.subscribeToMarkets(allTokenIds);
        logger.info(`✅ WEBSOCKET: Subscribed to ${allTokenIds.length} tokens across ${this.topPolymarketMarkets.length} top-ranked markets`);
      } else {
        logger.warn('No tokens found to subscribe to');
      }

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

  private async detectCrossMarketOpportunities(): Promise<void> {
    if (this.riskManager.shouldHaltTrading()) {
      return;
    }

    try {
      const crossMarketOpportunities = await this.crossMarketDetector.detectOpportunities();
      // Opportunities are emitted via events, no need to handle here
    } catch (error) {
      logger.error('Error detecting cross-market opportunities', { error });
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

  private async handleCrossMarketOpportunity(opportunity: any): Promise<void> {
    // Calculate buy and sell prices for clarity
    const buyPlatform = opportunity.direction === 'buy-kalshi-sell-poly' ? 'Kalshi' : 'Polymarket';
    const sellPlatform = opportunity.direction === 'buy-kalshi-sell-poly' ? 'Polymarket' : 'Kalshi';
    const buyPrice = opportunity.direction === 'buy-kalshi-sell-poly' ? opportunity.kalshiPrice : opportunity.polymarketPrice;
    const sellPrice = opportunity.direction === 'buy-kalshi-sell-poly' ? opportunity.polymarketPrice : opportunity.kalshiPrice;

    // Determine match quality
    const matchQuality = opportunity.similarityScore >= 0.85 ? 'HIGH' :
                        opportunity.similarityScore >= 0.70 ? 'MEDIUM' : 'LOW';

    const matchQualityDisplay = opportunity.similarityScore >= 0.85 ? '✅ HIGH' :
                               opportunity.similarityScore >= 0.70 ? '⚠️ MEDIUM' : '❌ LOW';

    // Track this opportunity
    this.opportunityTracker.trackOpportunity({
      timestamp: Date.now(),
      type: 'cross-market',
      matchQuality: matchQuality as 'HIGH' | 'MEDIUM' | 'LOW',
      similarityScore: opportunity.similarityScore,
      platform1: 'Polymarket',
      platform2: 'Kalshi',
      market1: opportunity.polymarketQuestion,
      market2: opportunity.kalshiTitle,
      buyPlatform,
      sellPlatform,
      buyPrice,
      sellPrice,
      spread: opportunity.priceDifference,
      expectedGrossProfit: opportunity.expectedProfit,
      expectedGrossReturn: opportunity.profitPercentage,
      executed: false,
    });

    // Check dry run mode
    if (this.config.dryRun) {
      logger.info('[DRY RUN] 🎯 CROSS-MARKET ARBITRAGE DETECTED', {
        type: opportunity.type,

        // Market matching info
        matchQuality: `${matchQualityDisplay} (${opportunity.similarityScore.toFixed(2)})`,
        polymarketMarket: opportunity.polymarketQuestion.substring(0, 80),
        kalshiMarket: opportunity.kalshiTitle.substring(0, 80),

        // Trading strategy
        strategy: `BUY on ${buyPlatform} @ $${buyPrice.toFixed(3)} → SELL on ${sellPlatform} @ $${sellPrice.toFixed(3)}`,

        // Return calculation (BEFORE fees)
        grossSpread: opportunity.priceDifference.toFixed(3),
        expectedGrossProfit: `$${opportunity.expectedProfit.toFixed(2)}`,
        grossReturn: `${(opportunity.profitPercentage * 100).toFixed(2)}%`,

        // Important warnings
        warning: opportunity.similarityScore < 0.85 ?
          '⚠️ Match quality is not HIGH - verify markets are identical before trading!' :
          'Match quality is good, but always verify before live trading',
        note: 'Returns shown are GROSS (before exchange fees, gas, slippage)',
      });
      return;
    }

    // Check if trading is enabled
    if (!this.config.enableTrading) {
      logger.info('[TRADING DISABLED] Cross-market opportunity detected but not executed', {
        direction: opportunity.direction,
        expectedProfit: opportunity.expectedProfit,
      });
      return;
    }

    // Note: Cross-platform execution would require Kalshi trading credentials
    logger.warn('Cross-market execution not yet implemented (requires Kalshi trading API)', {
      opportunity: opportunity.direction,
      expectedProfit: `$${opportunity.expectedProfit.toFixed(2)}`,
    });
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

    // Cross-market stats
    const crossMarketStats = this.crossMarketDetector.getStats();
    logger.info('Cross-Market Arbitrage Stats:', crossMarketStats);

    // Opportunity tracking stats
    const trackingStats = this.opportunityTracker.getStats();
    logger.info('Opportunity Tracking Stats:', trackingStats);
    const returnAccuracy = this.opportunityTracker.analyzeReturnAccuracy();
    if (returnAccuracy.sampleSize > 0) {
      logger.info('Return Accuracy:', returnAccuracy);
    }

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

    // Stop cross-market refresh timer
    if (this.crossMarketRefreshTimer) {
      clearInterval(this.crossMarketRefreshTimer);
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
