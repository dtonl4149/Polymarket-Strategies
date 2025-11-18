#!/usr/bin/env npx tsx
/**
 * Basic Trading Examples
 */

import "dotenv/config";

import { TradingBot } from "../src/bot.js";
import { Config } from "../src/config.js";

async function main(): Promise<void> {
  console.log("=".repeat(50));
  console.log("Basic Trading Examples");
  console.log("=".repeat(50));

  const privateKey = process.env.POLY_PRIVATE_KEY;
  if (!privateKey) {
    console.log("\nError: POLY_PRIVATE_KEY not set in .env file");
    process.exit(1);
  }

  const config = Config.fromEnv();
  const bot = new TradingBot({ config, privateKey });

  console.log(`\nBot initialized with Safe: ${bot.config.safe_address}`);
  console.log(`Gasless mode: ${bot.config.use_gasless}`);

  console.log("\n--- Example 1: Get Open Orders ---");
  const orders = await bot.getOpenOrders();
  console.log(`You have ${orders.length} open orders`);

  console.log("\n--- Example 2: Get Recent Trades ---");
  const trades = await bot.getTrades(undefined, 5);
  console.log(`Recent trades: ${trades.length}`);

  if (bot.config.default_token_id) {
    console.log("\n--- Example 3: Get Market Price ---");
    const price = await bot.getMarketPrice(bot.config.default_token_id);
    console.log(`Current price: ${JSON.stringify(price)}`);

    console.log("\n--- Example 4: Get Order Book ---");
    const orderbook = await bot.getOrderBook(bot.config.default_token_id);
    const bids = orderbook["bids"];
    const asks = orderbook["asks"];
    console.log(`Order book bids: ${Array.isArray(bids) ? bids.length : 0}`);
    console.log(`Order book asks: ${Array.isArray(asks) ? asks.length : 0}`);
  } else {
    console.log("\n--- Example 3: (skipped) -- no default_token_id in config ---");
  }

  console.log("\n" + "=".repeat(50));
  console.log("Examples complete!");
  console.log("=".repeat(50));
}

main().catch((e) => {
  console.error(`\nError: ${e}`);
  process.exit(1);
});
