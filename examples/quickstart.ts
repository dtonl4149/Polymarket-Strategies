#!/usr/bin/env npx tsx
/**
 * Quickstart Example
 */

import "dotenv/config";

import { TradingBot } from "../src/bot.js";
import { Config } from "../src/config.js";

function checkEnvironment(): [string, string] | [null, null] {
  const privateKey = process.env.POLY_PRIVATE_KEY;
  const safeAddress = process.env.POLY_SAFE_ADDRESS;
  if (!privateKey) {
    console.log("ERROR: POLY_PRIVATE_KEY environment variable not set!");
    return [null, null];
  }
  if (!safeAddress) {
    console.log("ERROR: POLY_SAFE_ADDRESS environment variable not set!");
    return [null, null];
  }
  return [privateKey, safeAddress];
}

async function main(): Promise<void> {
  console.log("=".repeat(50));
  console.log("Polymarket Trading Bot - Quickstart");
  console.log("=".repeat(50));
  console.log();

  console.log("[Step 1] Checking environment variables...");
  const pair = checkEnvironment();
  if (!pair[0]) process.exit(1);
  const [, safeAddress] = pair;
  console.log(`  Safe address: ${safeAddress}`);
  console.log();

  console.log("[Step 2] Creating configuration...");
  const config = Config.fromEnv();
  console.log(`  Gasless mode: ${config.use_gasless}`);
  console.log();

  console.log("[Step 3] Initializing trading bot...");
  const bot = new TradingBot({ config, privateKey: pair[0]! });

  if (bot.isInitialized()) {
    console.log("  Bot initialized successfully!");
    console.log(`  Signer address: ${bot.signer!.address}`);
  } else {
    console.log("  ERROR: Bot failed to initialize");
    process.exit(1);
  }
  console.log();

  console.log("[Step 4] Fetching open orders...");
  try {
    const orders = await bot.getOpenOrders();
    console.log(`  You have ${orders.length} open orders`);
    for (const o of orders.slice(0, 3)) {
      const token = String(o["tokenId"] ?? o["asset_id"] ?? "?").slice(0, 16);
      console.log(`    - ${o["side"]} ${o["size"]} @ ${o["price"]} (token: ${token}...)`);
    }
  } catch (e) {
    console.log(`  Could not fetch orders: ${e}`);
  }
  console.log();

  console.log("[Step 5] Fetching recent trades...");
  try {
    const trades = await bot.getTrades(undefined, 5);
    console.log(`  Found ${trades.length} recent trades`);
    for (const t of trades.slice(0, 3)) {
      console.log(`    - ${t["side"]} ${t["size"]} @ ${t["price"]}`);
    }
  } catch (e) {
    console.log(`  Could not fetch trades: ${e}`);
  }
  console.log();

  console.log("=".repeat(50));
  console.log("Quickstart complete!");
  console.log("=".repeat(50));
}

main().catch((e) => {
  console.error(`\nError: ${e}`);
  process.exit(1);
});
