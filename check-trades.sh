#!/bin/bash
# Quick summary of bot activity - shows trades, opportunities, and return analysis

echo "=== TRADE & RETURN ANALYSIS ==="
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

# Count by match quality
HIGH_QUALITY=$(grep "CROSS-MARKET ARBITRAGE DETECTED" "$LOG_FILE" | grep -c "HIGH" 2>/dev/null || echo "0")
MEDIUM_QUALITY=$(grep "CROSS-MARKET ARBITRAGE DETECTED" "$LOG_FILE" | grep -c "MEDIUM" 2>/dev/null || echo "0")
LOW_QUALITY=$(grep "CROSS-MARKET ARBITRAGE DETECTED" "$LOG_FILE" | grep -c "LOW" 2>/dev/null || echo "0")
echo "   ✅ High quality matches: $HIGH_QUALITY"
echo "   ⚠️  Medium quality matches: $MEDIUM_QUALITY"
echo "   ❌ Low quality matches: $LOW_QUALITY"

# Count same-platform opportunities
SAME_PLATFORM_COUNT=$(grep -c "Would execute opportunity" "$LOG_FILE" 2>/dev/null || echo "0")
echo "💰 Same-platform arbitrage opportunities: $SAME_PLATFORM_COUNT"

# Count actual executions (if trading enabled)
EXECUTIONS=$(grep -c "execution-success" "$LOG_FILE" 2>/dev/null || echo "0")
echo "✅ Successful trade executions: $EXECUTIONS"

FAILURES=$(grep -c "execution-failure" "$LOG_FILE" 2>/dev/null || echo "0")
echo "❌ Failed trade executions: $FAILURES"

echo ""
echo "=== RETURN ANALYSIS ==="

# Extract expected returns from opportunities
if [ -f logs/opportunities.jsonl ]; then
    echo "📈 Analyzing tracked opportunities from: logs/opportunities.jsonl"

    # Count by match quality
    HIGH_COUNT=$(grep -o '"matchQuality":"HIGH"' logs/opportunities.jsonl | wc -l)
    MEDIUM_COUNT=$(grep -o '"matchQuality":"MEDIUM"' logs/opportunities.jsonl | wc -l)
    LOW_COUNT=$(grep -o '"matchQuality":"LOW"' logs/opportunities.jsonl | wc -l)
    echo "   ✅ HIGH quality: $HIGH_COUNT"
    echo "   ⚠️  MEDIUM quality: $MEDIUM_COUNT"
    echo "   ❌ LOW quality: $LOW_COUNT (⚠️  THESE ARE LIKELY FALSE POSITIVES)"

    # Calculate average expected return
    AVG_RETURN=$(grep -o '"expectedGrossReturn":[0-9.]*' logs/opportunities.jsonl | cut -d: -f2 | awk '{sum+=$1; count++} END {if(count>0) printf "%.2f%%", (sum/count)*100; else print "N/A"}')
    echo "   Average expected gross return: $AVG_RETURN"

    # Show return distribution
    echo ""
    echo "📊 Return Distribution:"
    echo "   > 10%: $(grep -o '"expectedGrossReturn":[0-9.]*' logs/opportunities.jsonl | cut -d: -f2 | awk '$1 > 0.10 {count++} END {print count+0}')"
    echo "   5-10%: $(grep -o '"expectedGrossReturn":[0-9.]*' logs/opportunities.jsonl | cut -d: -f2 | awk '$1 >= 0.05 && $1 <= 0.10 {count++} END {print count+0}')"
    echo "   3-5%: $(grep -o '"expectedGrossReturn":[0-9.]*' logs/opportunities.jsonl | cut -d: -f2 | awk '$1 >= 0.03 && $1 < 0.05 {count++} END {print count+0}')"
    echo "   < 3%: $(grep -o '"expectedGrossReturn":[0-9.]*' logs/opportunities.jsonl | cut -d: -f2 | awk '$1 < 0.03 {count++} END {print count+0}')"
else
    echo "⚠️  No opportunity tracking file found (logs/opportunities.jsonl)"
    echo "   Run the bot with the updated code to track opportunities"
fi

echo ""
echo "=== LATEST OPPORTUNITIES (Last 5) ==="
grep "CROSS-MARKET ARBITRAGE DETECTED" "$LOG_FILE" | tail -5 | while IFS= read -r line; do
    echo "$line"
done

