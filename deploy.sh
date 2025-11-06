#!/bin/bash

# Deployment script for Polymarket HFT Bot
set -e

echo "🚀 Polymarket HFT Bot - Deployment Script"
echo "=========================================="

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please create .env file from .env.example and configure it."
    exit 1
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed!"
    echo "Please install Docker first: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Error: Docker Compose is not installed!"
    echo "Please install Docker Compose first: https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✅ Prerequisites checked"
echo ""

# Stop existing containers
echo "🛑 Stopping existing containers..."
docker-compose down || true

# Build the image
echo "🔨 Building Docker image..."
docker-compose build

# Start the bot
echo "▶️  Starting bot..."
docker-compose up -d

# Wait for health check
echo "⏳ Waiting for bot to be healthy..."
sleep 10

# Check health
MAX_RETRIES=12
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if docker-compose exec -T polymarket-hft-bot node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))" 2>/dev/null; then
        echo "✅ Bot is healthy and running!"
        break
    else
        RETRY_COUNT=$((RETRY_COUNT+1))
        if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
            echo "❌ Bot failed to start properly"
            echo "Showing logs:"
            docker-compose logs --tail=50
            exit 1
        fi
        echo "Retrying... ($RETRY_COUNT/$MAX_RETRIES)"
        sleep 5
    fi
done

echo ""
echo "✨ Deployment successful!"
echo ""
echo "📊 Useful commands:"
echo "  View logs:        docker-compose logs -f"
echo "  Check status:     docker-compose ps"
echo "  Stop bot:         docker-compose stop"
echo "  Start bot:        docker-compose start"
echo "  Restart bot:      docker-compose restart"
echo "  Remove bot:       docker-compose down"
echo ""
echo "🔗 Endpoints:"
echo "  Health:           http://localhost:3000/health"
echo "  Status:           http://localhost:3000/status"
echo "  Metrics:          http://localhost:3000/metrics"
echo ""
