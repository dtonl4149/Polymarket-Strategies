/**
 * Unit tests for bot module
 */

import { describe, it, expect } from "vitest";

import { TradingBot, OrderResult, NotInitializedError } from "../src/bot.js";
import { Config } from "../src/config.js";

describe("OrderResult", () => {
  it("fromResponse success", () => {
    const r = OrderResult.fromResponse({
      success: true,
      orderId: "order_123",
      status: "live",
    } as Record<string, unknown>);
    expect(r.success).toBe(true);
    expect(r.order_id).toBe("order_123");
    expect(r.status).toBe("live");
    expect(r.message.toLowerCase()).toContain("success");
  });

  it("fromResponse failure", () => {
    const r = OrderResult.fromResponse({
      success: false,
      errorMsg: "Insufficient balance",
    } as Record<string, unknown>);
    expect(r.success).toBe(false);
    expect(r.message).toBe("Insufficient balance");
  });

  it("defaults", () => {
    const r = new OrderResult(true, null, null, "Test");
    expect(r.order_id).toBeNull();
    expect(r.data).toEqual({});
  });
});

describe("TradingBot", () => {
  const TEST_SAFE = "0x" + "b".repeat(40);
  const TEST_KEY = "0x" + "a".repeat(64);

  it("init with config only", () => {
    const config = new Config();
    config.safe_address = TEST_SAFE;
    config.use_gasless = false;
    const bot = new TradingBot({ config });
    expect(bot.config).toBe(config);
    expect(bot.signer).toBeNull();
  });

  it("init with private key", () => {
    const config = new Config();
    config.safe_address = TEST_SAFE;
    const bot = new TradingBot({ config, privateKey: TEST_KEY });
    expect(bot.signer).not.toBeNull();
    expect(bot.isInitialized()).toBe(true);
  });

  it("createOrderDict", () => {
    const config = new Config();
    config.safe_address = TEST_SAFE;
    const bot = new TradingBot({ config, privateKey: TEST_KEY });
    const d = bot.createOrderDict("tok", 0.5, 1, "buy");
    expect(d["side"]).toBe("BUY");
  });

  it("requireSigner throws", () => {
    const config = new Config();
    config.safe_address = TEST_SAFE;
    const bot = new TradingBot({ config });
    expect(() => bot.requireSigner()).toThrow(NotInitializedError);
  });
});
