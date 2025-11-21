#!/usr/bin/env npx tsx
/**
 * Strategy Example (template / demo)
 */

import "dotenv/config";

import { TradingBot } from "../src/bot.js";
import { Config } from "../src/config.js";

async function runExampleStrategy(): Promise<void> {
  const privateKey = process.env.POLY_PRIVATE_KEY;
  const safeAddress = process.env.POLY_SAFE_ADDRESS;
  if (!privateKey || !safeAddress) {
    console.log("Error: Set POLY_PRIVATE_KEY and POLY_SAFE_ADDRESS in .env file");
    return;
  }

  const config = Config.fromEnv();
  const bot = new TradingBot({ config, privateKey });

  console.log(`Strategy demo: bot initialized: ${bot.isInitialized()}`);
  console.log(`Signer address: ${bot.signer?.address ?? "None"}`);
  console.log();
  console.log("To run FlashCrashStrategy:");
  console.log("  import { FlashCrashStrategy, FlashCrashConfig } from '../strategies/index.js';");
  console.log("  const strategy = new FlashCrashStrategy(bot, new FlashCrashConfig());");
  console.log("  await strategy.run();");
}

async function main(): Promise<void> {
  console.log("=".repeat(50));
  console.log("Strategy Example");
  console.log("=".repeat(50));
  await runExampleStrategy();
}

main().catch((e) => {
  console.error(`\nError: ${e}`);
  process.exit(1);
});
