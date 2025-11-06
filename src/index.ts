import { PolymarketHFTBot } from './bot';
import { loadConfig, validateConfig } from './config';
import { logger } from './utils/logger';

async function main() {
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

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      await bot.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      await bot.stop();
      process.exit(0);
    });

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error });
      bot.stop().then(() => {
        process.exit(1);
      });
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', { reason, promise });
      bot.stop().then(() => {
        process.exit(1);
      });
    });

    // Start the bot
    await bot.start();

    logger.info('Polymarket HFT Bot is now running. Press Ctrl+C to stop.');
  } catch (error) {
    logger.error('Failed to start bot', { error });
    process.exit(1);
  }
}

// Run the bot
main();
