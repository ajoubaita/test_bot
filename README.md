# Polymarket High-Frequency Trading Bot

A high-performance trading bot designed to identify and execute arbitrage opportunities on Polymarket with sub-100ms latency targets.

## Features

- **Real-time Market Data Streaming**: WebSocket-based order book updates with minimal latency
- **Multiple Arbitrage Strategies**:
  - Spread arbitrage (crossed order books)
  - YES/NO imbalance arbitrage (binary market inefficiencies)
  - Cross-market arbitrage (correlated markets)
- **Advanced Latency Monitoring**: Track and optimize every operation with detailed metrics
- **Comprehensive Risk Management**: Position limits, exposure limits, and automated safety checks
- **Order Book Management**: Efficient in-memory order book tracking and analysis
- **Prometheus Metrics**: Built-in performance monitoring and metrics export
- **Dry-run Mode**: Test strategies without real capital

## Architecture

### Core Components

1. **PolymarketClient** (`src/polymarket/client.ts`)
   - WebSocket integration for real-time data
   - Order placement and management
   - Automatic reconnection handling

2. **OrderBookManager** (`src/trading/orderbook-manager.ts`)
   - In-memory order book storage
   - Best bid/ask tracking
   - Spread and liquidity calculations
   - Volume-weighted price calculations

3. **ArbitrageDetector** (`src/strategies/arbitrage-detector.ts`)
   - Spread arbitrage detection
   - YES/NO imbalance detection
   - Cross-market opportunity identification
   - Sub-millisecond detection latency

4. **OrderExecutor** (`src/trading/order-executor.ts`)
   - Fast order execution
   - Position tracking
   - Execution queue management
   - Latency-optimized order placement

5. **RiskManager** (`src/risk/risk-manager.ts`)
   - Position size limits
   - Total exposure monitoring
   - Slippage control
   - Daily P&L tracking
   - Automatic trading halt on risk breaches

6. **LatencyMonitor** (`src/monitoring/latency-monitor.ts`)
   - High-resolution latency tracking
   - P95/P99 percentile calculations
   - Prometheus metrics export
   - Alert thresholds

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd test_bot

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env
```

## Configuration

Edit `.env` file with your settings:

```env
# Polymarket API credentials
POLYMARKET_API_KEY=your_api_key
POLYMARKET_SECRET=your_secret
POLYMARKET_PASSPHRASE=your_passphrase
PRIVATE_KEY=your_ethereum_private_key

# Chain configuration
CHAIN_ID=137  # Polygon mainnet

# Trading configuration
MIN_PROFIT_THRESHOLD=0.005      # Minimum $0.005 profit per trade
MAX_POSITION_SIZE=1000          # Maximum $1000 per position
MAX_TOTAL_EXPOSURE=5000         # Maximum $5000 total exposure
MAX_SLIPPAGE=0.001              # Maximum 0.1% slippage

# Performance configuration
LATENCY_WARNING_MS=50           # Warn if operation > 50ms
LATENCY_ALERT_MS=100            # Alert if operation > 100ms

# Market configuration
MARKETS_TO_MONITOR=market_id_1,market_id_2  # Comma-separated market IDs

# Safety configuration
ENABLE_TRADING=false            # Set to true to enable real trading
DRY_RUN=true                    # Set to false for live trading

