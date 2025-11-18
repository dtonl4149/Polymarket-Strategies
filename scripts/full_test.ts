#!/usr/bin/env npx tsx
/**
 * Full Integration Test Script
 */

import "dotenv/config";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KeyManager, verifyPrivateKey } from "../src/crypto.js";
import { Config, BuilderConfig } from "../src/config.js";
import { TradingBot } from "../src/bot.js";
import { ClobClient } from "../src/client.js";
import { OrderSigner, Order } from "../src/signer.js";

class Colors {
  static GREEN = "\u001b[92m";
  static YELLOW = "\u001b[93m";
  static RED = "\u001b[91m";
  static BLUE = "\u001b[94m";
  static BOLD = "\u001b[1m";
  static RESET = "\u001b[0m";
}

function printHeader(title: string): void {
  console.log(`\n${Colors.BOLD}${Colors.BLUE}${"=".repeat(60)}${Colors.RESET}`);
  console.log(`${Colors.BOLD}${Colors.BLUE}${title.padStart(30 + title.length / 2).padEnd(60)}${Colors.RESET}`);
  console.log(`${Colors.BOLD}${Colors.BLUE}${"=".repeat(60)}${Colors.RESET}\n`);
}

function printSuccess(msg: string): void {
  console.log(`${Colors.GREEN}\u2713${Colors.RESET} ${msg}`);
}

function printError(msg: string): void {
  console.log(`${Colors.RED}\u2717${Colors.RESET} ${msg}`);
}

function printWarning(msg: string): void {
  console.log(`${Colors.YELLOW}\u26a0${Colors.RESET} ${msg}`);
}

function printInfo(msg: string): void {
  console.log(`${Colors.BLUE}\u2139${Colors.RESET} ${msg}`);
}

function getTestCredentials() {
  return {
    private_key: process.env.POLY_PRIVATE_KEY ?? "",
    safe_address: process.env.POLY_SAFE_ADDRESS ?? "",
    builder_key: process.env.POLY_BUILDER_API_KEY ?? "",
    builder_secret: process.env.POLY_BUILDER_API_SECRET ?? "",
    builder_passphrase: process.env.POLY_BUILDER_API_PASSPHRASE ?? "",
  };
}

function testCryptoModule(privateKey: string): boolean {
  printHeader("1. Testing Crypto Module (crypto.ts)");
  try {
    const [ok, result] = verifyPrivateKey(privateKey);
    if (!ok) {
      printError(`Private key validation failed: ${result}`);
      return false;
    }
    printSuccess("Private key format valid");

    const manager = new KeyManager();
    const password = "test_password_123";
    const encrypted = manager.encrypt(privateKey, password);
    printSuccess(`Encryption successful: ${Object.keys(encrypted).join(", ")}`);

    const decrypted = manager.decrypt(encrypted, password);
    let normalized = privateKey.toLowerCase();
    if (!normalized.startsWith("0x")) normalized = "0x" + normalized;
    if (decrypted.toLowerCase() !== normalized) {
      printError("Decryption mismatch!");
      return false;
    }
    printSuccess("Decryption matches original key");

    const tmp = mkdtempSync(join(tmpdir(), "poly-test-"));
    try {
      const keyFile = join(tmp, "test_key.json");
      manager.encryptAndSave(privateKey, password, keyFile);
      printSuccess("Saved encrypted key to file");

      const manager2 = new KeyManager();
      const loaded = manager2.loadAndDecrypt(password, keyFile);
      if (loaded.toLowerCase() !== normalized) {
        printError("File load/decrypt mismatch!");
        return false;
      }
      printSuccess("File load/decrypt successful");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }

    return true;
  } catch (e) {
    printError(`Crypto test failed: ${e}`);
    return false;
  }
}

