# Quick Deployment Guide

Your bot is ready to deploy! Follow these steps to get it running on your DigitalOcean droplet.

## Droplet Information
- **IP Address**: 159.203.96.246
- **Configuration**: DRY_RUN mode (safe testing)
- **Credentials**: Configured with your private key

## Option 1: Automated Deployment (From Your Local Machine)

If you have SSH access configured on your local machine:

```bash
# Clone or download the repository to your local machine
git clone <your-repo-url>
cd test_bot

# Make sure .env file is present
# (I've already created it with your credentials)

# Run the deployment script
./deploy-remote.sh 159.203.96.246 root
```

## Option 2: Manual Deployment

### Step 1: SSH into your droplet

```bash
ssh root@159.203.96.246
```

### Step 2: Install Docker and Docker Compose

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
systemctl enable docker
systemctl start docker

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Verify installations
docker --version
docker-compose --version
```

### Step 3: Transfer files to droplet

From your **local machine** (not the droplet):

```bash
# Using rsync (recommended)
rsync -avz --exclude 'node_modules' --exclude 'dist' --exclude '.git' \
    ./ root@159.203.96.246:/opt/polymarket-hft-bot/

# OR using scp
scp -r . root@159.203.96.246:/opt/polymarket-hft-bot/
```

### Step 4: Deploy on droplet

SSH back into your droplet and run:

```bash
cd /opt/polymarket-hft-bot
docker-compose build
docker-compose up -d
```

### Step 5: Verify deployment

```bash
# Check if container is running
docker-compose ps

# View logs
docker-compose logs -f

# Check health
curl http://localhost:3000/health

# Check detailed status
curl http://localhost:3000/status | jq
```

## Option 3: Quick Test (Git Clone on Droplet)

If your code is in a git repository:

```bash
# SSH into droplet
ssh root@159.203.96.246

# Install git if needed
apt-get update && apt-get install -y git

# Clone repository
cd /opt
git clone <your-repo-url> polymarket-hft-bot
cd polymarket-hft-bot

# Create .env file
cat > .env << 'EOF'
PRIVATE_KEY=5af2eecb46cacb22366bcaf38998dd260c788d17ec0df50527e6913dbc492358
CHAIN_ID=137
MIN_PROFIT_THRESHOLD=0.005
MAX_POSITION_SIZE=100
MAX_TOTAL_EXPOSURE=500
MAX_SLIPPAGE=0.001
LATENCY_WARNING_MS=50
LATENCY_ALERT_MS=100
MARKETS_TO_MONITOR=
ENABLE_TRADING=false
DRY_RUN=true
MAX_LOSS_PER_TRADE=50
LOG_LEVEL=info
EOF

# Install Docker (if not already installed)
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose (if not already installed)
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Deploy
docker-compose up -d --build

# View logs
docker-compose logs -f
```

## Monitoring Your Bot

### View Logs
```bash
docker-compose logs -f
```

### Check Status
```bash
# From droplet
curl http://localhost:3000/status | jq

# From your local machine (if port is open)
curl http://159.203.96.246:3000/status | jq
```

### View Metrics
```bash
curl http://localhost:3000/metrics
```

## What to Expect

The bot is configured in **DRY_RUN mode**, which means:
- ✅ Connects to Polymarket API
- ✅ Streams real-time market data
- ✅ Detects arbitrage opportunities
- ✅ Logs what trades it WOULD make
- ❌ Does NOT execute real trades

You should see logs like:
```
Polymarket HFT Bot - Starting...
Configuration loaded successfully
Polymarket client initialized
WebSocket connection established
Subscribed to market
Opportunities detected { count: 2, detectionLatency: 8.5 }
[DRY RUN] Would execute opportunity { type: 'spread', expectedProfit: 0.042 }
```

## Next Steps After Testing

Once you verify the bot is working correctly:

1. **Monitor for a while** - Let it run in DRY_RUN mode to see opportunity detection

2. **Review the logs** - Check for any errors or issues

3. **Adjust configuration** - Tune parameters based on observations

4. **Enable trading** (when ready):
```bash
# Edit .env on droplet
nano /opt/polymarket-hft-bot/.env

# Change these lines:
ENABLE_TRADING=true
DRY_RUN=false

# Restart bot
docker-compose restart
```

## Troubleshooting

### SSH Connection Issues
```bash
# From your local machine, test SSH
ssh -v root@159.203.96.246

# If connection refused, check DigitalOcean console
# Make sure SSH is enabled and firewall allows port 22
```

### Container Won't Start
```bash
# Check logs
docker-compose logs

# Check if ports are in use
netstat -tlnp | grep 3000

# Rebuild from scratch
docker-compose down
docker-compose up -d --build
```

### No Opportunities Detected
This is normal - arbitrage opportunities are rare. The bot will:
- Monitor active markets automatically
- Detect opportunities when they occur
- Log them in DRY_RUN mode

## Support

If you encounter issues, check:
1. Docker logs: `docker-compose logs`
2. Bot status: `curl http://localhost:3000/status`
3. Container status: `docker-compose ps`

## Security Note

⚠️ Your private key is in the `.env` file. Make sure:
- Never commit `.env` to git (it's in `.gitignore`)
- Secure your droplet with SSH keys only
- Enable UFW firewall
- Only keep necessary funds in the wallet
