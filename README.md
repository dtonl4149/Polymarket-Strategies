# Polymarket Trading Bot (TypeScript)

English | [简体中文](README_CN.md)

A beginner-friendly **TypeScript / Node.js** port of the Polymarket trading bot: gasless-capable execution, real-time WebSocket data, 15-minute market helpers, and a Flash Crash strategy—aligned with the Python [`polymarket-trading-bot`](../polymarket-trading-bot) layout and features.

## Features

- **Simple API**: Few lines to start trading
- **Gasless transactions**: Builder Program credentials (same env vars as Python)
- **Real-time WebSocket**: Live orderbook updates (`ws`)
- **15-minute markets**: BTC / ETH / SOL / XRP Up/Down discovery via Gamma API
- **Flash Crash strategy**: Same idea as the Python strategy (extend `FlashCrashStrategy`)
- **Terminal UI**: Strategy status + orderbook-style display in the Flash Crash TUI
- **Secure key storage**: PBKDF2 + Fernet-compatible encryption
- **Tests**: [Vitest](https://vitest.dev/) suite under `tests/`

## Requirements

- **Node.js 18+** (global `fetch`)

## Quick start (about 5 minutes)

### 1. Install

```bash
cd polymarket-trading-bot-ts
npm install
```

### 2. Configure

```bash
# Copy the example env and edit
cp .env.example .env
```

Set at least:

```bash
POLY_PRIVATE_KEY=your_metamask_private_key
POLY_SAFE_ADDRESS=0xYourPolymarketSafeAddress
```

> **Safe address:** [polymarket.com/settings](https://polymarket.com/settings) → copy your wallet address.

### 3. Run

```bash
# Quickstart (open orders + trades demo)
npm run example:quickstart

# Interactive CLI (like Python run_bot.py --interactive)
npm start -- --interactive

# One-off setup → config.yaml + encrypted key (like Python scripts/setup.py)
npm run setup
```

## Strategies (TypeScript)

The Flash Crash implementation lives in `strategies/flash_crash.ts` as `FlashCrashStrategy`. Run it from your own entry file (or extend `examples/strategy_example.ts`):

```typescript
import "dotenv/config";
import { Config } from "./src/config.js";
import { TradingBot } from "./src/bot.js";
import { FlashCrashStrategy, FlashCrashConfig } from "./strategies/index.js";

const config = Config.fromEnv();
const bot = new TradingBot({ config, privateKey: process.env.POLY_PRIVATE_KEY! });
const strategy = new FlashCrashStrategy(bot, new FlashCrashConfig());
await strategy.run(); // Ctrl+C to stop
```

> The Python repo ships extra CLIs (`flash_crash_strategy.py`, `orderbook_tui.py`) that are not duplicated here; the same logic is available as the classes above—add a thin `scripts/run_flash_crash.ts` if you want matching CLIs.

Strategy authoring: see `docs/strategy_guide.md` (same docs tree as Python).

## Code examples

### Minimal: bot from environment

```typescript
import "dotenv/config";
import { createBotFromEnv } from "./src/utils.js";

const bot = createBotFromEnv();
const orders = await bot.getOpenOrders();
console.log(`Open orders: ${orders.length}`);
```

### Place an order

```typescript
import { TradingBot, Config } from "./src/index.js";

const config = new Config();
config.safe_address = "0xYourSafe";

const bot = new TradingBot({ config, privateKey: "0xYourPrivateKey" });

const result = await bot.placeOrder("token_id_here", 0.65, 10, "BUY");
console.log(result.success, result.order_id, result.message);
```

### WebSocket orderbook

```typescript
import { MarketWebSocket } from "./src/websocket_client.js";

const ws = new MarketWebSocket();
ws.on_book((snapshot) => {
  console.log("mid", snapshot.mid_price);
});
await ws.subscribe(["token_id_1", "token_id_2"]);
await ws.run(true);
```

### Gamma: current 15m market

```typescript
import { GammaClient } from "./src/gamma_client.js";

const gamma = new GammaClient();
const market = await gamma.getMarketInfo("BTC");
if (market) {
  console.log(market["question"]);
  console.log(market["token_ids"]);
}
```

## Project structure

```
polymarket-trading-bot-ts/
├── src/                    # Core library (.ts)
│   ├── bot.ts              # TradingBot
│   ├── config.ts
│   ├── client.ts           # CLOB + Relayer
│   ├── signer.ts           # EIP-712 (ethers)
│   ├── crypto.ts
│   ├── utils.ts
│   ├── gamma_client.ts
│   ├── websocket_client.ts
│   └── index.ts            # Re-exports
├── lib/                    # Market / positions / console helpers
├── strategies/             # base.ts, flash_crash.ts
├── examples/               # quickstart, basic_trading, strategy_example
├── scripts/                # run_bot, setup, full_test
├── tests/                  # Vitest
├── docs/                   # Shared reference docs (mirrors Python tree)
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Configuration

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `POLY_PRIVATE_KEY` | Yes* | Wallet private key |
| `POLY_SAFE_ADDRESS` | Yes* | Polymarket Safe address |
| `POLY_BUILDER_API_KEY` | For gasless | Builder API key |
| `POLY_BUILDER_API_SECRET` | For gasless | Builder secret |
| `POLY_BUILDER_API_PASSPHRASE` | For gasless | Builder passphrase |

\*Or use encrypted key + `config.yaml` via `npm run setup` / `scripts/run_bot.ts` without `.env` keys.

### `config.yaml`

You can use the same shape as the Python project (see `../polymarket-trading-bot/config.example.yaml`). Load with:

```typescript
const bot = new TradingBot({
  configPath: "config.yaml",
  privateKey: process.env.POLY_PRIVATE_KEY!,
});
```

## Gasless trading

Same as Python: add Builder env vars or `builder:` block in YAML. When configured, `use_gasless` is set and the relayer client is available.

## API notes (Python vs TypeScript)

| Python | TypeScript |
|--------|------------|
| `snake_case` methods | `camelCase` (`placeOrder`, `getOpenOrders`, …) |
| `asyncio` + sync signer | `async` signing and HTTP (`fetch`) |
| `is_initialized()` | `isInitialized()` |

## Security

- PBKDF2 (480k iterations) + Fernet-style tokens for encrypted key files
- Do not commit `.env` or `credentials/`
- Prefer a dedicated trading wallet

## Testing

```bash
npm test
```

Integration-style checks (needs real env):

```bash
npm run full-test
```

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| Missing keys | Set `POLY_PRIVATE_KEY` + `POLY_SAFE_ADDRESS` in `.env` |
| Wrong Safe | Copy from polymarket.com/settings |
| Invalid key | 64 hex chars (with or without `0x`) |
| Order errors | Balance, approvals, token id |
| WebSocket | Firewall / VPN |

## License

MIT License (match your parent repo if you keep a single `LICENSE`).
