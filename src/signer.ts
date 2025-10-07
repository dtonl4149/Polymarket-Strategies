/**
 * Signer Module - EIP-712 Order Signing (matches Python eth_account flow)
 */

import { getAddress, Wallet } from "ethers";
import type { TypedDataDomain, TypedDataField } from "ethers";

import { KeyManager, InvalidPasswordError } from "./crypto.js";
import type { EncryptedKeyFile } from "./crypto.js";

export const USDC_DECIMALS = 6;

export class SignerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignerError";
  }
}

export class Order {
  token_id: string;
  price: number;
  size: number;
  side: string;
  maker: string;
  nonce: number;
  fee_rate_bps: number;
  signature_type: number;
  maker_amount!: string;
  taker_amount!: string;
  side_value!: number;

  constructor(
    token_id: string,
    price: number,
    size: number,
    side: string,
    maker: string,
    nonce?: number,
    fee_rate_bps = 0,
    signature_type = 2
  ) {
    this.token_id = token_id;
    this.price = price;
    this.size = size;
    this.side = side.toUpperCase();
    this.maker = maker;
    this.fee_rate_bps = fee_rate_bps;
    this.signature_type = signature_type;

    if (this.side !== "BUY" && this.side !== "SELL") {
      throw new Error(`Invalid side: ${side}`);
    }
    if (!(this.price > 0 && this.price <= 1)) {
      throw new Error(`Invalid price: ${this.price}`);
    }
    if (this.size <= 0) throw new Error(`Invalid size: ${this.size}`);

    this.nonce = nonce ?? Math.floor(Date.now() / 1000);

    const usdc = 10 ** USDC_DECIMALS;
    this.maker_amount = String(Math.floor(this.size * this.price * usdc));
    this.taker_amount = String(Math.floor(this.size * usdc));
    this.side_value = this.side === "BUY" ? 0 : 1;
  }
}

const DOMAIN: TypedDataDomain = {
  name: "ClobAuthDomain",
  version: "1",
  chainId: 137n,
};

const ORDER_TYPES: Record<string, TypedDataField[]> = {
  Order: [
    { name: "salt", type: "uint256" },
    { name: "maker", type: "address" },
    { name: "signer", type: "address" },
    { name: "taker", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "makerAmount", type: "uint256" },
    { name: "takerAmount", type: "uint256" },
    { name: "expiration", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "feeRateBps", type: "uint256" },
    { name: "side", type: "uint8" },
    { name: "signatureType", type: "uint8" },
  ],
};

const AUTH_TYPES: Record<string, TypedDataField[]> = {
  ClobAuth: [
    { name: "address", type: "address" },
    { name: "timestamp", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "message", type: "string" },
  ],
};

export class OrderSigner {
  readonly wallet: Wallet;
  readonly address: string;

  static readonly DOMAIN = DOMAIN;
  static readonly ORDER_TYPES = ORDER_TYPES;

  constructor(privateKey: string) {
    let pk = privateKey.trim();
    if (pk.startsWith("0x")) pk = pk.slice(2);
    try {
      this.wallet = new Wallet("0x" + pk);
    } catch (e) {
      throw new Error(`Invalid private key: ${e}`);
    }
    this.address = this.wallet.address;
  }

  static fromEncrypted(encryptedData: EncryptedKeyFile, password: string): OrderSigner {
    const manager = new KeyManager();
    try {
      const privateKey = manager.decrypt(encryptedData, password);
      return new OrderSigner(privateKey);
    } catch (e) {
      if (e instanceof InvalidPasswordError) throw e;
      throw e;
    }
  }

  async signAuthMessage(timestamp?: string, nonce = 0): Promise<string> {
    const ts = timestamp ?? String(Math.floor(Date.now() / 1000));
    const value = {
      address: this.address,
      timestamp: ts,
      nonce: BigInt(nonce),
      message: "This message attests that I control the given wallet",
    };
    return this.wallet.signTypedData(DOMAIN, AUTH_TYPES, value);
  }

  async signOrder(order: Order): Promise<Record<string, unknown>> {
    try {
      const maker = getAddress(order.maker);
      const orderMessage = {
        salt: 0n,
        maker,
        signer: this.address,
        taker: "0x0000000000000000000000000000000000000000",
        tokenId: BigInt(order.token_id),
        makerAmount: BigInt(order.maker_amount),
        takerAmount: BigInt(order.taker_amount),
        expiration: 0n,
        nonce: BigInt(order.nonce),
        feeRateBps: BigInt(order.fee_rate_bps),
        side: order.side_value,
        signatureType: order.signature_type,
      };

      const sig = await this.wallet.signTypedData(DOMAIN, ORDER_TYPES, orderMessage);

      return {
        order: {
          tokenId: order.token_id,
          price: order.price,
          size: order.size,
          side: order.side,
          maker: order.maker,
          nonce: order.nonce,
          feeRateBps: order.fee_rate_bps,
          signatureType: order.signature_type,
        },
        signature: sig,
        signer: this.address,
      };
    } catch (e) {
      throw new SignerError(`Failed to sign order: ${e}`);
    }
  }

  async signOrderDict(
    token_id: string,
    price: number,
    size: number,
    side: string,
    maker: string,
    nonce?: number,
    fee_rate_bps = 0
  ): Promise<Record<string, unknown>> {
    const order = new Order(token_id, price, size, side, maker, nonce, fee_rate_bps);
    return this.signOrder(order);
  }
}

export const WalletSigner = OrderSigner;
