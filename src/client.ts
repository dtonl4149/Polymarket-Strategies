/**
 * Client Module - CLOB + Relayer HTTP clients
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import type { BuilderConfig } from "./config.js";
import { ThreadLocalSessionMixin } from "./http.js";
import type { OrderSigner } from "./signer.js";

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export class AuthenticationError extends ApiError {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class OrderError extends ApiError {
  constructor(message: string) {
    super(message);
    this.name = "OrderError";
  }
}

export class ApiCredentials {
  constructor(
    public api_key: string,
    public secret: string,
    public passphrase: string
  ) {}

  static load(filepath: string): ApiCredentials {
    const data = JSON.parse(readFileSync(filepath, "utf8")) as Record<string, string>;
    return new ApiCredentials(
      data.apiKey ?? "",
      data.secret ?? "",
      data.passphrase ?? ""
    );
  }

  isValid(): boolean {
    return Boolean(this.api_key && this.secret && this.passphrase);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class ApiClient extends ThreadLocalSessionMixin {
  base_url: string;
  timeout: number;
  retry_count: number;

  constructor(base_url: string, timeout = 30, retry_count = 3) {
    super();
    this.base_url = base_url.replace(/\/+$/, "");
    this.timeout = timeout;
    this.retry_count = retry_count;
  }

  async _request(
    method: string,
    endpoint: string,
    data?: unknown,
    headers?: Record<string, string>,
    params?: Record<string, string | number | undefined>
  ): Promise<Record<string, unknown> | unknown[]> {
    const url = new URL(`${this.base_url}/${endpoint.replace(/^\/+/, "")}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...headers,
    };

    let lastError: unknown;
    for (let attempt = 0; attempt < this.retry_count; attempt++) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), this.timeout * 1000);
      try {
        const init: RequestInit = {
          method: method.toUpperCase(),
          headers: requestHeaders,
          signal: controller.signal,
        };
        if (method.toUpperCase() === "POST" || method.toUpperCase() === "DELETE") {
          if (data !== undefined && data !== null) {
            init.body = typeof data === "string" ? data : JSON.stringify(data);
          }
        }
        const res = await fetch(url, init);
        clearTimeout(t);
        if (!res.ok) {
          const text = await res.text();
          throw new ApiError(`HTTP ${res.status}: ${text}`);
        }
        const text = await res.text();
        if (!text) return {};
        return JSON.parse(text) as Record<string, unknown>;
      } catch (e) {
        clearTimeout(t);
        lastError = e;
        if (attempt < this.retry_count - 1) await sleep(2 ** attempt * 1000);
      }
    }
    throw new ApiError(`Request failed after ${this.retry_count} attempts: ${lastError}`);
  }
}

export class ClobClient extends ApiClient {
  host: string;
  chain_id: number;
  signature_type: number;
  funder: string;
  api_creds: ApiCredentials | null;
  builder_creds: BuilderConfig | null;

  constructor(
    host = "https://clob.polymarket.com",
    chain_id = 137,
    signature_type = 2,
    funder = "",
    api_creds: ApiCredentials | null = null,
    builder_creds: BuilderConfig | null = null,
    timeout = 30
  ) {
    super(host, timeout);
    this.host = host;
    this.chain_id = chain_id;
    this.signature_type = signature_type;
    this.funder = funder;
    this.api_creds = api_creds;
    this.builder_creds = builder_creds;
  }

  _buildHeaders(method: string, path: string, body = ""): Record<string, string> {
    const headers: Record<string, string> = {};

    if (this.builder_creds?.isConfigured()) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const message = `${timestamp}${method}${path}${body}`;
      const signature = createHmac("sha256", this.builder_creds.api_secret)
        .update(message)
        .digest("hex");
      headers.POLY_BUILDER_API_KEY = this.builder_creds.api_key;
      headers.POLY_BUILDER_TIMESTAMP = timestamp;
      headers.POLY_BUILDER_PASSPHRASE = this.builder_creds.api_passphrase;
      headers.POLY_BUILDER_SIGNATURE = signature;
    }

    if (this.api_creds?.isValid()) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      let message = `${timestamp}${method}${path}`;
      if (body) message += body;

      let signature: string;
      try {
        const buf = Buffer.from(
          this.api_creds.secret.replace(/-/g, "+").replace(/_/g, "/"),
          "base64"
        );
        signature = Buffer.from(
          createHmac("sha256", buf).update(message, "utf8").digest()
        )
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
      } catch {
        signature = createHmac("sha256", this.api_creds.secret)
          .update(message)
          .digest("hex");
      }

      headers.POLY_ADDRESS = this.funder;
      headers.POLY_API_KEY = this.api_creds.api_key;
      headers.POLY_TIMESTAMP = timestamp;
      headers.POLY_PASSPHRASE = this.api_creds.passphrase;
      headers.POLY_SIGNATURE = signature;
    }

    return headers;
  }

  async deriveApiKey(signer: OrderSigner, nonce = 0): Promise<ApiCredentials> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const authSignature = await signer.signAuthMessage(timestamp, nonce);
    const headers: Record<string, string> = {
      POLY_ADDRESS: signer.address,
      POLY_SIGNATURE: authSignature,
      POLY_TIMESTAMP: timestamp,
      POLY_NONCE: String(nonce),
    };
    const response = (await this._request("GET", "/auth/derive-api-key", undefined, headers)) as Record<
      string,
      unknown
    >;
    return new ApiCredentials(
      String(response.apiKey ?? ""),
      String(response.secret ?? ""),
      String(response.passphrase ?? "")
    );
  }

  async createApiKey(signer: OrderSigner, nonce = 0): Promise<ApiCredentials> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const authSignature = await signer.signAuthMessage(timestamp, nonce);
    const headers: Record<string, string> = {
      POLY_ADDRESS: signer.address,
      POLY_SIGNATURE: authSignature,
      POLY_TIMESTAMP: timestamp,
      POLY_NONCE: String(nonce),
    };
    const response = (await this._request("POST", "/auth/api-key", undefined, headers)) as Record<
      string,
      unknown
    >;
    return new ApiCredentials(
      String(response.apiKey ?? ""),
      String(response.secret ?? ""),
      String(response.passphrase ?? "")
    );
  }

  async createOrDeriveApiKey(signer: OrderSigner, nonce = 0): Promise<ApiCredentials> {
    try {
      return await this.createApiKey(signer, nonce);
    } catch {
      return await this.deriveApiKey(signer, nonce);
    }
  }

  setApiCreds(creds: ApiCredentials): void {
    this.api_creds = creds;
  }

  async getOrderBook(token_id: string): Promise<Record<string, unknown>> {
    return (await this._request("GET", "/book", undefined, undefined, { token_id })) as Record<
      string,
      unknown
    >;
  }

  async getMarketPrice(token_id: string): Promise<Record<string, unknown>> {
    return (await this._request("GET", "/price", undefined, undefined, { token_id })) as Record<
      string,
      unknown
    >;
  }

  async getOpenOrders(): Promise<Record<string, unknown>[]> {
    const endpoint = "/data/orders";
    const headers = this._buildHeaders("GET", endpoint);
    const result = await this._request("GET", endpoint, undefined, headers);
    if (result && typeof result === "object" && !Array.isArray(result) && "data" in result) {
      const d = (result as Record<string, unknown>).data;
      return Array.isArray(d) ? (d as Record<string, unknown>[]) : [];
    }
    return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
  }

  async getOrder(order_id: string): Promise<Record<string, unknown>> {
    const endpoint = `/data/order/${order_id}`;
    const headers = this._buildHeaders("GET", endpoint);
    return (await this._request("GET", endpoint, undefined, headers)) as Record<string, unknown>;
  }

  async getTrades(token_id?: string, limit = 100): Promise<Record<string, unknown>[]> {
    const endpoint = "/data/trades";
    const headers = this._buildHeaders("GET", endpoint);
    const params: Record<string, string | number> = { limit };
    if (token_id) params.token_id = token_id;
    const result = await this._request("GET", endpoint, undefined, headers, params);
    if (result && typeof result === "object" && !Array.isArray(result) && "data" in result) {
      const d = (result as Record<string, unknown>).data;
      return Array.isArray(d) ? (d as Record<string, unknown>[]) : [];
    }
    return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
  }

  async postOrder(signed_order: Record<string, unknown>, order_type = "GTC"): Promise<Record<string, unknown>> {
    const endpoint = "/order";
    const body: Record<string, unknown> = {
      order: signed_order.order ?? signed_order,
      owner: this.funder,
      orderType: order_type,
    };
    if (signed_order.signature) body.signature = signed_order.signature;
    const bodyJson = JSON.stringify(body);
    const headers = this._buildHeaders("POST", endpoint, bodyJson);
    return (await this._request("POST", endpoint, body, headers)) as Record<string, unknown>;
  }

  async cancelOrder(order_id: string): Promise<Record<string, unknown>> {
    const endpoint = "/order";
    const body = { orderID: order_id };
    const bodyJson = JSON.stringify(body);
    const headers = this._buildHeaders("DELETE", endpoint, bodyJson);
    return (await this._request("DELETE", endpoint, body, headers)) as Record<string, unknown>;
  }

  async cancelOrders(order_ids: string[]): Promise<Record<string, unknown>> {
    const endpoint = "/orders";
    const bodyJson = JSON.stringify(order_ids);
    const headers = this._buildHeaders("DELETE", endpoint, bodyJson);
    return (await this._request("DELETE", endpoint, order_ids, headers)) as Record<string, unknown>;
  }

  async cancelAllOrders(): Promise<Record<string, unknown>> {
    const endpoint = "/cancel-all";
    const headers = this._buildHeaders("DELETE", endpoint);
    return (await this._request("DELETE", endpoint, undefined, headers)) as Record<string, unknown>;
  }

  async cancelMarketOrders(market?: string, asset_id?: string): Promise<Record<string, unknown>> {
    const endpoint = "/cancel-market-orders";
    const body: Record<string, string> = {};
    if (market) body.market = market;
    if (asset_id) body.asset_id = asset_id;
    const bodyJson = Object.keys(body).length ? JSON.stringify(body) : "";
    const headers = this._buildHeaders("DELETE", endpoint, bodyJson);
    return (await this._request("DELETE", endpoint, Object.keys(body).length ? body : undefined, headers)) as Record<
      string,
      unknown
    >;
  }
}

export class RelayerClient extends ApiClient {
  chain_id: number;
  builder_creds: BuilderConfig | null;
  tx_type: string;

  constructor(
    host = "https://relayer-v2.polymarket.com",
    chain_id = 137,
    builder_creds: BuilderConfig | null = null,
    tx_type = "SAFE",
    timeout = 60
  ) {
    super(host, timeout);
    this.chain_id = chain_id;
    this.builder_creds = builder_creds;
    this.tx_type = tx_type;
  }

  _buildHeaders(method: string, path: string, body = ""): Record<string, string> {
    if (!this.builder_creds?.isConfigured()) {
      throw new AuthenticationError("Builder credentials required for relayer");
    }
    const timestamp = String(Math.floor(Date.now() / 1000));
    const message = `${timestamp}${method}${path}${body}`;
    const signature = createHmac("sha256", this.builder_creds.api_secret)
      .update(message)
      .digest("hex");
    return {
      POLY_BUILDER_API_KEY: this.builder_creds.api_key,
      POLY_BUILDER_TIMESTAMP: timestamp,
      POLY_BUILDER_PASSPHRASE: this.builder_creds.api_passphrase,
      POLY_BUILDER_SIGNATURE: signature,
    };
  }

  async deploySafe(safe_address: string): Promise<Record<string, unknown>> {
    const endpoint = "/deploy";
    const body = { safeAddress: safe_address };
    const bodyJson = JSON.stringify(body);
    const headers = this._buildHeaders("POST", endpoint, bodyJson);
    return (await this._request("POST", endpoint, body, headers)) as Record<string, unknown>;
  }

  async approveUsdc(safe_address: string, spender: string, amount: number): Promise<Record<string, unknown>> {
    const endpoint = "/approve-usdc";
    const body = {
      safeAddress: safe_address,
      spender,
      amount: String(amount),
    };
    const bodyJson = JSON.stringify(body);
    const headers = this._buildHeaders("POST", endpoint, bodyJson);
    return (await this._request("POST", endpoint, body, headers)) as Record<string, unknown>;
  }

  async approveToken(
    safe_address: string,
    token_id: string,
    spender: string,
    amount: number
  ): Promise<Record<string, unknown>> {
    const endpoint = "/approve-token";
    const body = {
      safeAddress: safe_address,
      tokenId: token_id,
      spender,
      amount: String(amount),
    };
    const bodyJson = JSON.stringify(body);
    const headers = this._buildHeaders("POST", endpoint, bodyJson);
    return (await this._request("POST", endpoint, body, headers)) as Record<string, unknown>;
  }
}
