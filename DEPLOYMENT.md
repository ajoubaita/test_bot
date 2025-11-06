# Deployment Guide

This guide covers deploying the Polymarket HFT Bot to a DigitalOcean droplet (or any Linux VPS).

## Prerequisites

### Local Machine
- Docker installed
- Docker Compose installed
- SSH access to your droplet
- Git (optional, for cloning)

### DigitalOcean Droplet
- Ubuntu 20.04+ or Debian 10+
- Minimum: 2 GB RAM, 1 vCPU
- Recommended: 4 GB RAM, 2 vCPU (for better performance)
- SSH access enabled

### Polymarket API
- Polymarket CLOB API credentials (API key, secret, passphrase)
- Ethereum private key with USDC balance on Polygon
- Funded account for trading

## Quick Start

### Option 1: Automated Remote Deployment (Recommended)

1. **Configure environment variables**:
```bash
cp .env.example .env
nano .env  # Edit with your credentials
```

2. **Run the deployment script**:
```bash
./deploy-remote.sh <droplet-ip> <ssh-user> [ssh-key-path]
```

Example:
```bash
./deploy-remote.sh 192.168.1.100 root
# or with custom SSH key
./deploy-remote.sh 192.168.1.100 root ~/.ssh/my_key
```

The script will automatically:
- Install Docker and Docker Compose on the droplet
- Copy all files to the droplet
- Build the Docker image
- Start the bot
- Verify it's running

### Option 2: Manual Deployment

#### Step 1: Prepare Your Droplet

SSH into your droplet:
```bash
ssh root@your-droplet-ip
```

Install Docker:
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
systemctl enable docker
systemctl start docker
```

Install Docker Compose:
```bash
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
```

#### Step 2: Transfer Files

From your local machine:
```bash
# Using rsync (recommended)
rsync -avz --exclude 'node_modules' --exclude 'dist' --exclude '.git' \
    ./ root@your-droplet-ip:/opt/polymarket-hft-bot/

# Or using scp
scp -r . root@your-droplet-ip:/opt/polymarket-hft-bot/
```

#### Step 3: Configure Environment

SSH into your droplet and create `.env`:
```bash
ssh root@your-droplet-ip
cd /opt/polymarket-hft-bot
cp .env.example .env
nano .env
```

Configure all required variables (see Configuration section below).

#### Step 4: Deploy

```bash
cd /opt/polymarket-hft-bot
./deploy.sh
```

## Configuration

Edit `.env` with your settings:

```env
# Polymarket API Credentials (REQUIRED)
POLYMARKET_API_KEY=your_api_key_here
POLYMARKET_SECRET=your_secret_here
POLYMARKET_PASSPHRASE=your_passphrase_here
PRIVATE_KEY=your_ethereum_private_key_here  # Without 0x prefix

# Chain Configuration
CHAIN_ID=137  # Polygon mainnet (137) or Mumbai testnet (80001)

# Trading Configuration
MIN_PROFIT_THRESHOLD=0.005      # Minimum $0.005 profit per trade
MAX_POSITION_SIZE=1000          # Maximum $1000 per position
MAX_TOTAL_EXPOSURE=5000         # Maximum $5000 total exposure
MAX_SLIPPAGE=0.001              # Maximum 0.1% slippage

# Performance Configuration
LATENCY_WARNING_MS=50           # Warn if operation > 50ms
LATENCY_ALERT_MS=100            # Alert if operation > 100ms

# Market Configuration (OPTIONAL)
# Leave empty to auto-discover active markets
MARKETS_TO_MONITOR=market_id_1,market_id_2

# Safety Configuration (IMPORTANT!)
ENABLE_TRADING=false            # Set to true to enable real trading
DRY_RUN=true                    # Set to false for live trading

# Logging
LOG_LEVEL=info
```

### Getting Polymarket API Credentials

1. Go to Polymarket CLOB API documentation
2. Create an account and request API access
3. Generate API key, secret, and passphrase
4. Save them securely

### Security Best Practices

1. **Never commit `.env` to Git** - It's in `.gitignore` by default
2. **Use strong API credentials** - Rotate them regularly
3. **Limit private key funds** - Only keep necessary USDC
4. **Start with small limits** - Gradually increase exposure
5. **Enable 2FA** - On all accounts
6. **Monitor regularly** - Check logs and metrics

## Monitoring

### Health Checks

Check if the bot is running:
```bash
curl http://localhost:3000/health
```

Get detailed status:
```bash
curl http://localhost:3000/status | jq
```

### Logs

View real-time logs:
```bash
docker-compose logs -f
```

View last 100 lines:
```bash
docker-compose logs --tail=100
```

View logs for specific service:
```bash
docker-compose logs -f polymarket-hft-bot
```

### Metrics

The bot exposes Prometheus metrics at:
```
http://localhost:3000/metrics
```

To enable Prometheus and Grafana monitoring:
```bash
docker-compose --profile monitoring up -d
```

Access Grafana at `http://your-droplet-ip:3001`:
- Username: `admin`
- Password: `admin` (change on first login)

