#!/bin/bash

# Start Polymarket HFT Bot on DigitalOcean (no proxy)
# This script unsets proxy variables to allow direct WebSocket connections

echo "🚀 Starting Polymarket HFT Bot on DigitalOcean..."
echo ""

# Unset proxy variables for direct connections
unset HTTP_PROXY
unset HTTPS_PROXY
unset http_proxy
unset https_proxy
unset NO_PROXY
unset no_proxy

echo "✅ Proxy variables cleared for direct connection"
echo "📡 Bot will connect directly to:"
echo "   - Polymarket: wss://ws-subscriptions-clob.polymarket.com"
echo "   - Kalshi: wss://api.elections.kalshi.com"
echo ""

# Start the bot
npm start
