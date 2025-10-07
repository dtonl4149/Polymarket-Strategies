/**
 * Utility Module - Helper Functions
 */

import { getEnv } from "./config.js";
import { Config } from "./config.js";
import { TradingBot } from "./bot.js";
import { verifyPrivateKey } from "./crypto.js";

export function validateAddress(address: string): boolean {
  if (!address) return false;
  if (!address.startsWith("0x")) return false;
  if (address.length !== 42) return false;
  try {
    BigInt(address);
    return true;
  } catch {
    return false;
  }
}

export function validatePrivateKey(key: string): [boolean, string] {
  if (!key) return [false, "Private key cannot be empty"];
  const [ok, result] = verifyPrivateKey(key);
  if (ok) return [true, result];
  if (result.includes("64 hex")) return [false, "Private key must be 64 hex characters (32 bytes)"];
  if (result.toLowerCase().includes("invalid")) return [false, "Private key contains invalid characters"];
  return [false, result];
}

export function formatPrice(price: number, decimals = 2): string {
  const percentage = price * 100;
  return `${price.toFixed(decimals)} (${percentage.toFixed(0)}%)`;
}

export function formatUsdc(amount: number, decimals = 2): string {
  return `$${amount.toFixed(decimals)} USDC`;
}

export function createBotFromEnv(): TradingBot {
  const privateKey = getEnv("PRIVATE_KEY");
  if (!privateKey) {
    throw new Error(
      "POLY_PRIVATE_KEY environment variable is required. Set it with POLY_PRIVATE_KEY=your_key"
    );
  }
  const safeAddress = getEnv("SAFE_ADDRESS");
  if (!safeAddress) {
    throw new Error(
      "POLY_SAFE_ADDRESS environment variable is required. Set it with POLY_SAFE_ADDRESS=0x..."
    );
  }
  const config = Config.fromEnv();
  return new TradingBot({ config, privateKey });
}

export function truncateAddress(address: string, chars = 6): string {
  if (!address || address.length < chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function truncateTokenId(token_id: string, chars = 8): string {
  if (!token_id || token_id.length <= chars) return token_id;
  return `${token_id.slice(0, chars)}...`;
}

export {
  getEnv,
};
