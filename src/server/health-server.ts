import http from 'http';
import { register } from 'prom-client';
import { logger } from '../utils/logger';
import { PolymarketHFTBot } from '../bot';

export class HealthServer {
  private server: http.Server | null = null;
  private port: number;
  private bot: PolymarketHFTBot;

  constructor(bot: PolymarketHFTBot, port: number = 3000) {
    this.bot = bot;
    this.port = port;
  }

  start(): void {
    this.server = http.createServer((req, res) => {
      // Set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      // Health check endpoint
      if (req.url === '/health' && req.method === 'GET') {
        const status = this.bot.getStatus();
        const isHealthy = status.isRunning;

        res.writeHead(isHealthy ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: isHealthy ? 'healthy' : 'unhealthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
        }));
        return;
      }

      // Status endpoint with detailed information
      if (req.url === '/status' && req.method === 'GET') {
        const status = this.bot.getStatus();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ...status,
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          memory: process.memoryUsage(),
        }, null, 2));
        return;
      }

      // Prometheus metrics endpoint
      if (req.url === '/metrics' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': register.contentType });
        register.metrics().then(metrics => {
          res.end(metrics);
        }).catch(err => {
          res.writeHead(500);
          res.end('Error generating metrics');
          logger.error('Error generating metrics', { error: err });
        });
        return;
      }

      // 404 for other routes
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Not found',
        availableEndpoints: ['/health', '/status', '/metrics'],
      }));
    });

    this.server.listen(this.port, () => {
      logger.info(`Health server started on port ${this.port}`);
    });

    this.server.on('error', (error) => {
      logger.error('Health server error', { error });
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close(() => {
        logger.info('Health server stopped');
      });
      this.server = null;
    }
  }
}
