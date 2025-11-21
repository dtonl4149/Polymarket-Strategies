#!/usr/bin/env npx tsx
/**
 * Setup Script - Initial Configuration
 */

import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { Wallet } from "ethers";

import { KeyManager, verifyPrivateKey } from "../src/crypto.js";
import { Config, BuilderConfig } from "../src/config.js";

class Colors {
  static GREEN = "\u001b[92m";
  static YELLOW = "\u001b[93m";
  static RED = "\u001b[91m";
  static BLUE = "\u001b[94m";
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

function printWarning(msg: string): void {
  console.log(`${Colors.YELLOW}\u26a0${Colors.RESET} ${msg}`);
}

function printError(msg: string): void {
  console.log(`${Colors.RED}\u2717${Colors.RESET} ${msg}`);
}

function printStep(step: number, total: number, title: string): void {
  console.log(`\n${Colors.BOLD}Step ${step}/${total}: ${title}${Colors.RESET}`);
}

async function inputPrivateKey(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const question = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

  console.log("Enter your MetaMask private key (will be encrypted and stored securely)");
  console.log(`${Colors.YELLOW}Tip: Open MetaMask \u2192 Account Details \u2192 Export Private Key${Colors.RESET}\n`);

  for (;;) {
    const pk = (await question(`${Colors.BOLD}Private Key${Colors.RESET}: `)).trim();
    if (!pk) {
      printError("Private key cannot be empty");
      continue;
    }
    const [ok, result] = verifyPrivateKey(pk);
    if (ok) {
      rl.close();
      return result;
    }
    printError(result);
  }
}

async function inputPassword(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const question = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

  console.log("Set a password to encrypt your private key");
  console.log(`${Colors.YELLOW}This password is required to start the trading bot${Colors.RESET}\n`);

  for (;;) {
    const password = (await question(`${Colors.BOLD}Password${Colors.RESET}: `)).trim();
    if (password.length < 8) {
      printError("Password must be at least 8 characters");
      continue;
    }
    const confirm = (await question(`${Colors.BOLD}Confirm Password${Colors.RESET}: `)).trim();
    if (password !== confirm) {
      printError("Passwords do not match");
      continue;
    }
    rl.close();
    return password;
  }
}

async function inputSafeAddress(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const question = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

  console.log("Enter your Polymarket Safe/Proxy wallet address");
  console.log(`${Colors.YELLOW}Tip: polymarket.com/settings \u2192 General \u2192 Wallet Address${Colors.RESET}\n`);

  for (;;) {
    const address = (await question(`${Colors.BOLD}Safe Address${Colors.RESET}: `)).trim().toLowerCase();
    if (!address) {
      printError("Address cannot be empty");
      continue;
    }
    if (!address.startsWith("0x") || address.length !== 42) {
      printError("Invalid Ethereum address format");
      continue;
    }
    rl.close();
    return address;
  }
}

async function inputBuilderCredentials(): Promise<Record<string, string>> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const question = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

  console.log(`${Colors.BLUE}Builder Program Credentials (optional)${Colors.RESET}`);
  console.log("If you have Builder Program access, enter your credentials for gasless trading");
  console.log(`${Colors.YELLOW}Leave empty to skip (you'll pay gas fees yourself)${Colors.RESET}\n`);

  const apiKey = (await question(`${Colors.BOLD}Builder API Key${Colors.RESET} (Enter to skip): `)).trim();
  if (!apiKey) {
    rl.close();
    return {};
  }
  const apiSecret = (await question(`${Colors.BOLD}Builder Secret${Colors.RESET}: `)).trim();
  const apiPassphrase = (await question(`${Colors.BOLD}Builder Passphrase${Colors.RESET}: `)).trim();
  rl.close();

  if (!apiSecret || !apiPassphrase) {
    printWarning("Incomplete Builder credentials, skipping gasless mode");
    return {};
  }

  return {
    api_key: apiKey,
    api_secret: apiSecret,
    api_passphrase: apiPassphrase,
  };
}

function createConfig(safeAddress: string, builderCreds: Record<string, string>, dataDir = "credentials"): Config {
  const config = new Config();
  config.safe_address = safeAddress;
  config.data_dir = dataDir;
  if (Object.keys(builderCreds).length) {
    config.builder = new BuilderConfig();
    config.builder.api_key = builderCreds.api_key ?? "";
    config.builder.api_secret = builderCreds.api_secret ?? "";
    config.builder.api_passphrase = builderCreds.api_passphrase ?? "";
  }
  config.use_gasless = config.builder.isConfigured();
  return config;
}

async function main(): Promise<void> {
  printHeader("Polymarket Trading Bot Setup");
  console.log(`${Colors.BLUE}This script will help you configure the trading bot.${Colors.RESET}`);
  console.log(`${Colors.BLUE}Your private key will be encrypted and stored securely.${Colors.RESET}`);

  printStep(1, 4, "Private Key");
  const privateKey = await inputPrivateKey();
  const wallet = new Wallet(privateKey);
  printSuccess(`Wallet address: ${wallet.address}`);

  printStep(2, 4, "Encryption Password");
  const password = await inputPassword();
  printSuccess("Password set");

  printStep(3, 4, "Safe Address");
  const safeAddress = await inputSafeAddress();
  printSuccess(`Safe address: ${safeAddress}`);

  printStep(4, 4, "Builder Credentials (Optional)");
  const builderCreds = await inputBuilderCredentials();

  console.log("\nCreating directories...");
  mkdirSync("credentials", { recursive: true });
  printSuccess("Created credentials/ directory");

  console.log("\nEncrypting private key...");
  const manager = new KeyManager();
  const keyPath = manager.encryptAndSave(privateKey, password, "credentials/encrypted_key.json");
  printSuccess(`Encrypted key saved to ${keyPath}`);

  console.log("\nCreating config.yaml...");
  const config = createConfig(safeAddress, builderCreds);
  config.save("config.yaml");
  printSuccess("config.yaml created");

  printHeader("Setup Complete!");
  console.log(`${Colors.GREEN}\u2713${Colors.RESET} Private key encrypted and saved`);
  console.log(`${Colors.GREEN}\u2713${Colors.RESET} Config file created`);
  console.log(`${Colors.GREEN}\u2713${Colors.RESET} Ready to trade!\n`);

  console.log(`${Colors.BOLD}Next steps:${Colors.RESET}`);
  console.log("1. Test the setup: npm start");
  console.log("2. Customize config.yaml if needed");
  console.log("3. Build your trading strategy!\n");

  if (Object.keys(builderCreds).length) {
    console.log(`${Colors.GREEN}Gasless mode: ENABLED${Colors.RESET}`);
  } else {
    printWarning("Gasless mode: DISABLED (no Builder credentials)");
    console.log(`${Colors.YELLOW}To enable later, add Builder credentials to config.yaml${Colors.RESET}`);
  }
}

main().catch((e) => {
  console.error(`\n${Colors.RED}Error: ${e}${Colors.RESET}`);
  process.exit(1);
});
