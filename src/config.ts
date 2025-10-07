/**
 * Config Module - Configuration Management (YAML + POLY_* env vars)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import yaml from "js-yaml";

export const ENV_PREFIX = "POLY_";

export function getEnv(name: string, defaultVal = ""): string {
  return process.env[`${ENV_PREFIX}${name}`] ?? defaultVal;
}

export function getEnvBool(name: string, defaultVal = false): boolean {
  const v = getEnv(name, "").toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return defaultVal;
}

export function getEnvInt(name: string, defaultVal = 0): number {
  const v = getEnv(name, "");
  if (!v) return defaultVal;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : defaultVal;
}

export function getEnvFloat(name: string, defaultVal = 0): number {
  const v = getEnv(name, "");
  if (!v) return defaultVal;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : defaultVal;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class ConfigNotFoundError extends ConfigError {
  constructor(message: string) {
    super(message);
    this.name = "ConfigNotFoundError";
  }
}

export class BuilderConfig {
  api_key = "";
  api_secret = "";
  api_passphrase = "";

  isConfigured(): boolean {
    return Boolean(this.api_key && this.api_secret && this.api_passphrase);
  }
}

export class ClobConfig {
  host = "https://clob.polymarket.com";
  chain_id = 137;
  signature_type = 2;

  isValid(): boolean {
    return Boolean(this.host && this.host.startsWith("http"));
  }
}

export class RelayerConfig {
  host = "https://relayer-v2.polymarket.com";
  tx_type = "SAFE";

  isConfigured(): boolean {
    return Boolean(this.host);
  }
}

export class Config {
  safe_address = "";
  rpc_url = "https://polygon-rpc.com";
  clob: ClobConfig = new ClobConfig();
  relayer: RelayerConfig = new RelayerConfig();
  builder: BuilderConfig = new BuilderConfig();
  default_token_id = "";
  default_size = 1.0;
  default_price = 0.5;
  data_dir = "credentials";
  log_level = "INFO";
  use_gasless = false;

  constructor(init?: Partial<Config>) {
    if (init) Object.assign(this, init);
    if (this.safe_address) this.safe_address = this.safe_address.toLowerCase();
    if (this.builder.isConfigured()) this.use_gasless = true;
  }

  static load(filepath = "config.yaml"): Config {
    if (!existsSync(filepath)) throw new ConfigNotFoundError(`Config file not found: ${filepath}`);
    const data = yaml.load(readFileSync(filepath, "utf8")) as Record<string, unknown> | undefined;
    return Config.fromDict(data ?? {});
  }

  static fromDict(data: Record<string, unknown>): Config {
    const config = new Config();
    if (typeof data.safe_address === "string") config.safe_address = data.safe_address;
    if (typeof data.rpc_url === "string") config.rpc_url = data.rpc_url;

    if (data.clob && typeof data.clob === "object") {
      const c = data.clob as Record<string, unknown>;
      config.clob = new ClobConfig();
      if (typeof c.host === "string") config.clob.host = c.host;
      if (typeof c.chain_id === "number") config.clob.chain_id = c.chain_id;
      if (typeof c.signature_type === "number") config.clob.signature_type = c.signature_type;
    }

    if (data.relayer && typeof data.relayer === "object") {
      const r = data.relayer as Record<string, unknown>;
      config.relayer = new RelayerConfig();
      if (typeof r.host === "string") config.relayer.host = r.host;
      if (typeof r.tx_type === "string") config.relayer.tx_type = r.tx_type;
    }

    if (data.builder && typeof data.builder === "object") {
      const b = data.builder as Record<string, unknown>;
      config.builder = new BuilderConfig();
      if (typeof b.api_key === "string") config.builder.api_key = b.api_key;
      if (typeof b.api_secret === "string") config.builder.api_secret = b.api_secret;
      if (typeof b.api_passphrase === "string") config.builder.api_passphrase = b.api_passphrase;
    }

    if (typeof data.default_token_id === "string") config.default_token_id = data.default_token_id;
    if (typeof data.default_size === "number") config.default_size = data.default_size;
    if (typeof data.default_price === "number") config.default_price = data.default_price;
    if (typeof data.data_dir === "string") config.data_dir = data.data_dir;
    if (typeof data.log_level === "string") config.log_level = data.log_level;

    config.use_gasless = config.builder.isConfigured();
    if (config.safe_address) config.safe_address = config.safe_address.toLowerCase();
    return config;
  }

  static fromEnv(): Config {
    const config = new Config();
    const safe = getEnv("SAFE_ADDRESS");
    if (safe) config.safe_address = safe;
    const rpc = getEnv("RPC_URL");
    if (rpc) config.rpc_url = rpc;

    const apiKey = getEnv("BUILDER_API_KEY");
    const apiSecret = getEnv("BUILDER_API_SECRET");
    const apiPass = getEnv("BUILDER_API_PASSPHRASE");
    if (apiKey || apiSecret || apiPass) {
      config.builder = new BuilderConfig();
      config.builder.api_key = apiKey;
      config.builder.api_secret = apiSecret;
      config.builder.api_passphrase = apiPass;
    }

    const clobHost = getEnv("CLOB_HOST");
    const chainId = getEnvInt("CHAIN_ID", 137);
    if (clobHost) {
      config.clob = new ClobConfig();
      config.clob.host = clobHost;
      config.clob.chain_id = chainId;
    } else if (chainId !== 137) config.clob.chain_id = chainId;

    const dataDir = getEnv("DATA_DIR");
    if (dataDir) config.data_dir = dataDir;
    const logLevel = getEnv("LOG_LEVEL");
    if (logLevel) config.log_level = logLevel.toUpperCase();
    const ds = getEnvFloat("DEFAULT_SIZE");
    if (ds) config.default_size = ds;
    const dp = getEnvFloat("DEFAULT_PRICE");
    if (dp) config.default_price = dp;

    config.use_gasless = config.builder.isConfigured();
    return config;
  }

  static loadWithEnv(filepath = "config.yaml"): Config {
    const config = existsSync(filepath) ? Config.load(filepath) : new Config();

    const safe = getEnv("SAFE_ADDRESS");
    if (safe) config.safe_address = safe.toLowerCase();
    const rpc = getEnv("RPC_URL");
    if (rpc) config.rpc_url = rpc;

    const apiKey = getEnv("BUILDER_API_KEY");
    const apiSecret = getEnv("BUILDER_API_SECRET");
    const apiPass = getEnv("BUILDER_API_PASSPHRASE");
    if (apiKey) config.builder.api_key = apiKey;
    if (apiSecret) config.builder.api_secret = apiSecret;
    if (apiPass) config.builder.api_passphrase = apiPass;

    const dataDir = getEnv("DATA_DIR");
    if (dataDir) config.data_dir = dataDir;
    const logLevel = getEnv("LOG_LEVEL");
    if (logLevel) config.log_level = logLevel.toUpperCase();

    config.use_gasless = config.builder.isConfigured();
    return config;
  }

  save(filepath = "config.yaml"): void {
    const dir = dirname(filepath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(filepath, yaml.dump(this.toDict(), { lineWidth: 120 }), "utf8");
  }

  toDict(): Record<string, unknown> {
    return {
      safe_address: this.safe_address,
      rpc_url: this.rpc_url,
      clob: { ...this.clob },
      relayer: { ...this.relayer },
      builder: { ...this.builder },
      default_token_id: this.default_token_id,
      default_size: this.default_size,
      default_price: this.default_price,
      data_dir: this.data_dir,
      log_level: this.log_level,
    };
  }

  validate(): string[] {
    const errors: string[] = [];
    if (!this.safe_address) errors.push("safe_address is required");
    if (!this.rpc_url) errors.push("rpc_url is required");
    if (!this.clob.isValid()) errors.push("clob configuration is invalid");
    if (this.use_gasless && !this.builder.isConfigured()) {
      errors.push("gasless mode enabled but builder credentials not configured");
    }
    return errors;
  }

  getCredentialPath(name: string): string {
    return `${this.data_dir}/${name}`;
  }

  getEncryptedKeyPath(): string {
    return this.getCredentialPath("encrypted_key.json");
  }

  getApiCredsPath(): string {
    return this.getCredentialPath("api_creds.json");
  }
}