## Management Commands

### Docker Compose Commands

```bash
# Start bot
docker-compose up -d

# Stop bot
docker-compose stop

# Restart bot
docker-compose restart

# View logs
docker-compose logs -f

# Check status
docker-compose ps

# Remove containers
docker-compose down

# Rebuild and restart
docker-compose up -d --build
```

### Container Management

```bash
# Enter container shell
docker-compose exec polymarket-hft-bot sh

# View container stats
docker stats

# Inspect container
docker inspect polymarket-hft-bot
```

## Troubleshooting

### Bot Won't Start

1. Check logs:
```bash
docker-compose logs --tail=100
```

2. Verify `.env` configuration:
```bash
cat .env
```

3. Check Docker status:
```bash
docker ps -a
systemctl status docker
```

### High Latency

1. Check server resources:
```bash
htop
free -h
df -h
```

2. Review metrics:
```bash
curl http://localhost:3000/metrics | grep latency
```

3. Reduce monitored markets in `.env`

### Connection Issues

1. Check network:
```bash
ping polymarket.com
curl -I https://clob.polymarket.com
```

2. Verify firewall:
```bash
ufw status
```

3. Check WebSocket connectivity:
```bash
docker-compose logs | grep WebSocket
```

### No Opportunities Detected

This is normal - arbitrage opportunities are rare:

1. **Lower profit threshold** in `.env`:
```env
MIN_PROFIT_THRESHOLD=0.001
```

2. **Monitor more markets** - Add more market IDs or leave empty for auto-discovery

3. **Check market activity** - Ensure markets have active trading

4. **Review logs** for detection:
```bash
docker-compose logs | grep "Opportunities detected"
```

## Updating the Bot

### Pull Latest Changes

```bash
cd /opt/polymarket-hft-bot
git pull origin main  # or your branch
./deploy.sh
```

### Manual Update

```bash
# Stop bot
docker-compose down

# Update files (rsync from local machine)
rsync -avz ... root@your-droplet-ip:/opt/polymarket-hft-bot/

# Rebuild and start
docker-compose up -d --build
```

## Performance Optimization

### Server-Level Optimizations

1. **Use SSD storage** - For faster I/O
2. **Enable BBR congestion control**:
```bash
echo "net.core.default_qdisc=fq" >> /etc/sysctl.conf
echo "net.ipv4.tcp_congestion_control=bbr" >> /etc/sysctl.conf
sysctl -p
```

3. **Increase open file limits**:
```bash
echo "fs.file-max = 2097152" >> /etc/sysctl.conf
sysctl -p
```

4. **Use local Polygon RPC node** - Reduces network latency

### Bot Configuration

1. **Monitor fewer markets** - Focus on high-volume markets
2. **Increase profit threshold** - Fewer but better opportunities
3. **Optimize detection interval** - Balance between speed and CPU usage

## Backup and Recovery

### Backup Important Files

```bash
# Backup .env and logs
tar -czf backup-$(date +%Y%m%d).tar.gz .env logs/

# Store securely offsite
scp backup-*.tar.gz user@backup-server:/backups/
```

### Recovery

```bash
# Restore .env
tar -xzf backup-20240101.tar.gz

# Redeploy
./deploy.sh
```

## Scaling

### Vertical Scaling

Upgrade droplet size for:
- More markets monitored
- Lower latency
- Higher throughput

### Horizontal Scaling

Run multiple instances:
- Different market segments
- Different strategies
- Geographic distribution

## Security Hardening

1. **Change SSH port**:
```bash
nano /etc/ssh/sshd_config
# Port 2222
systemctl restart sshd
```

2. **Enable firewall**:
```bash
ufw allow 2222/tcp  # SSH
ufw allow 3000/tcp  # Health checks (optional, can restrict to localhost)
ufw enable
```

3. **Disable password auth**:
```bash
nano /etc/ssh/sshd_config
# PasswordAuthentication no
systemctl restart sshd
```

4. **Setup fail2ban**:
```bash
apt-get install fail2ban
systemctl enable fail2ban
systemctl start fail2ban
```

## Cost Estimation

### DigitalOcean Droplet Costs
- 2 GB / 1 vCPU: ~$12/month
- 4 GB / 2 vCPU: ~$24/month (recommended)
- 8 GB / 4 vCPU: ~$48/month (for high-frequency trading)

### Additional Costs
- Bandwidth: Usually included
- Snapshots: ~$0.05/GB/month (optional)
- Load balancer: ~$10/month (if needed)

### Trading Costs
- Gas fees: ~$0.01-0.10 per transaction on Polygon
- Spread costs: Varies by market
- Polymarket fees: Check current fee structure

## Support

- GitHub Issues: [Create an issue](https://github.com/yourusername/repo/issues)
- Documentation: Check README.md for detailed info
- Logs: Always check logs first when troubleshooting

## License

MIT License - See LICENSE file for details
