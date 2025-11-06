#!/bin/bash
# Complete deployment commands for DigitalOcean droplet
# Copy and paste these commands into your droplet terminal

set -e

echo "🚀 Polymarket HFT Bot - Deployment"
echo "=================================="

# Navigate to deployment directory
cd /opt
mkdir -p polymarket-hft-bot
cd polymarket-hft-bot

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl enable docker
    systemctl start docker
    rm get-docker.sh
    echo "✅ Docker installed"
else
    echo "✅ Docker already installed"
fi

# Install Docker Compose if not present
if ! command -v docker-compose &> /dev/null; then
    echo "📦 Installing Docker Compose..."
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    echo "✅ Docker Compose installed"
else
    echo "✅ Docker Compose already installed"
fi

# Create project structure
echo "📁 Creating project structure..."

# Create package.json
cat > package.json << 'PACKAGEJSON'
{
  "name": "polymarket-hft-bot",
  "version": "1.0.0",
  "description": "High-frequency trading bot for Polymarket arbitrage opportunities",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts",
    "watch": "tsc -w",
    "lint": "eslint src --ext .ts",
    "test": "jest"
  },
  "keywords": [
    "polymarket",
    "hft",
    "trading",
    "arbitrage",
    "crypto"
  ],
  "author": "",
  "license": "MIT",
  "dependencies": {
    "@polymarket/clob-client": "^6.8.0",
    "ethers": "^6.9.0",
    "ws": "^8.14.2",
    "dotenv": "^16.3.1",
    "winston": "^3.11.0",
    "prom-client": "^15.1.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/ws": "^8.5.8",
    "@typescript-eslint/eslint-plugin": "^6.13.0",
    "@typescript-eslint/parser": "^6.13.0",
    "eslint": "^8.54.0",
    "ts-node": "^10.9.1",
    "typescript": "^5.3.2",
    "jest": "^29.7.0",
    "@types/jest": "^29.5.8"
  }
}
PACKAGEJSON

# Create tsconfig.json
cat > tsconfig.json << 'TSCONFIG'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
TSCONFIG

# Create .env
cat > .env << 'ENVFILE'
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
ENVFILE

# Create Dockerfile
cat > Dockerfile << 'DOCKERFILE'
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
RUN npm ci --only=production && npm ci --only=development
COPY src ./src
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache dumb-init
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force
COPY --from=builder /app/dist ./dist
RUN mkdir -p logs && chown -R nodejs:nodejs /app
USER nodejs
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
DOCKERFILE

# Create docker-compose.yml
cat > docker-compose.yml << 'COMPOSE'
version: '3.8'

services:
  polymarket-hft-bot:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: polymarket-hft-bot
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - ./logs:/app/logs
    environment:
      - NODE_ENV=production
    networks:
      - hft-network
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M

networks:
  hft-network:
    driver: bridge
COMPOSE

# Create .dockerignore
cat > .dockerignore << 'DOCKERIGNORE'
node_modules
npm-debug.log
dist
logs
*.log
.env.local
.git
.gitignore
README.md
DOCKERIGNORE

echo "✅ Configuration files created"

# Clone source code from GitHub (or we can create files directly)
echo ""
echo "📥 Please provide your GitHub repository URL to clone the source code:"
echo "    OR we can create the source files directly."
echo ""
echo "If you have a Git repo, run:"
echo "    git clone <your-repo-url> /opt/polymarket-hft-bot-temp"
echo "    cp -r /opt/polymarket-hft-bot-temp/src /opt/polymarket-hft-bot/"
echo ""
echo "Otherwise, I'll need to create the source files manually."
echo ""
echo "For now, continuing with build..."

# Create logs directory
mkdir -p logs

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Copy source code to /opt/polymarket-hft-bot/src/"
echo "2. Run: docker-compose build"
echo "3. Run: docker-compose up -d"
echo "4. Monitor: docker-compose logs -f"
