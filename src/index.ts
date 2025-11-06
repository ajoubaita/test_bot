import { PolymarketHFTBot } from './bot';
import { loadConfig, validateConfig } from './config';
import { logger } from './utils/logger';
import { HealthServer } from './server/health-server';

async function main() {
  let healthServer: HealthServer | null = null;

  try {
    logger.info('Polymarket HFT Bot - Starting...');

    // Load and validate configuration
    const config = loadConfig();
    validateConfig(config);

    logger.info('Configuration loaded successfully', {
      dryRun: config.dryRun,
      enableTrading: config.enableTrading,
      marketsToMonitor: config.marketsToMonitor.length,
    });

    // Create bot instance
    const bot = new PolymarketHFTBot(config);

    // Start health server
    healthServer = new HealthServer(bot, 3000);
    healthServer.start();

    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down gracefully...');
      if (healthServer) {
        healthServer.stop();
      }
      await bot.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error });
      if (healthServer) {
        healthServer.stop();
      }
      bot.stop().then(() => {
        process.exit(1);
      });
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', { reason, promise });
      if (healthServer) {
        healthServer.stop();
      }
      bot.stop().then(() => {
        process.exit(1);
      });
    });

    // Start the bot
    await bot.start();

    logger.info('Polymarket HFT Bot is now running. Press Ctrl+C to stop.');
  } catch (error) {
    logger.error('Failed to start bot', { error });
    if (healthServer) {
      healthServer.stop();
    }
    process.exit(1);
  }
}

// Run the bot
main();
