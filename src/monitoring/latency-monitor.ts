import { LatencyMeasurement } from '../types';
import { logger } from '../utils/logger';
import { register, Histogram, Counter, Gauge } from 'prom-client';

export class LatencyMonitor {
  private measurements: LatencyMeasurement[] = [];
  private warningThresholdMs: number;
  private alertThresholdMs: number;

  // Prometheus metrics
  private latencyHistogram: Histogram;
  private operationCounter: Counter;
  private currentLatencyGauge: Gauge;

  constructor(warningThresholdMs: number = 50, alertThresholdMs: number = 100) {
    this.warningThresholdMs = warningThresholdMs;
    this.alertThresholdMs = alertThresholdMs;

    // Initialize Prometheus metrics
    this.latencyHistogram = new Histogram({
      name: 'hft_operation_latency_ms',
      help: 'Latency of operations in milliseconds',
      labelNames: ['operation'],
      buckets: [1, 5, 10, 25, 50, 75, 100, 150, 200, 300, 500],
    });

    this.operationCounter = new Counter({
      name: 'hft_operations_total',
      help: 'Total number of operations',
      labelNames: ['operation', 'status'],
    });

    this.currentLatencyGauge = new Gauge({
      name: 'hft_current_latency_ms',
      help: 'Current latency in milliseconds',
      labelNames: ['operation'],
    });
  }

  startTimer(operation: string): () => number {
    const start = process.hrtime.bigint();

    return () => {
      const end = process.hrtime.bigint();
      const latencyNs = Number(end - start);
      const latencyMs = latencyNs / 1_000_000; // Convert to milliseconds

      this.recordLatency(operation, latencyMs);
      return latencyMs;
    };
  }

  recordLatency(operation: string, latencyMs: number): void {
    const measurement: LatencyMeasurement = {
      operation,
      latency: latencyMs,
      timestamp: Date.now(),
    };

    this.measurements.push(measurement);

    // Keep only last 10000 measurements to prevent memory issues
    if (this.measurements.length > 10000) {
      this.measurements.shift();
    }

    // Update Prometheus metrics
    this.latencyHistogram.observe({ operation }, latencyMs);
    this.currentLatencyGauge.set({ operation }, latencyMs);

    // Log warnings/alerts based on thresholds
    if (latencyMs >= this.alertThresholdMs) {
      logger.error(`ALERT: High latency detected for ${operation}`, {
        latencyMs,
        threshold: this.alertThresholdMs,
      });
      this.operationCounter.inc({ operation, status: 'alert' });
    } else if (latencyMs >= this.warningThresholdMs) {
      logger.warn(`WARNING: Elevated latency for ${operation}`, {
        latencyMs,
        threshold: this.warningThresholdMs,
      });
      this.operationCounter.inc({ operation, status: 'warning' });
    } else {
      this.operationCounter.inc({ operation, status: 'ok' });
    }
  }

  getAverageLatency(operation?: string): number {
    const filtered = operation
      ? this.measurements.filter(m => m.operation === operation)
      : this.measurements;

    if (filtered.length === 0) return 0;

    const sum = filtered.reduce((acc, m) => acc + m.latency, 0);
    return sum / filtered.length;
  }

  getMaxLatency(operation?: string): number {
    const filtered = operation
      ? this.measurements.filter(m => m.operation === operation)
      : this.measurements;

    if (filtered.length === 0) return 0;

    return Math.max(...filtered.map(m => m.latency));
  }

  getMinLatency(operation?: string): number {
    const filtered = operation
      ? this.measurements.filter(m => m.operation === operation)
      : this.measurements;

    if (filtered.length === 0) return 0;

    return Math.min(...filtered.map(m => m.latency));
  }

  getP95Latency(operation?: string): number {
    const filtered = operation
      ? this.measurements.filter(m => m.operation === operation)
      : this.measurements;

    if (filtered.length === 0) return 0;

    const sorted = [...filtered].sort((a, b) => a.latency - b.latency);
    const index = Math.floor(sorted.length * 0.95);
    return sorted[index]?.latency || 0;
  }

  getP99Latency(operation?: string): number {
    const filtered = operation
      ? this.measurements.filter(m => m.operation === operation)
      : this.measurements;

    if (filtered.length === 0) return 0;

    const sorted = [...filtered].sort((a, b) => a.latency - b.latency);
    const index = Math.floor(sorted.length * 0.99);
    return sorted[index]?.latency || 0;
  }

  getStats(operation?: string) {
    return {
      average: this.getAverageLatency(operation),
      min: this.getMinLatency(operation),
      max: this.getMaxLatency(operation),
      p95: this.getP95Latency(operation),
      p99: this.getP99Latency(operation),
      sampleSize: operation
        ? this.measurements.filter(m => m.operation === operation).length
        : this.measurements.length,
    };
  }

  printStats(): void {
    const operations = [...new Set(this.measurements.map(m => m.operation))];

    logger.info('=== Latency Statistics ===');

    operations.forEach(op => {
      const stats = this.getStats(op);
      logger.info(`${op}:`, stats);
    });

    logger.info('Overall:', this.getStats());
  }

  reset(): void {
    this.measurements = [];
  }
}
