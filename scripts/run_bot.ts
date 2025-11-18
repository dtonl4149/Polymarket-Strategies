#!/usr/bin/env npx tsx
/**
 * Run Script - Start the Trading Bot
 */

import "dotenv/config";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";

import { Config } from "../src/config.js";
import { KeyManager, InvalidPasswordError, CryptoError } from "../src/crypto.js";
import { TradingBot } from "../src/bot.js";

class Colors {
  static GREEN = "\u001b[92m";
  static YELLOW = "\u001b[93m";
  static RED = "\u001b[91m";
  static BLUE = "\u001b[94m";
  static CYAN = "\u001b[96m";
  static BOLD = "\u001b[1m";
  static RESET = "\u001b[0m";
}

function printHeader(title: string): void {
  console.log(`\n${Colors.BOLD}${Colors.BLUE}${"=".repeat(50)}${Colors.RESET}`);
  console.log(`${Colors.BOLD}${Colors.BLUE}${title.padStart(25 + title.length / 2).padEnd(50)}${Colors.RESET}`);
  console.log(`${Colors.BOLD}${Colors.BLUE}${"=".repeat(50)}${Colors.RESET}\n`);
}

function printSuccess(msg: string): void {
  console.log(`${Colors.GREEN}\u2713${Colors.RESET} ${msg}`);
}

function printError(msg: string): void {
  console.log(`${Colors.RED}\u2717${Colors.RESET} ${msg}`);
}

function checkEnvMode(): boolean {
  const pk = process.env.POLY_PRIVATE_KEY;
  const safe = process.env.POLY_SAFE_ADDRESS;
  return Boolean(pk && safe);
}

function loadConfigFromEnv(): Config {
  const config = Config.fromEnv();
  const errors = config.validate();
  if (errors.length) {
    printError("Configuration validation failed:");
    for (const e of errors) console.log(`  - ${e}`);
    process.exit(1);
  }
  return config;
}

function loadConfigFile(): Config {
  if (!existsSync("config.yaml")) {
    printError("config.yaml not found!");
    console.log("\nPlease run the setup first:");
    console.log(`  ${Colors.CYAN}npm run setup${Colors.RESET}`);
    process.exit(1);
  }
  try {
    const config = Config.load("config.yaml");
    const errors = config.validate();
    if (errors.length) {
      printError("Configuration validation failed:");
      for (const e of errors) console.log(`  - ${e}`);
      process.exit(1);
    }
    return config;
  } catch (e) {
    printError(`Failed to load config: ${e}`);
    process.exit(1);
  }
}

function getPrivateKeyFromEnv(): string {
  const pk = process.env.POLY_PRIVATE_KEY;
  if (!pk) {
    printError("POLY_PRIVATE_KEY environment variable not set!");
    process.exit(1);
  }
  return pk;
}

