#!/bin/bash
# Quick summary of bot activity - shows only trades and opportunities

echo "=== TRADE SUMMARY ==="
echo ""

# Check if log file exists
if [ -f logs/combined.log ]; then
    LOG_FILE="logs/combined.log"
elif [ -f bot.log ]; then
    LOG_FILE="bot.log"
else
    echo "❌ No log file found. Bot may be outputting to console only."
    echo ""
    echo "To check console output, pipe it through this script:"
    echo "  your-bot-command 2>&1 | tee bot.log"
    echo "  then run: ./check-trades.sh"
    exit 1
fi

echo "📊 Analyzing logs from: $LOG_FILE"
echo ""

# Count cross-market opportunities
CROSS_MARKET_COUNT=$(grep -c "CROSS-MARKET ARBITRAGE DETECTED" "$LOG_FILE" 2>/dev/null || echo "0")
echo "🎯 Cross-market arbitrage opportunities: $CROSS_MARKET_COUNT"

# Count same-platform opportunities
SAME_PLATFORM_COUNT=$(grep -c "Would execute opportunity" "$LOG_FILE" 2>/dev/null || echo "0")
echo "💰 Same-platform arbitrage opportunities: $SAME_PLATFORM_COUNT"

# Count actual executions (if trading enabled)
EXECUTIONS=$(grep -c "execution-success" "$LOG_FILE" 2>/dev/null || echo "0")
echo "✅ Successful trade executions: $EXECUTIONS"

FAILURES=$(grep -c "execution-failure" "$LOG_FILE" 2>/dev/null || echo "0")
echo "❌ Failed trade executions: $FAILURES"

echo ""
echo "=== LATEST OPPORTUNITIES (Last 5) ==="
grep -E "(CROSS-MARKET ARBITRAGE DETECTED|Would execute opportunity)" "$LOG_FILE" | tail -5 | while IFS= read -r line; do
    echo "$line"
done

echo ""
echo "=== BOT STATUS ==="
if grep -q "Bot started" "$LOG_FILE"; then
    echo "✅ Bot has been started"
    LAST_START=$(grep "Bot started" "$LOG_FILE" | tail -1)
    echo "   Last start: $LAST_START"
fi

if grep -q "Bot stopped" "$LOG_FILE"; then
    echo "⚠️  Bot has been stopped"
fi
