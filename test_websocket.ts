#!/usr/bin/env npx tsx
/**
 * Test WebSocket subscription to Polymarket CLOB market channel.
 */

import WebSocket from "ws";

import { GammaClient } from "./src/gamma_client.js";

async function main(): Promise<void> {
  const gamma = new GammaClient();
  const marketInfo = await gamma.getMarketInfo("BTC");

  if (!marketInfo) {
    console.log("No active BTC market found");
    return;
  }

  console.log(`Market: ${marketInfo["question"]}`);
  console.log(`Accepting orders: ${marketInfo["accepting_orders"]}`);

  const tokenIds = marketInfo["token_ids"] as Record<string, string>;
  const upToken = tokenIds["up"];
  const downToken = tokenIds["down"];

  console.log(`Up token: ${upToken}`);
  console.log(`Down token: ${downToken}`);

  if (!upToken || !downToken) {
    console.log("Missing token IDs");
    return;
  }

  const url = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
  console.log(`\nConnecting to ${url}...`);

  const ws = new WebSocket(url);

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

  console.log("Connected!");

  const subscribeMsg = {
    assets_ids: [upToken, downToken],
    type: "MARKET",
  };

  console.log(`\nSending subscription: ${JSON.stringify(subscribeMsg)}`);
  ws.send(JSON.stringify(subscribeMsg));
  console.log("Subscription sent!");
  console.log("\nWaiting for messages (Ctrl+C to stop)...\n");

  let msgCount = 0;
  ws.on("message", (data: WebSocket.RawData) => {
    msgCount++;
    const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
    const eventType = String(parsed.event_type ?? "unknown");
    if (eventType === "book") {
      const bids = (parsed.bids as Array<Record<string, unknown>>) ?? [];
      const asks = (parsed.asks as Array<Record<string, unknown>>) ?? [];
      const bestBid = bids[0]?.["price"] ?? "N/A";
      const bestAsk = asks[0]?.["price"] ?? "N/A";
      console.log(`[${msgCount}] book best_bid=${bestBid} best_ask=${bestAsk}`);
    } else {
      console.log(`[${msgCount}] ${eventType}`);
    }
  });
}

main().catch(console.error);
