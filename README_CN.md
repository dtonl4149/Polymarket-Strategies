# Polymarket 交易机器人（TypeScript）

[English](README.md) | 简体中文

这是 Polymarket 交易机器人的 **TypeScript / Node.js** 版本，与 Python 版 [`polymarket-trading-bot`](../polymarket-trading-bot) **目录结构和能力对齐**（无 Gas、WebSocket、15 分钟市场、闪崩策略思路等）。

## 特性

- **简单易用**：少量代码即可开始
- **无 Gas（可选）**：Builder Program 环境变量与 Python 一致
- **实时 WebSocket**：订单簿推送（`ws`）
- **15 分钟市场**：通过 Gamma API 发现 BTC/ETH/SOL/XRP 涨跌盘
- **闪崩策略**：见 `strategies/flash_crash.ts`（`FlashCrashStrategy`）
- **终端界面**：闪崩策略内置类似 Python 的盘面展示
- **安全存储**：PBKDF2 + Fernet 风格加密
- **测试**：`tests/` 下使用 Vitest

## 环境要求

- **Node.js 18+**（内置 `fetch`）

## 快速开始（约 5 分钟）

### 1. 安装

```bash
cd polymarket-trading-bot-ts
npm install
```

### 2. 配置

```bash
cp .env.example .env
```

至少填写：

```bash
POLY_PRIVATE_KEY=你的MetaMask私钥
POLY_SAFE_ADDRESS=0x你的Polymarket钱包地址
```

> **Safe 地址：** [polymarket.com/settings](https://polymarket.com/settings) 复制钱包地址。

### 3. 运行

```bash
# 快速入门（挂单、成交示例）
npm run example:quickstart

# 交互式命令行（类似 Python run_bot.py --interactive）
npm start -- --interactive

# 首次向导：生成 config.yaml 与加密私钥（类似 Python scripts/setup.py）
npm run setup
```

## 策略（TypeScript）

闪崩策略实现在 `strategies/flash_crash.ts`。可在自建入口或扩展示例中运行，例如：

```typescript
import "dotenv/config";
import { Config } from "./src/config.js";
import { TradingBot } from "./src/bot.js";
import { FlashCrashStrategy, FlashCrashConfig } from "./strategies/index.js";

const config = Config.fromEnv();
const bot = new TradingBot({ config, privateKey: process.env.POLY_PRIVATE_KEY! });
const strategy = new FlashCrashStrategy(bot, new FlashCrashConfig());
await strategy.run(); // Ctrl+C 结束
```

> Python 仓库里单独的 `flash_crash_strategy.py`、`orderbook_tui.py` 命令行 **本仓库未逐文件复刻**；核心逻辑已通过上述类提供，如需完全一致可加薄封装脚本（如 `scripts/run_flash_crash.ts`）。

策略教程仍可参考 `docs/strategy_guide_CN.md`（文档树与 Python 版一致）。

## 代码示例

### 从环境变量创建机器人

```typescript
import "dotenv/config";
import { createBotFromEnv } from "./src/utils.js";

const bot = createBotFromEnv();
const orders = await bot.getOpenOrders();
console.log(`挂单数量: ${orders.length}`);
```

### 下单

```typescript
import { TradingBot, Config } from "./src/index.js";

const config = new Config();
config.safe_address = "0x你的Safe";

const bot = new TradingBot({ config, privateKey: "0x你的私钥" });

const result = await bot.placeOrder("代币ID", 0.65, 10, "BUY");
console.log(result.success, result.order_id, result.message);
```

### WebSocket 订单簿

```typescript
import { MarketWebSocket } from "./src/websocket_client.js";

const ws = new MarketWebSocket();
ws.on_book((snapshot) => {
  console.log("中间价", snapshot.mid_price);
});
await ws.subscribe(["token_id_1", "token_id_2"]);
await ws.run(true);
```

### Gamma：当前 15 分钟市场

```typescript
import { GammaClient } from "./src/gamma_client.js";

const gamma = new GammaClient();
const market = await gamma.getMarketInfo("BTC");
if (market) {
  console.log(market["question"]);
  console.log(market["token_ids"]);
}
```

## 项目结构

```
polymarket-trading-bot-ts/
├── src/                    # 核心库
├── lib/                    # 行情 / 仓位 / 控制台
├── strategies/             # base.ts, flash_crash.ts
├── examples/
├── scripts/                # run_bot, setup, full_test
├── tests/                  # Vitest
├── docs/                   # 与 Python 版一致的参考文档
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## 配置

### 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `POLY_PRIVATE_KEY` | 通常需要 | 钱包私钥 |
| `POLY_SAFE_ADDRESS` | 通常需要 | Polymarket Safe 地址 |
| `POLY_BUILDER_API_*` | 无 Gas 时需要 | Builder 凭证 |

也可使用 `npm run setup` 生成加密私钥 + `config.yaml`，用 `scripts/run_bot.ts` 的「加密密钥模式」运行。

### `config.yaml`

字段形状与 Python 版相同，可参考上级目录 `polymarket-trading-bot/config.example.yaml`。

```typescript
const bot = new TradingBot({
  configPath: "config.yaml",
  privateKey: process.env.POLY_PRIVATE_KEY!,
});
```

## 无 Gas 交易

与 Python 一致：配置 Builder 环境变量或 YAML 中的 `builder:`，启用 `use_gasless` 与 Relayer 客户端。

## Python 与 TypeScript 的差异

| Python | TypeScript |
|--------|------------|
| `snake_case` | `camelCase`（如 `placeOrder`、`getOpenOrders`） |
| 同步签名 + asyncio | 异步签名与 HTTP（`fetch`） |
| `is_initialized()` | `isInitialized()` |

## 安全说明

- 私钥加密：PBKDF2（48 万次迭代）+ Fernet 风格令牌
- 勿将 `.env`、`credentials/` 提交到 git
- 建议使用独立交易钱包

## 测试

```bash
npm test
```

需要真实环境的集成检查：

```bash
npm run full-test
```

## 常见问题

| 现象 | 建议 |
|------|------|
| 未设置密钥 | 填写 `.env` 或运行 `npm run setup` |
| Safe 错误 | 从 polymarket.com/settings 复制 |
| 私钥无效 | 64 位十六进制（可有/可无 `0x`） |
| 下单失败 | 余额、授权、token id |
| WebSocket 连不上 | 网络、防火墙、代理 |

## 许可证

MIT License（若与主仓库共用一份 `LICENSE`，以上级仓库为准。）
