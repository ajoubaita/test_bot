# DEPLOYMENT INSTRUCTIONS
# Follow these steps exactly - they tell you WHERE to run each command

#==============================================================================
# PART 1: ON YOUR LOCAL COMPUTER (Mac/Windows/Linux)
#==============================================================================

# Step 1: Open your terminal/command prompt on YOUR computer
# Step 2: SSH into your DigitalOcean droplet
ssh root@159.203.96.246

# ↑ Run the above command on YOUR LOCAL COMPUTER
# ↓ Everything below runs ON THE DROPLET after you SSH in

#==============================================================================
# PART 2: ON THE DIGITALOCEAN DROPLET (after SSH connection)
#==============================================================================

# Step 3: Install Docker (run this ON THE DROPLET)
curl -fsSL https://get.docker.com -o get-docker.sh

# Step 4: Execute Docker install script (ON THE DROPLET)
sh get-docker.sh

# Step 5: Clean up install script (ON THE DROPLET)
rm get-docker.sh

# Step 6: Enable Docker to start on boot (ON THE DROPLET)
systemctl enable docker

# Step 7: Start Docker service (ON THE DROPLET)
systemctl start docker

# Step 8: Install Docker Compose (ON THE DROPLET)
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose

# Step 9: Make Docker Compose executable (ON THE DROPLET)
chmod +x /usr/local/bin/docker-compose

# Step 10: Verify Docker is installed (ON THE DROPLET)
docker --version

# Step 11: Verify Docker Compose is installed (ON THE DROPLET)
docker-compose --version

# Step 12: Navigate to /opt directory (ON THE DROPLET)
cd /opt

# Step 13: Clone your GitHub repository (ON THE DROPLET)
git clone -b claude/polymarket-trading-bot-011CUqjV9mQ5yuRRS2Msyvvb https://github.com/ajoubaita/test_bot.git polymarket-hft-bot

# Step 14: Enter the project directory (ON THE DROPLET)
cd polymarket-hft-bot

# Step 15: Verify files are present (ON THE DROPLET)
ls -la

# Step 16: Check if .env file exists (ON THE DROPLET)
cat .env

# Step 17: Build the Docker image (ON THE DROPLET) - This takes 2-3 minutes
docker-compose build

# Step 18: Start the bot in background (ON THE DROPLET)
docker-compose up -d

# Step 19: Wait for bot to start (ON THE DROPLET)
sleep 10

# Step 20: Check if container is running (ON THE DROPLET)
docker-compose ps

# Step 21: View the logs (ON THE DROPLET)
docker-compose logs -f

# ↑ Press Ctrl+C to stop viewing logs (bot keeps running)

#==============================================================================
# MONITORING COMMANDS (run these ON THE DROPLET anytime)
#==============================================================================

# Check bot health
curl http://localhost:3000/health

# Get detailed status
curl http://localhost:3000/status

# View logs in real-time
docker-compose logs -f

# View last 100 lines of logs
docker-compose logs --tail=100

# Check container status
docker-compose ps

# Restart the bot
docker-compose restart

# Stop the bot
docker-compose stop

# Start the bot (if stopped)
docker-compose start

# Stop and remove everything
docker-compose down

#==============================================================================
# TROUBLESHOOTING (run these ON THE DROPLET if needed)
#==============================================================================

# If build fails, rebuild from scratch
docker-compose down
docker-compose build --no-cache
docker-compose up -d

# If container won't start, check logs
docker-compose logs

# If you need to update code
cd /opt/polymarket-hft-bot
git pull origin claude/polymarket-trading-bot-011CUqjV9mQ5yuRRS2Msyvvb
docker-compose down
docker-compose up -d --build