echo ""
echo "=== PAPER TRADING PORTFOLIO ==="
if [ -f logs/paper-portfolio.jsonl ]; then
    # Get the latest portfolio snapshot
    LATEST_PORTFOLIO=$(tail -1 logs/paper-portfolio.jsonl)

    INITIAL_CAPITAL=$(echo "$LATEST_PORTFOLIO" | grep -o '"initialCapital":[0-9.]*' | cut -d: -f2)
    CURRENT_CAPITAL=$(echo "$LATEST_PORTFOLIO" | grep -o '"currentCapital":[0-9.]*' | cut -d: -f2)
    TOTAL_PNL=$(echo "$LATEST_PORTFOLIO" | grep -o '"totalPnL":-\?[0-9.]*' | cut -d: -f2)
    TOTAL_RETURN=$(echo "$LATEST_PORTFOLIO" | grep -o '"totalReturn":-\?[0-9.]*' | cut -d: -f2)
    OPEN_POSITIONS=$(echo "$LATEST_PORTFOLIO" | grep -o '"openPositions":[0-9]*' | cut -d: -f2)
    CLOSED_POSITIONS=$(echo "$LATEST_PORTFOLIO" | grep -o '"closedPositions":[0-9]*' | cut -d: -f2)
    WIN_RATE=$(echo "$LATEST_PORTFOLIO" | grep -o '"winRate":[0-9.]*' | cut -d: -f2)

    # Calculate return percentage
    RETURN_PCT=$(echo "$TOTAL_RETURN" | awk '{printf "%.2f%%", $1*100}')

    echo "💰 Portfolio Summary:"
    echo "   Initial Capital: \$$INITIAL_CAPITAL"
    echo "   Current Capital: \$$CURRENT_CAPITAL"
    echo "   Total P&L: \$$TOTAL_PNL ($RETURN_PCT)"
    echo "   Open Positions: $OPEN_POSITIONS"
    echo "   Closed Positions: $CLOSED_POSITIONS"

    if [ "$CLOSED_POSITIONS" != "0" ] && [ -n "$CLOSED_POSITIONS" ]; then
        WIN_RATE_PCT=$(echo "$WIN_RATE" | awk '{printf "%.2f%%", $1*100}')
        echo "   Win Rate: $WIN_RATE_PCT"
    fi
else
    echo "⚠️  No paper trading data found (logs/paper-portfolio.jsonl)"
    echo "   Paper trading will start tracking trades on HIGH quality matches"
fi

echo ""
echo "=== PAPER TRADES HISTORY ==="
if [ -f logs/paper-trades.jsonl ]; then
    OPEN_TRADES=$(grep -c '"action":"OPEN"' logs/paper-trades.jsonl 2>/dev/null || echo "0")
    CLOSED_TRADES=$(grep -c '"action":"CLOSE"' logs/paper-trades.jsonl 2>/dev/null || echo "0")

    echo "📊 Trade Activity:"
    echo "   Trades Opened: $OPEN_TRADES"
    echo "   Trades Closed: $CLOSED_TRADES"

    if [ "$CLOSED_TRADES" != "0" ] && [ -n "$CLOSED_TRADES" ]; then
        echo ""
        echo "📝 Latest Closed Trades (Last 5):"
        grep '"action":"CLOSE"' logs/paper-trades.jsonl | tail -5 | while IFS= read -r line; do
            # Extract key fields
            REALIZED_PNL=$(echo "$line" | grep -o '"realizedPnL":-\?[0-9.]*' | cut -d: -f2)
            RETURN_PCT=$(echo "$line" | grep -o '"returnPercentage":-\?[0-9.]*' | cut -d: -f2)
            CLOSE_REASON=$(echo "$line" | grep -o '"closeReason":"[^"]*"' | cut -d'"' -f4)
            TIMESTAMP=$(echo "$line" | grep -o '"timestamp":"[^"]*"' | tail -1 | cut -d'"' -f4)

            # Format return percentage
            RETURN_FORMATTED=$(echo "$RETURN_PCT" | awk '{printf "%.2f%%", $1*100}')

            echo "   [$TIMESTAMP] P&L: \$$REALIZED_PNL ($RETURN_FORMATTED) - $CLOSE_REASON"
        done
    fi
else
    echo "⚠️  No paper trades log found (logs/paper-trades.jsonl)"
    echo "   Paper trades will be logged when HIGH quality opportunities are found"
fi

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

echo ""
echo "=== IMPORTANT NOTES ==="
echo "⚠️  Returns shown are GROSS (before fees, gas, slippage)"
echo "⚠️  LOW quality matches are likely FALSE POSITIVES - verify manually!"
echo "✅ Only HIGH quality matches (similarity >= 0.85) are paper traded"
echo "💡 Paper trading uses \$10k virtual capital with Kelly Criterion sizing"
echo "📊 Position size = 0.5 * spread * similarity² * capital (min \$50, max 10%)"