# Logging
LOG_LEVEL=info
```

## Usage

### Build the project

```bash
npm run build
```

### Run in development mode

```bash
npm run dev
```

### Run in production mode

```bash
npm start
```

### Development workflow

```bash
# Watch for changes and recompile
npm run watch
```

## Performance Optimization

### Achieving <100ms Latency

1. **WebSocket Streaming**: Direct market data streaming eliminates polling delays
2. **In-Memory Order Books**: Fast access to market data without API calls
3. **Event-Driven Architecture**: React to market changes immediately
4. **Optimized Detection**: Efficient algorithms for opportunity identification
5. **Queue-based Execution**: Minimize context switching overhead

### Latency Breakdown (Target)

- Market data ingestion: <5ms
- Order book update: <1ms
- Arbitrage detection: <10ms
- Risk check: <5ms
- Order execution: <50ms
- **Total: <100ms**

**Note**: Blockchain transaction confirmation will take longer (1-3 seconds on Polygon), but the bot detects and submits within the latency target.

## Risk Management

The bot includes multiple layers of risk protection:

1. **Pre-trade Checks**:
   - Minimum profit threshold
   - Position size limits
   - Total exposure limits
   - Slippage tolerance

2. **Runtime Monitoring**:
   - Daily P&L tracking
   - Maximum drawdown limits
   - Automatic trading halt on breaches

3. **Safety Features**:
   - Dry-run mode for testing
   - Trading enable/disable flag
   - Graceful shutdown on errors
   - Order cancellation on shutdown

## Arbitrage Strategies

### 1. Spread Arbitrage

Exploits crossed order books where bid > ask. Immediate profit by simultaneous buy/sell.

```
Best Bid: $0.52
Best Ask: $0.48
Opportunity: Buy at $0.48, sell at $0.52 = $0.04 profit
```

### 2. YES/NO Imbalance

In binary markets, YES + NO should equal ~$1.00. Exploits deviations.

```
YES Ask: $0.45
NO Ask: $0.50
Total: $0.95 (should be $1.00)
Opportunity: Buy both for $0.95, redeem for $1.00 = $0.05 profit
```

### 3. Cross-Market Arbitrage

Exploits pricing inefficiencies between correlated markets.

## Monitoring

### Console Output

The bot logs all operations with timestamps and latency measurements:

```
2024-11-06 [info]: Polymarket HFT Bot started successfully
2024-11-06 [info]: Opportunities detected { count: 3, detectionLatency: 8.2 }
2024-11-06 [info]: Executing arbitrage opportunity { type: 'spread', expectedProfit: 0.042 }
```

### Statistics

The bot prints detailed statistics every 60 seconds:

- Latency metrics (average, min, max, P95, P99)
- Order book update counts
- Risk metrics (P&L, exposure, drawdown)
- Execution statistics

### Prometheus Metrics

Metrics are exposed for Prometheus monitoring:

- `hft_operation_latency_ms`: Operation latency histogram
- `hft_operations_total`: Total operations counter
- `hft_current_latency_ms`: Current latency gauge

## Project Structure

```
test_bot/
├── src/
│   ├── bot.ts                      # Main bot orchestrator
│   ├── index.ts                    # Entry point
│   ├── types/
│   │   └── index.ts                # TypeScript type definitions
│   ├── config/
│   │   └── index.ts                # Configuration management
│   ├── polymarket/
│   │   └── client.ts               # Polymarket API client
│   ├── trading/
│   │   ├── orderbook-manager.ts    # Order book management
│   │   └── order-executor.ts       # Order execution
│   ├── strategies/
│   │   └── arbitrage-detector.ts   # Arbitrage detection
│   ├── risk/
│   │   └── risk-manager.ts         # Risk management
│   ├── monitoring/
│   │   └── latency-monitor.ts      # Latency tracking
│   └── utils/
│       └── logger.ts               # Logging utility
├── logs/                           # Log files
├── dist/                           # Compiled JavaScript
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Safety and Warnings

⚠️ **IMPORTANT SAFETY NOTES**:

1. **Start with Dry-run Mode**: Always test with `DRY_RUN=true` first
2. **Use Small Limits**: Start with small position and exposure limits
3. **Monitor Closely**: Watch the bot closely during initial runs
4. **Blockchain Latency**: Actual trade execution depends on blockchain confirmation (1-3s on Polygon)
5. **API Rate Limits**: Polymarket API has rate limits - the bot handles this but be aware
6. **Gas Fees**: Each trade incurs gas fees that reduce profits
7. **Market Risk**: Markets can move against you before execution completes
8. **Smart Contract Risk**: Polymarket uses smart contracts - understand the risks

## Development

### Running Tests

```bash
npm test
```

### Linting

```bash
npm run lint
```

## Performance Tips

1. **Reduce Markets**: Monitor fewer markets for lower latency
2. **Optimize Thresholds**: Higher profit thresholds = fewer opportunities but better quality
3. **Local Node**: Use a local Polygon RPC node for faster transaction submission
4. **WebSocket Stability**: Ensure stable internet connection for WebSocket reliability

## Troubleshooting

### High Latency

- Check internet connection
- Reduce number of monitored markets
- Review latency statistics to identify bottlenecks

### No Opportunities Detected

- Markets may be efficient (rare arbitrage)
- Lower `MIN_PROFIT_THRESHOLD`
- Monitor more markets
- Check that markets are active

### Connection Issues

- Verify API credentials
- Check Polymarket API status
- Review WebSocket connection logs

## Contributing

Contributions welcome! Please ensure:

- Code follows TypeScript best practices
- All tests pass
- Latency-critical paths are optimized
- Risk management is not compromised

## License

MIT

## Disclaimer

This software is provided for educational and research purposes. Trading involves substantial risk of loss. Use at your own risk. The authors are not responsible for any financial losses incurred while using this software.

**This is not financial advice. Always do your own research.**