async function decryptPrivateKey(): Promise<string> {
  const keyPath = "credentials/encrypted_key.json";
  if (!existsSync(keyPath)) {
    printError("Encrypted key not found!");
    console.log("\nPlease run the setup first:");
    console.log(`  ${Colors.CYAN}npm run setup${Colors.RESET}`);
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const question = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

  console.log(`${Colors.BOLD}Enter decryption password:${Colors.RESET}`);
  for (;;) {
    const password = await question("Password: ");
    try {
      const manager = new KeyManager();
      const pk = manager.loadAndDecrypt(password, keyPath);
      rl.close();
      printSuccess("Private key decrypted");
      return pk;
    } catch (e) {
      if (e instanceof InvalidPasswordError) printError("Invalid password, try again");
      else if (e instanceof CryptoError) {
        printError(`Failed to decrypt: ${e}`);
        rl.close();
        process.exit(1);
      } else {
        rl.close();
        throw e;
      }
    }
  }
}

function printHelp(): void {
  console.log(`${Colors.BOLD}Available Commands:${Colors.RESET}`);
  console.log("  help          - Show this help message");
  console.log("  status        - Show bot status and open orders");
  console.log("  place <token> <price> <size> <side> - Place an order");
  console.log("  cancel <order_id> - Cancel an order");
  console.log("  cancel-all    - Cancel all orders");
  console.log("  trades        - Show recent trades");
  console.log("  price <token> - Get market price");
  console.log("  exit          - Exit the bot");
}

async function printStatus(bot: TradingBot): Promise<void> {
  const c = bot.config;
  console.log(`${Colors.BOLD}Bot Status:${Colors.RESET}`);
  console.log(`  Safe Address: ${c.safe_address}`);
  console.log(`  Gasless Mode: ${c.use_gasless ? "Enabled" : "Disabled"}`);
  console.log(`  Data Dir: ${c.data_dir}`);
  const orders = await bot.getOpenOrders();
  console.log(`  Open Orders: ${orders.length}`);
  if (orders.length) {
    console.log(`\n${Colors.BOLD}Open Orders:${Colors.RESET}`);
    for (const o of orders.slice(0, 5)) {
      const tid = String(o["tokenId"] ?? o["asset_id"] ?? "?");
      console.log(`  - ${o["side"]} ${o["size"]} @ ${o["price"]} (${tid.slice(0, 16)}...)`);
    }
    if (orders.length > 5) console.log(`  ... and ${orders.length - 5} more`);
  }
}

async function interactiveSession(bot: TradingBot): Promise<void> {
  printHeader("Polymarket Trading Bot");
  printSuccess("Bot initialized and ready!");
  console.log(`\nType ${Colors.CYAN}help${Colors.RESET} for available commands\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const question = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

  for (;;) {
    const cmd = (await question(`${Colors.CYAN}bot>${Colors.RESET} `)).trim().toLowerCase();
    if (!cmd) continue;
    if (cmd === "exit") {
      console.log("\nGoodbye!");
      rl.close();
      break;
    }
    if (cmd === "help") printHelp();
    else if (cmd === "status") await printStatus(bot);
    else if (cmd === "cancel-all") {
      const r = await bot.cancelAllOrders();
      if (r.success) printSuccess(r.message);
      else printError(r.message);
    } else if (cmd.startsWith("cancel ")) {
      const parts = cmd.split(/\s+/);
      if (parts.length >= 2) {
        const orderId = parts[1]!;
        const r = await bot.cancelOrder(orderId);
        if (r.success) printSuccess(`Order ${orderId} cancelled`);
        else printError(r.message);
      } else printError("Usage: cancel <order_id>");
    } else if (cmd.startsWith("place ")) {
      const parts = cmd.split(/\s+/);
      if (parts.length >= 5) {
        const [, tokenId, price, size, side] = parts;
        try {
          const r = await bot.placeOrder(
            tokenId!,
            parseFloat(price!),
            parseFloat(size!),
            side!.toUpperCase()
          );
          if (r.success) printSuccess(`Order placed: ${r.order_id}`);
          else printError(`Order failed: ${r.message}`);
        } catch (e) {
          printError(`Invalid parameters: ${e}`);
        }
      } else printError("Usage: place <token_id> <price> <size> <side>");
    } else if (cmd.startsWith("price ")) {
      const parts = cmd.split(/\s+/);
      if (parts.length >= 2) {
        const tokenId = parts[1]!;
        const data = await bot.getMarketPrice(tokenId);
        if (Object.keys(data).length) console.log(`Price: ${data["price"] ?? JSON.stringify(data)}`);
        else printError("Failed to get price");
      } else printError("Usage: price <token_id>");
    } else if (cmd === "trades") {
      const trades = await bot.getTrades(undefined, 10);
      if (trades.length) {
        console.log(`${Colors.BOLD}Recent Trades:${Colors.RESET}`);
        for (const t of trades.slice(0, 5)) {
          console.log(`  - ${t["side"]} ${t["size"]} @ ${t["price"]}`);
        }
      } else console.log("No trades yet");
    } else {
      printError(`Unknown command: ${cmd}`);
      console.log("Type 'help' for available commands");
    }
  }
}

async function quickDemo(bot: TradingBot): Promise<void> {
  printHeader("Quick Demo");
  await printStatus(bot);
  if (bot.config.default_token_id) {
    console.log(`\n${Colors.BOLD}Market Price:${Colors.RESET}`);
    const p = await bot.getMarketPrice(bot.config.default_token_id);
    if (Object.keys(p).length) console.log(`  ${JSON.stringify(p)}`);
    else console.log("  Failed to get price");
  } else {
    console.log(`\n${Colors.YELLOW}No default token configured.${Colors.RESET}`);
    console.log("  Set 'default_token_id' in config.yaml to enable price lookup.");
  }
}

async function main(): Promise<void> {
  printHeader("Polymarket Trading Bot");

  const useEnv = checkEnvMode();
  let config: Config;
  let privateKey: string;

  if (useEnv) {
    printSuccess("Using environment variables mode");
    config = loadConfigFromEnv();
    privateKey = getPrivateKeyFromEnv();
    printSuccess(`Configuration loaded (gasless: ${config.use_gasless})`);
  } else {
    console.log(
      `${Colors.YELLOW}Environment variables not found, using encrypted key mode${Colors.RESET}`
    );
    console.log(`  Tip: Set POLY_PRIVATE_KEY and POLY_SAFE_ADDRESS in .env for easier setup\n`);
    config = loadConfigFile();
    printSuccess(`Configuration loaded (gasless: ${config.use_gasless})`);
    privateKey = await decryptPrivateKey();
  }

  let bot: TradingBot;
  try {
    bot = new TradingBot({ config, privateKey });
  } catch (e) {
    printError(`Failed to initialize bot: ${e}`);
    process.exit(1);
  }

  printSuccess("Bot initialized!");

  const interactive = process.argv.includes("--interactive");
  if (interactive) await interactiveSession(bot);
  else await quickDemo(bot);
}

main().catch((e) => {
  console.error(`\n${Colors.RED}Error: ${e}${Colors.RESET}`);
  process.exit(1);
});
