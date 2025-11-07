# Update Guide - Enhanced Matching & Bug Fixes

## Quick Deploy (For Your Root Environment)

```bash
# 1. Navigate to bot directory
cd /root/test_bot

# 2. Pull latest code
git pull origin claude/polymarket-trading-bot-011CUqjV9mQ5yuRRS2Msyvvb

# 3. Build (use full path if needed)
/opt/node22/bin/npm run build

# 4. Make scripts executable
chmod +x *.sh

# 5. Stop current bot
# Find process ID
ps aux | grep node | grep -v grep
# Kill it (replace 12345 with actual PID)
kill 12345

# 6. Restart with filtered logs
npm start 2>&1 | tee bot.log | ./filter-trades.sh
```

---

## What Changed

### 1. **Critical Bug Fix**
- ❌ **OLD**: Matched crypto (MegaETH airdrop) with sports (NFL players)
- ✅ **NEW**: Category filtering prevents crypto/sports mixing
- ✅ Raised threshold: 0.3 → 0.7 (70% minimum)

### 2. **Enhanced Matching** ("Devil in the details")
- **Numeric normalization**: $100k = $100,000 = 100K
- **Date normalization**: All formats → YYYY-MM-DD
- **Entity recognition**: Politicians, teams, crypto coins
- **Price targets**: Matches "Bitcoin $100k" with "BTC 100000"

### 3. **New Tools**
- `filter-trades.sh` - Live log filtering
- `check-trades.sh` - Quick summary
- `analyze-opportunities.sh` - Detailed analysis

---

## Verify the Fix

```bash
# After 24 hours running, check:
./analyze-opportunities.sh
```

### Good Signs ✅
- Similarity scores 0.7+
- Same categories (crypto-crypto)
- Realistic profits (1-10%)
- Match reasons include: "entity-match", "date-match", "price-target"

### Bad Signs 🚨
- Still mixing categories
- Profits >50%
- Unrelated topics matching

---

## Expected Results

**Before**: 51 fake opportunities (crypto vs sports, 9200% profit)
**After**: 0-10 real opportunities (same category, realistic profit)

**0 opportunities is OK!** Better than false positives.

---

## Troubleshooting

### npm not found
```bash
/opt/node22/bin/npm run build
```

### Scripts not executable
```bash
chmod +x *.sh
```

### Still seeing bad matches
1. Verify you pulled latest code
2. Check rebuild completed: `ls -la dist/`
3. Restart bot completely
4. **DO NOT TRADE** if still broken

---

## Before Trading

- [ ] Bot running 24-48 hours
- [ ] All opportunities manually reviewed
- [ ] Categories match
- [ ] Profits realistic (1-10%)
- [ ] Have funds on both platforms

See `TRADING-GUIDE.md` for full checklist.
