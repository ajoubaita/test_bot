#!/bin/bash
# Filter bot logs to show only trade actions and important events

# Use this to filter live output:
# npm start | ./filter-trades.sh

# Or filter existing output:
# ./filter-trades.sh < your-log-file.txt

grep -E "(🎯 CROSS-MARKET ARBITRAGE DETECTED|execution-success|execution-failure|Would execute opportunity|TRADING DISABLED|Arbitrage opportunities detected|Bot started|Bot stopped|Market pairs:|Found .* market matches)" --color=always