async function testSignerModule(privateKey: string, expectedAddress: string): Promise<boolean> {
  printHeader("2. Testing Signer Module (signer.ts)");
  try {
    const signer = new OrderSigner(privateKey);
    printSuccess(`Signer created: ${signer.address}`);

    if (signer.address.toLowerCase() !== expectedAddress.toLowerCase()) {
      printWarning(`Address mismatch: expected ${expectedAddress}`);
    }

    const authSig = await signer.signAuthMessage();
    if (!authSig.startsWith("0x") || authSig.length !== 132) {
      printError("Invalid auth signature format");
      return false;
    }
    printSuccess(`Auth signature valid: ${authSig.slice(0, 20)}...${authSig.slice(-10)}`);

    const order = new Order(
      "12345678901234567890",
      0.65,
      10.0,
      "BUY",
      expectedAddress
    );
    const signed = await signer.signOrder(order);
    if (signed.order && signed.signature && signed.signer) {
      printSuccess("Order signed successfully");
      printSuccess(`Signature: ${String(signed.signature).slice(0, 20)}...${String(signed.signature).slice(-10)}`);
    } else {
      printError("Order signing failed");
      return false;
    }

    return true;
  } catch (e) {
    printError(`Signer test failed: ${e}`);
    console.error(e);
    return false;
  }
}

function testConfigModule(creds: ReturnType<typeof getTestCredentials>): boolean {
  printHeader("3. Testing Config Module (config.ts)");
  try {
    const config = Config.fromEnv();
    printSuccess("Config.fromEnv() successful");
    printInfo(`Safe address: ${config.safe_address || "(not set)"}`);
    printInfo(`Builder configured: ${config.builder.isConfigured()}`);
    printInfo(`Gasless mode: ${config.use_gasless}`);

    const manualConfig = new Config();
    manualConfig.safe_address = creds.safe_address;
    if (creds.builder_key) {
      manualConfig.builder = new BuilderConfig();
      manualConfig.builder.api_key = creds.builder_key;
      manualConfig.builder.api_secret = creds.builder_secret;
      manualConfig.builder.api_passphrase = creds.builder_passphrase;
      manualConfig.use_gasless = manualConfig.builder.isConfigured();
    }

    const errors = manualConfig.validate();
    if (errors.length) printWarning(`Validation warnings: ${errors.join(", ")}`);
    else printSuccess("Config validation passed");

    const tmp = mkdtempSync(join(tmpdir(), "poly-cfg-"));
    try {
      const configFile = join(tmp, "config.yaml");
      manualConfig.save(configFile);
      printSuccess("Config saved to YAML");

      const loaded = Config.load(configFile);
      if (loaded.safe_address !== manualConfig.safe_address) {
        printError("Config load mismatch");
        return false;
      }
      printSuccess("Config loaded from YAML");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }

    return true;
  } catch (e) {
    printError(`Config test failed: ${e}`);
    console.error(e);
    return false;
  }
}

async function testBotModule(creds: ReturnType<typeof getTestCredentials>): Promise<boolean> {
  printHeader("4. Testing Bot Module (bot.ts)");
  try {
    const config = new Config();
    config.safe_address = creds.safe_address;
    if (creds.builder_key) {
      config.builder = new BuilderConfig();
      config.builder.api_key = creds.builder_key;
      config.builder.api_secret = creds.builder_secret;
      config.builder.api_passphrase = creds.builder_passphrase;
      config.use_gasless = config.builder.isConfigured();
    }

    const bot = new TradingBot({ config, privateKey: creds.private_key });

    printSuccess(`Bot initialized: ${bot.isInitialized()}`);
    printInfo(`Signer: ${bot.signer?.address ?? "None"}`);
    printInfo(`CLOB Client: ${bot.clob_client != null}`);
    printInfo(`Relayer Client: ${bot.relayer_client != null}`);
    printInfo(`Gasless: ${config.use_gasless}`);

    const orderDict = bot.createOrderDict("1234567890", 0.65, 10.0, "BUY");
    if (orderDict["side"] === "BUY") printSuccess("Order dict creation successful");
    else {
      printError("Order dict creation failed");
      return false;
    }

    return true;
  } catch (e) {
    printError(`Bot test failed: ${e}`);
    console.error(e);
    return false;
  }
}

