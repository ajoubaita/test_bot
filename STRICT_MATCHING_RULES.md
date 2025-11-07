## Enhanced Entity Extraction

The bot now extracts and validates these entity types:

### 1. Capitalized Proper Nouns
- Automatically extracts capitalized words (likely names, places, teams)
- Example: "Biden", "Nelson", "Telstar", "Gala" → `name:biden`, `name:nelson`, etc.

### 2. Politicians (Expanded)
- Trump, Biden, Harris, DeSantis, Newsom, Obama, Clinton, Pence
- Warren, Sanders, Cruz, Rubio, McConnell, Pelosi, Schumer
- Haley, Ramaswamy, Christie, Scott, Vivek

### 3. Cryptocurrencies (Expanded)
- Bitcoin/BTC, Ethereum/ETH, Solana/SOL, Cardano/ADA
- Polygon/MATIC, Avalanche/AVAX

### 4. Sports Teams (Expanded)
- **NFL** (29 teams): Chiefs, Broncos, Patriots, 49ers, Cowboys, etc.
- **NBA** (13 teams): Lakers, Celtics, Warriors, Heat, Knicks, etc.
- **Soccer** (16 teams): Barcelona, Real Madrid, Manchester, Liverpool, Bayern, etc.

### 5. Companies (Expanded)
- Tech: Apple, Google, Amazon, Tesla, Microsoft, Meta, Nvidia
- Other: Netflix, Disney, Walmart, JPMorgan, Visa, Mastercard

### 6. Events
- Super Bowl, World Series, World Cup, NBA Finals, Olympics
- Election, Airdrop, Halving

## Validation Examples

### ✅ PASS: Bitcoin Price Target
**Market 1:** "Will Bitcoin reach $100,000 by December 31, 2025?"
**Market 2:** "BTC price above $100k on 12/31/2025?"

- ✅ Category: Both crypto
- ✅ Entity: Both mention Bitcoin/BTC
- ✅ Date: 2025-12-31 matches exactly
- ✅ Price: $100k matches exactly
- **Result:** HIGH confidence match (0.85+)

### ✅ PASS: Political Event
**Market 1:** "Will Trump win the 2024 Republican primary?"
**Market 2:** "Trump to secure GOP nomination in 2024?"

- ✅ Category: Both politics
- ✅ Entity: Both mention Trump
- ✅ Date: Both mention 2024
- **Result:** HIGH confidence match (0.85+)

### ❌ FAIL: Different Names (REJECTED)
**Market 1:** "Will Biden speak at Nelson Gala on November 7?"
**Market 2:** "Will Telstar 1963 win on 2025-11-07?"

- ❌ Entity: Biden/Nelson ≠ Telstar/1963 (0% match)
- **Result:** REJECTED at mandatory entity check

### ❌ FAIL: Different Dates (REJECTED)
**Market 1:** "Lakers vs Celtics game on January 15, 2025"
**Market 2:** "Lakers vs Celtics game on January 20, 2025"

- ✅ Category: Both NBA
- ✅ Entity: Both mention Lakers, Celtics
- ❌ Date: 2025-01-15 ≠ 2025-01-20
- **Result:** REJECTED at mandatory date check

### ❌ FAIL: Different Price Targets (REJECTED)
**Market 1:** "Will Bitcoin reach $100,000 by year end?"
**Market 2:** "Will Bitcoin reach $50,000 by year end?"

- ✅ Category: Both crypto
- ✅ Entity: Both mention Bitcoin
- ❌ Price: $100k ≠ $50k
- **Result:** REJECTED at mandatory price check
