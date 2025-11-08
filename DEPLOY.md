# Deploy to DigitalOcean Server

## Step 1: SSH into Your DigitalOcean Droplet

```bash
ssh root@YOUR_DIGITALOCEAN_IP
```

## Step 2: Install Node.js (if not installed)

```bash
# Install Node.js 18+ (required)
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

## Step 3: Clone or Update the Repository

```bash
# If first time:
cd ~
git clone YOUR_REPO_URL test_bot
cd test_bot

# If already cloned:
cd ~/test_bot
git fetch origin
git checkout claude/clarify-bot-return-values-011CUu749nGuj9PLCdCcGL2i
git pull
```

## Step 4: Install Dependencies

```bash
npm install
```

## Step 5: Configure Environment Variables

Create `.env` file with your credentials:

```bash
cat > .env << 'EOF'
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
EOF
```

## Step 6: Create Kalshi Private Key File

```bash
cat > KalshiPK.txt << 'EOF'
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
EOF
```

*Replace with your actual Kalshi private key*

## Step 7: Build the Bot

```bash
npm run build
```

## Step 8: Run the Bot

### Option A: Run in Foreground (for testing)
```bash
npm start
```

### Option B: Run in Background with PM2 (recommended)
```bash
# Install PM2 globally
npm install -g pm2

# Start the bot
pm2 start npm --name "polymarket-bot" -- start

# View logs
pm2 logs polymarket-bot

# Check status
pm2 status

# Stop bot
pm2 stop polymarket-bot

# Restart bot
pm2 restart polymarket-bot
```

## Step 9: Monitor the Bot

```bash
# View recent opportunities
./check-trades.sh

# Follow live logs
tail -f logs/bot.log

# View paper trading performance
tail logs/paper-portfolio.jsonl | jq
```

## Troubleshooting

### Check WebSocket Connections
```bash
# Test Kalshi connection
npx ts-node test-kalshi.ts

# Should show:
# ✅ REST API SUCCESS
# ✅ WEBSOCKET CONNECTED
```

### Common Issues

**DNS Resolution Errors**: Make sure your DigitalOcean droplet has proper DNS configured:
```bash
cat /etc/resolv.conf
# Should show nameservers like 8.8.8.8 or your provider's DNS
```

**Port 3000 Already in Use**:
```bash
# Find and kill process using port 3000
lsof -i :3000
kill -9 <PID>
```

## What's New in This Deployment

1. ✅ **RSA-PSS Authentication** for Kalshi (fixed from HMAC)
2. ✅ **Proxy Support** (auto-detects proxy if needed)
3. ✅ **Paper Trading** with $10k virtual capital
4. ✅ **Kelly Criterion Position Sizing** (dynamic, minimum $50)
5. ✅ **Better Error Logging** for WebSocket debugging

## Expected Output on Success

```
Polymarket HFT Bot - Starting...
✅ Loaded Kalshi private key from file: ./KalshiPK.txt
Configuration loaded successfully
💰 Paper Trading initialized
Polymarket client initialized
Kalshi client initialized with WebSocket support (authenticated)
Connecting to Polymarket WebSocket... {"usingProxy":false}
WebSocket connection established ✅
Connecting to Kalshi WebSocket... {"usingProxy":false}
Kalshi WebSocket connection established ✅
```

Both WebSockets should connect successfully on a real DigitalOcean server with proper DNS.
