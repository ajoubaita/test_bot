#!/bin/bash

# Remote deployment script for DigitalOcean droplet
set -e

echo "🚀 Polymarket HFT Bot - Remote Deployment"
echo "=========================================="

# Check arguments
if [ $# -lt 2 ]; then
    echo "Usage: $0 <droplet-ip> <ssh-user> [ssh-key-path]"
    echo ""
    echo "Example:"
    echo "  $0 192.168.1.100 root"
    echo "  $0 192.168.1.100 root ~/.ssh/id_rsa"
    exit 1
fi

DROPLET_IP=$1
SSH_USER=$2
SSH_KEY=${3:-~/.ssh/id_rsa}
REMOTE_DIR="/opt/polymarket-hft-bot"

echo "📡 Target: $SSH_USER@$DROPLET_IP"
echo "🔑 SSH Key: $SSH_KEY"
echo "📁 Remote Directory: $REMOTE_DIR"
echo ""

# Check if .env file exists locally
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please create .env file from .env.example and configure it."
    exit 1
fi

# Test SSH connection
echo "🔐 Testing SSH connection..."
if ! ssh -i "$SSH_KEY" -o ConnectTimeout=10 "$SSH_USER@$DROPLET_IP" "echo 'SSH connection successful'" > /dev/null 2>&1; then
    echo "❌ Error: Cannot connect to droplet via SSH"
    echo "Please check:"
    echo "  1. Droplet IP address is correct"
    echo "  2. SSH key is correct"
    echo "  3. Firewall allows SSH (port 22)"
    exit 1
fi
echo "✅ SSH connection successful"

# Install Docker on remote if not installed
echo "🐋 Checking Docker installation on remote..."
ssh -i "$SSH_KEY" "$SSH_USER@$DROPLET_IP" << 'ENDSSH'
    if ! command -v docker &> /dev/null; then
        echo "Installing Docker..."
        curl -fsSL https://get.docker.com -o get-docker.sh
        sh get-docker.sh
        rm get-docker.sh
        systemctl enable docker
        systemctl start docker
    else
        echo "Docker already installed"
    fi

    if ! command -v docker-compose &> /dev/null; then
        echo "Installing Docker Compose..."
        curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
        chmod +x /usr/local/bin/docker-compose
    else
        echo "Docker Compose already installed"
    fi
ENDSSH
echo "✅ Docker and Docker Compose ready"

# Create remote directory
echo "📁 Creating remote directory..."
ssh -i "$SSH_KEY" "$SSH_USER@$DROPLET_IP" "mkdir -p $REMOTE_DIR"

# Copy files to remote
echo "📤 Copying files to remote..."
rsync -avz --progress -e "ssh -i $SSH_KEY" \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude 'logs' \
    --exclude '.git' \
    --exclude '*.log' \
    ./ "$SSH_USER@$DROPLET_IP:$REMOTE_DIR/"

# Deploy on remote
echo "🚀 Deploying on remote..."
ssh -i "$SSH_KEY" "$SSH_USER@$DROPLET_IP" << ENDSSH
    cd $REMOTE_DIR

    # Stop existing containers
    docker-compose down || true

    # Build and start
    docker-compose build
    docker-compose up -d

    # Wait for health check
    echo "Waiting for bot to start..."
    sleep 10

    # Check health
    MAX_RETRIES=12
    RETRY_COUNT=0
    while [ \$RETRY_COUNT -lt \$MAX_RETRIES ]; do
        if docker-compose exec -T polymarket-hft-bot node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))" 2>/dev/null; then
            echo "✅ Bot is healthy and running!"
            break
        else
            RETRY_COUNT=\$((RETRY_COUNT+1))
            if [ \$RETRY_COUNT -eq \$MAX_RETRIES ]; then
                echo "❌ Bot failed to start properly"
                docker-compose logs --tail=50
                exit 1
            fi
            echo "Retrying... (\$RETRY_COUNT/\$MAX_RETRIES)"
            sleep 5
        fi
    done
ENDSSH

echo ""
echo "✨ Remote deployment successful!"
echo ""
echo "📊 Useful commands (run on remote):"
echo "  SSH to droplet:   ssh -i $SSH_KEY $SSH_USER@$DROPLET_IP"
echo "  View logs:        docker-compose logs -f"
echo "  Check status:     docker-compose ps"
echo "  Stop bot:         docker-compose stop"
echo "  Start bot:        docker-compose start"
echo ""
echo "🔗 Remote endpoints:"
echo "  Health:           http://$DROPLET_IP:3000/health"
echo "  Status:           http://$DROPLET_IP:3000/status"
echo "  Metrics:          http://$DROPLET_IP:3000/metrics"
echo ""
echo "💡 To view logs from your local machine:"
echo "  ssh -i $SSH_KEY $SSH_USER@$DROPLET_IP 'cd $REMOTE_DIR && docker-compose logs -f'"
echo ""
