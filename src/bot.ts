/**
 * Trading Bot Module - Main Trading Interface
 */

import { existsSync } from "node:fs";

import { Config, type BuilderConfig } from "./config.js";
import { KeyManager, CryptoError, InvalidPasswordError } from "./crypto.js";
import { OrderSigner, Order } from "./signer.js";
import { ClobClient, RelayerClient, ApiCredentials } from "./client.js";

export enum OrderSide {
  BUY = "BUY",
  SELL = "SELL",
}

export enum OrderType {
  GTC = "GTC",
  GTD = "GTD",
  FOK = "FOK",
}

export class OrderResult {
  success: boolean;
  order_id: string | null;
  status: string | null;
  message: string;
  data: Record<string, unknown>;

  constructor(
    success: boolean,
    order_id: string | null = null,
    status: string | null = null,
    message = "",
    data: Record<string, unknown> = {}
  ) {
    this.success = success;
    this.order_id = order_id;
    this.status = status;
    this.message = message;
    this.data = data;
  }

  static fromResponse(response: Record<string, unknown>): OrderResult {
    const success = Boolean(response.success);
    const errorMsg = String(response.errorMsg ?? "");
    return new OrderResult(
      success,
      response.orderId != null ? String(response.orderId) : null,
      response.status != null ? String(response.status) : null,
      !success ? errorMsg : "Order placed successfully",
      response as Record<string, unknown>
    );
  }
}

export class TradingBotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradingBotError";
  }
}

export class NotInitializedError extends TradingBotError {
  constructor(message: string) {
    super(message);
    this.name = "NotInitializedError";
  }
}

export class TradingBot {
  config: Config;
  signer: OrderSigner | null = null;
  clob_client: ClobClient | null = null;
  relayer_client: RelayerClient | null = null;
  private _api_creds: ApiCredentials | null = null;

  constructor(
    options: {
      configPath?: string;
      config?: Config;
      safeAddress?: string;
      builderCreds?: BuilderConfig;
      privateKey?: string;
      encryptedKeyPath?: string;
      password?: string;
      apiCredsPath?: string;
    } = {}
  ) {
    let config: Config;
    if (options.configPath) {
      config = Config.load(options.configPath);
    } else if (options.config) {
      config = options.config;
    } else {
      config = new Config();
    }

    if (options.safeAddress) config.safe_address = options.safeAddress;
    if (options.builderCreds) {
      config.builder = options.builderCreds;
      config.use_gasless = true;
    }
    this.config = config;

    if (options.privateKey) {
      this.signer = new OrderSigner(options.privateKey);
    } else if (options.encryptedKeyPath && options.password) {
      this.loadEncryptedKey(options.encryptedKeyPath, options.password);
    }

    if (options.apiCredsPath) {
      this.loadApiCreds(options.apiCredsPath);
    }

    this.initClients();

    if (this.signer && !this._api_creds) {
      void this.deriveApiCreds();
    }
  }

