#!/bin/bash
# Analyze detected arbitrage opportunities in detail

LOG_FILE="logs/combined.log"

if [ ! -f "$LOG_FILE" ]; then
    echo "❌ Log file not found: $LOG_FILE"
    echo "Looking for log files..."
    find . -name "*.log" -type f 2>/dev/null
    exit 1
fi

echo "=== CROSS-MARKET ARBITRAGE ANALYSIS ==="
echo ""

# Total opportunities
TOTAL=$(grep -c "CROSS-MARKET ARBITRAGE DETECTED" "$LOG_FILE")
echo "📊 Total opportunities detected: $TOTAL"
echo ""

# Count by direction
BUY_KALSHI=$(grep "CROSS-MARKET ARBITRAGE DETECTED" "$LOG_FILE" | grep -c "buy-kalshi-sell-poly" || echo "0")
BUY_POLY=$(grep "CROSS-MARKET ARBITRAGE DETECTED" "$LOG_FILE" | grep -c "buy-poly-sell-kalshi" || echo "0")

echo "📈 Direction breakdown:"
echo "   Buy Kalshi → Sell Polymarket: $BUY_KALSHI"
echo "   Buy Polymarket → Sell Kalshi: $BUY_POLY"
echo ""

# Extract profit information
echo "💰 Profit analysis:"
echo ""
echo "=== Top 10 Most Profitable Opportunities ==="
grep "CROSS-MARKET ARBITRAGE DETECTED" "$LOG_FILE" | \
    grep -oP 'expectedProfit":\K[^,}]+' | \
    sed 's/"//g' | \
    sort -rn | \
    head -10 | \
    nl | \
    awk '{printf "   %2d. $%s\n", $1, $2}'

echo ""
echo "=== Recent Opportunities (Last 5) ==="
grep "CROSS-MARKET ARBITRAGE DETECTED" "$LOG_FILE" | tail -5 | while IFS= read -r line; do
    # Extract key fields
    POLYMARKET=$(echo "$line" | grep -oP 'polymarket":"[^"]+' | cut -d'"' -f3 | head -c 50)
    KALSHI=$(echo "$line" | grep -oP 'kalshi":"[^"]+' | cut -d'"' -f3 | head -c 50)
    DIRECTION=$(echo "$line" | grep -oP 'direction":"[^"]+' | cut -d'"' -f3)
    PROFIT=$(echo "$line" | grep -oP 'expectedProfit":"[^"]+' | cut -d'"' -f3)
    PERCENT=$(echo "$line" | grep -oP 'profitPercentage":"[^"]+' | cut -d'"' -f3)

    echo ""
    echo "   Polymarket: $POLYMARKET"
    echo "   Kalshi:     $KALSHI"
    echo "   Direction:  $DIRECTION"
    echo "   Profit:     $PROFIT ($PERCENT%)"
done

echo ""
echo "=== Market Matching Summary ==="
MATCHES=$(grep "Found .* market matches" "$LOG_FILE" | tail -1)
if [ -n "$MATCHES" ]; then
    echo "$MATCHES"
fi
