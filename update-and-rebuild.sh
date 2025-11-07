#!/bin/bash
# Quick update and rebuild script

echo "🔄 Updating Polymarket HFT Bot..."

# Find npm
NPM_PATH=$(which npm 2>/dev/null)

if [ -z "$NPM_PATH" ]; then
    echo "❌ npm not found in PATH"
    echo "Checking common locations..."

    if [ -f /opt/node22/bin/npm ]; then
        NPM_PATH=/opt/node22/bin/npm
        echo "✅ Found npm at: $NPM_PATH"
    elif [ -f /usr/bin/npm ]; then
        NPM_PATH=/usr/bin/npm
        echo "✅ Found npm at: $NPM_PATH"
    else
        echo "❌ npm not found. Please install Node.js first:"
        echo "   curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"
        echo "   apt-get install -y nodejs"
        exit 1
    fi
else
    echo "✅ Found npm at: $NPM_PATH"
fi

# Show Node/npm versions
echo ""
echo "📦 Node version: $($NPM_PATH --version 2>&1 | head -1)"

# Pull latest changes
echo ""
echo "📥 Pulling latest code..."
git pull origin claude/polymarket-trading-bot-011CUqjV9mQ5yuRRS2Msyvvb

# Install dependencies (if needed)
echo ""
echo "📦 Installing dependencies..."
$NPM_PATH install

# Build
echo ""
echo "🔨 Building TypeScript..."
$NPM_PATH run build

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Build successful!"
    echo ""
    echo "📁 Build output:"
    ls -lh dist/ | head -10
    echo ""
    echo "🚀 Next steps:"
    echo "   1. Stop current bot:  ps aux | grep node"
    echo "   2. Then:              kill <PID>"
    echo "   3. Restart:           npm start 2>&1 | tee bot.log | ./filter-trades.sh"
else
    echo ""
    echo "❌ Build failed! Check errors above."
    exit 1
fi