  private loadEncryptedKey(filepath: string, password: string): void {
    try {
      const manager = new KeyManager();
      const pk = manager.loadAndDecrypt(password, filepath);
      this.signer = new OrderSigner(pk);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        throw new TradingBotError(`Encrypted key file not found: ${filepath}`);
      }
      if (e instanceof InvalidPasswordError) {
        throw new TradingBotError("Invalid password for encrypted key");
      }
      if (e instanceof CryptoError) {
        throw new TradingBotError(`Failed to load encrypted key: ${e}`);
      }
      throw e;
    }
  }

  private loadApiCreds(filepath: string): void {
    if (existsSync(filepath)) {
      try {
        this._api_creds = ApiCredentials.load(filepath);
      } catch (e) {
        console.warn(`Failed to load API credentials: ${e}`);
      }
    }
  }

  private async deriveApiCreds(): Promise<void> {
    if (!this.signer || !this.clob_client) return;
    try {
      this._api_creds = await this.clob_client.createOrDeriveApiKey(this.signer);
      this.clob_client.setApiCreds(this._api_creds);
    } catch (e) {
      console.warn(`Failed to derive API credentials: ${e}`);
      console.warn("Some API endpoints may not be accessible");
    }
  }

  private initClients(): void {
    this.clob_client = new ClobClient(
      this.config.clob.host,
      this.config.clob.chain_id,
      this.config.clob.signature_type,
      this.config.safe_address,
      this._api_creds,
      this.config.use_gasless ? this.config.builder : null
    );

    if (this.config.use_gasless) {
      this.relayer_client = new RelayerClient(
        this.config.relayer.host,
        this.config.clob.chain_id,
        this.config.builder,
        this.config.relayer.tx_type
      );
    }
  }

  isInitialized(): boolean {
    return Boolean(this.signer && this.config.safe_address && this.clob_client);
  }

  requireSigner(): OrderSigner {
    if (!this.signer) {
      throw new NotInitializedError("Signer not initialized. Provide private_key or encrypted_key.");
    }
    return this.signer;
  }

  async placeOrder(
    token_id: string,
    price: number,
    size: number,
    side: string,
    order_type = "GTC",
    fee_rate_bps = 0
  ): Promise<OrderResult> {
    const signer = this.requireSigner();
    if (!this.clob_client) throw new NotInitializedError("CLOB client not initialized");

    try {
      const order = new Order(
        token_id,
        price,
        size,
        side,
        this.config.safe_address,
        undefined,
        fee_rate_bps
      );
      const signed = await signer.signOrder(order);
      const response = await this.clob_client.postOrder(signed, order_type);
      return OrderResult.fromResponse(response);
    } catch (e) {
      return new OrderResult(false, null, null, String(e), {});
    }
  }

  async placeOrders(
    orders: Array<{ token_id: string; price: number; size: number; side: string }>,
    order_type = "GTC"
  ): Promise<OrderResult[]> {
    const results: OrderResult[] = [];
    for (const o of orders) {
      results.push(
        await this.placeOrder(o.token_id, o.price, o.size, o.side, order_type)
      );
      await new Promise((r) => setTimeout(r, 100));
    }
    return results;
  }

  async cancelOrder(order_id: string): Promise<OrderResult> {
    if (!this.clob_client) return new OrderResult(false, null, null, "No client", {});
    try {
      const response = await this.clob_client.cancelOrder(order_id);
      return new OrderResult(true, order_id, null, "Order cancelled", response);
    } catch (e) {
      return new OrderResult(false, order_id, null, String(e), {});
    }
  }

  async cancelAllOrders(): Promise<OrderResult> {
    if (!this.clob_client) return new OrderResult(false, null, null, "No client", {});
    try {
      const response = await this.clob_client.cancelAllOrders();
      return new OrderResult(true, null, null, "All orders cancelled", response);
    } catch (e) {
      return new OrderResult(false, null, null, String(e), {});
    }
  }

  async cancelMarketOrders(market?: string, asset_id?: string): Promise<OrderResult> {
    if (!this.clob_client) return new OrderResult(false, null, null, "No client", {});
    try {
      const response = await this.clob_client.cancelMarketOrders(market, asset_id);
      return new OrderResult(true, null, null, `Orders cancelled for market ${market ?? "all"}`, response);
    } catch (e) {
      return new OrderResult(false, null, null, String(e), {});
    }
  }

  async getOpenOrders(): Promise<Record<string, unknown>[]> {
    if (!this.clob_client) return [];
    try {
      return await this.clob_client.getOpenOrders();
    } catch {
      return [];
    }
  }

  async getOrder(order_id: string): Promise<Record<string, unknown> | null> {
    if (!this.clob_client) return null;
    try {
      return await this.clob_client.getOrder(order_id);
    } catch {
      return null;
    }
  }

  async getTrades(token_id?: string, limit = 100): Promise<Record<string, unknown>[]> {
    if (!this.clob_client) return [];
    try {
      return await this.clob_client.getTrades(token_id, limit);
    } catch {
      return [];
    }
  }

  async getOrderBook(token_id: string): Promise<Record<string, unknown>> {
    if (!this.clob_client) return {};
    try {
      return await this.clob_client.getOrderBook(token_id);
    } catch {
      return {};
    }
  }

  async getMarketPrice(token_id: string): Promise<Record<string, unknown>> {
    if (!this.clob_client) return {};
    try {
      return await this.clob_client.getMarketPrice(token_id);
    } catch {
      return {};
    }
  }

  async deploySafeIfNeeded(): Promise<boolean> {
    if (!this.config.use_gasless || !this.relayer_client) return false;
    try {
      await this.relayer_client.deploySafe(this.config.safe_address);
      return true;
    } catch {
      return false;
    }
  }

  createOrderDict(token_id: string, price: number, size: number, side: string): Record<string, unknown> {
    return {
      token_id,
      price,
      size,
      side: side.toUpperCase(),
    };
  }
}

export function createBot(
  configPath = "config.yaml",
  options: { privateKey?: string; encryptedKeyPath?: string; password?: string } = {}
): TradingBot {
  return new TradingBot({
    configPath,
    privateKey: options.privateKey,
    encryptedKeyPath: options.encryptedKeyPath,
    password: options.password,
  });
}
