/**
 * Client / bot tests
 */

import { describe, it, expect, vi } from "vitest";

import { ClobClient } from "../src/client.js";
import { TradingBot } from "../src/bot.js";
import { Config } from "../src/config.js";

describe("ClobClient getTrades", () => {
  it("passes limit and token", async () => {
    const client = new ClobClient("https://example.com");
    const captured: Record<string, unknown> = {};
    vi.spyOn(client, "_request").mockImplementation(async (...args: unknown[]) => {
      captured.method = args[0];
      captured.endpoint = args[1];
      captured.params = args[4];
      return [];
    });

    await client.getTrades("token_123", 50);

    expect(captured.method).toBe("GET");
    expect(captured.endpoint).toBe("/data/trades");
    expect(captured.params).toEqual({ limit: 50, token_id: "token_123" });
  });

  it("passes limit only", async () => {
    const client = new ClobClient("https://example.com");
    const captured: Record<string, unknown> = {};
    vi.spyOn(client, "_request").mockImplementation(async (...args: unknown[]) => {
      captured.params = args[4];
      return [];
    });

    await client.getTrades(undefined, 25);

    expect(captured.params).toEqual({ limit: 25 });
  });
});

describe("TradingBot getMarketPrice", () => {
  it("delegates to clob client", async () => {
    const config = new Config();
    config.safe_address = "0x" + "b".repeat(40);
    const bot = new TradingBot({ config });

    bot["clob_client"] = {
      async getMarketPrice(token_id: string) {
        return { price: 0.5, token_id };
      },
    } as never;

    const result = await bot.getMarketPrice("token_abc");
    expect(result.price).toBe(0.5);
  });
});
