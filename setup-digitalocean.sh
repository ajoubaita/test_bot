#!/bin/bash

echo "🚀 Setting up Polymarket HFT Bot on DigitalOcean..."
echo ""

# Step 1: Create .env file
echo "📝 Creating .env file..."
cat > .env << 'ENVEOF'
# Polymarket Configuration
PRIVATE_KEY=5af2eecb46cacb22366bcaf38998dd260c788d17ec0df50527e6913dbc492358
CHAIN_ID=137

# Kalshi API Credentials
KALSHI_API_KEY=6a94293f-acd8-4aef-8794-0606e4c520e9
KALSHI_PRIVATE_KEY=./KalshiPK.txt

# Trading Configuration
MIN_PROFIT_THRESHOLD=0.005
MAX_POSITION_SIZE=1000
MAX_TOTAL_EXPOSURE=5000
MAX_SLIPPAGE=0.001

# Risk Management
ENABLE_TRADING=false
DRY_RUN=true
MAX_LOSS_PER_TRADE=100

# Performance Configuration
LATENCY_WARNING_MS=50
LATENCY_ALERT_MS=100

# Logging
LOG_LEVEL=info
ENVEOF

echo "✅ .env file created"
echo ""

# Step 2: Create Kalshi private key file
echo "📝 Creating Kalshi private key file..."
cat > KalshiPK.txt << 'KEYEOF'
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAvH1EwR5FztQevPBbmJx1VVl8J3rdjfSEKHwDGqI7u+7cF7Pa
A0LHLPEPmBwJJINUoT8g5RslFbQGX/cVZqt/cWnbr7q8AhXNi/Qd+jJJBKJY4hEH
OVz+cFh/JVzcUg5pRdqIJKJ2Y5rSAOL0jY2c1KLMpqNYxjF4YhN3tJCPPG5d6QZF
4HqxnEXwHvFR8Lv9GYyVKn8pVTd8F7m9Gq4bJDVHRxO0YJ3cV3lJpqJGR0pZFqKV
E1sF0VQz4iNGLBxVJHLzEFyZRzVJqvFp8fHYhVYnNXGJ5FqJRzqNGFLHJLBFVYZL
FqJRGLNBqKLVYVGJFqVGJZqFHYNGJ5qZJBFVYVGJHwIDAQABAoIBABoJjzsQ9qgI
qz/pJ5Y8WqNH2rNq3f9Q+8qYJpT8CqNXvJH5BqLJ+pQJFVYZJGqFYhNGJ5VGJZqF
YNGJHVGJqZJBFVYVGJZqFHYNGJ5qZJBFVYVGJZqFHYNGJ5qZJBFVYVGJZqFHYNGJ
5qZJBFVYVGJZqFHYNGJ5qZJBFVYVGJZqFHYNGJ5qZJBFVYVGJZqFHYNGJ5qZJBFV
YVGJZqFHYNGJ5qZJBFVYVGJZqFHYNGJ5qZJBFVYVGJZqFHYNGJ5qZJBFVYVGJZqF
HYNGJ5qZJBFVYVGJZqFHYNGJ5qZJBFVYVGJZqFHYNGJ5qZJBFVYVGJZqFHYNGJ5q
ZJBFVYVGJZqFHYNGJ5qZJBFVYVGJZqFHYNGJ5qZJBFVYVECgYEA4vQ8fHYNGJ5q
ZJBFVYVGJZqFHYNGJ5qZJBFVYVGJZqFHYNGJ5qZJBFVYVGJZqFHYNGJ5qZJBFVYV
GJZqFHYNGJ5qZJBFVYVGJZqFHYNGJ5qZJBFVYVGJZqFHYNGJ5qZJBFVYVGJZqFHY
NGJ5qZJBFVYVGJZqFHYNGJ5qZJBFVYVGJZqFHYNGJ5qZJBFVYVGJZqFHYNGJ5qZJ
BFVYVGJZqFHYNGJ5qZJBFVYVGJZqFHYNGJ5qZJBFVYVGJZqFHYNGJ5qZJBFVYVGJ
ZqFHYNGJ5qZJBFVYVECgYEA0tQ8
-----END RSA PRIVATE KEY-----
KEYEOF

chmod 600 KalshiPK.txt
echo "✅ Kalshi private key file created"
echo ""

# Step 3: Install dependencies
echo "📦 Installing dependencies..."
npm install
echo "✅ Dependencies installed"
echo ""

# Step 4: Build the bot
echo "🔨 Building bot..."
npm run build
echo "✅ Build complete"
echo ""

# Step 5: Create logs directory
mkdir -p logs
echo "✅ Logs directory created"
echo ""

echo "✅ Setup complete!"
echo ""
echo "To start the bot:"
echo "  npm start                    # Run in foreground"
echo "  pm2 start npm --name bot -- start  # Run with PM2"
echo ""
echo "To monitor:"
echo "  ./check-trades.sh           # View opportunities and paper trades"
echo "  tail -f logs/bot.log        # Follow logs"
echo ""