function testClientModule(creds: ReturnType<typeof getTestCredentials>): boolean {
  printHeader("5. Testing Client Module (client.ts)");
  try {
    const builderConfig =
      creds.builder_key && creds.builder_secret && creds.builder_passphrase
        ? (() => {
            const b = new BuilderConfig();
            b.api_key = creds.builder_key;
            b.api_secret = creds.builder_secret;
            b.api_passphrase = creds.builder_passphrase;
            return b;
          })()
        : null;

    const clob = new ClobClient(
      "https://clob.polymarket.com",
      137,
      2,
      creds.safe_address,
      null,
      builderConfig
    );

    printSuccess("CLOB Client created");
    printInfo(`Host: ${clob.host}`);
    printInfo(`Chain ID: ${clob.chain_id}`);

    if (builderConfig?.isConfigured()) {
      const headers = clob._buildHeaders("GET", "/orders");
      const keys = [
        "POLY_BUILDER_API_KEY",
        "POLY_BUILDER_TIMESTAMP",
        "POLY_BUILDER_PASSPHRASE",
        "POLY_BUILDER_SIGNATURE",
      ];
      if (keys.every((k) => k in headers)) printSuccess(`HMAC headers generated: ${Object.keys(headers).join(", ")}`);
      else {
        printError("Missing HMAC headers");
        return false;
      }
    } else {
      printWarning("Builder not configured, skipping HMAC test");
    }

    return true;
  } catch (e) {
    printError(`Client test failed: ${e}`);
    console.error(e);
    return false;
  }
}

async function testFileWorkflow(creds: ReturnType<typeof getTestCredentials>): Promise<boolean> {
  printHeader("6. Testing Complete File Workflow");
  try {
    const tmp = mkdtempSync(join(tmpdir(), "poly-fw-"));
    try {
      const keyFile = join(tmp, "encrypted_key.json");
      const configFile = join(tmp, "config.yaml");
      const password = "secure_test_password";

      const manager = new KeyManager();
      manager.encryptAndSave(creds.private_key, password, keyFile);
      printSuccess("Step 1: Encrypted key saved");

      const config = new Config();
      config.safe_address = creds.safe_address;
      config.data_dir = tmp;
      if (creds.builder_key) {
        config.builder = new BuilderConfig();
        config.builder.api_key = creds.builder_key;
        config.builder.api_secret = creds.builder_secret;
        config.builder.api_passphrase = creds.builder_passphrase;
        config.use_gasless = config.builder.isConfigured();
      }
      config.save(configFile);
      printSuccess("Step 2: Config saved");

      const loadedConfig = Config.load(configFile);
      printSuccess("Step 3: Config loaded");

      const bot = new TradingBot({
        config: loadedConfig,
        encryptedKeyPath: keyFile,
        password,
      });
      printSuccess("Step 4: Bot initialized with encrypted key");

      if (bot.isInitialized() && bot.signer) {
        printSuccess("Step 5: Bot fully operational");
        return true;
      }
      printError("Bot not fully initialized");
      return false;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } catch (e) {
    printError(`File workflow test failed: ${e}`);
    console.error(e);
    return false;
  }
}

async function main(): Promise<number> {
  printHeader("Polymarket Trading Bot - Full Integration Test");

  const creds = getTestCredentials();
  if (!creds.private_key) {
    printError("POLY_PRIVATE_KEY environment variable not set!");
    printInfo("Set it in .env or export POLY_PRIVATE_KEY=your_private_key");
    return 1;
  }
  if (!creds.safe_address) {
    printError("POLY_SAFE_ADDRESS environment variable not set!");
    return 1;
  }

  printInfo(`Testing with address: ${creds.safe_address}`);
  printInfo(`Builder configured: ${Boolean(creds.builder_key)}`);

  const results: [string, boolean][] = [];
  results.push(["Crypto Module", testCryptoModule(creds.private_key)]);
  results.push(["Signer Module", await testSignerModule(creds.private_key, creds.safe_address)]);
  results.push(["Config Module", testConfigModule(creds)]);
  results.push(["Bot Module", await testBotModule(creds)]);
  results.push(["Client Module", testClientModule(creds)]);
  results.push(["File Workflow", await testFileWorkflow(creds)]);

  printHeader("Test Summary");
  let passed = 0;
  let failed = 0;
  for (const [name, ok] of results) {
    if (ok) {
      printSuccess(`${name}: PASSED`);
      passed++;
    } else {
      printError(`${name}: FAILED`);
      failed++;
    }
  }

  console.log(`\n${Colors.BOLD}Total: ${passed} passed, ${failed} failed${Colors.RESET}`);
  if (failed === 0) {
    console.log(`\n${Colors.GREEN}${Colors.BOLD}All tests passed!${Colors.RESET}`);
    return 0;
  }
  console.log(`\n${Colors.RED}${Colors.BOLD}Some tests failed!${Colors.RESET}`);
  return 1;
}

main().then((code) => process.exit(code));
