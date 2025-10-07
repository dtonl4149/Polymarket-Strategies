/**
 * Crypto Module - Secure Private Key Storage
 * PBKDF2 + Fernet-compatible token format (matches Python cryptography.fernet).
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

export class InvalidPasswordError extends CryptoError {
  constructor(message = "Invalid password or corrupted data") {
    super(message);
    this.name = "InvalidPasswordError";
  }
}

const PBKDF2_ITERATIONS = 480_000;
const SALT_SIZE = 16;

function urlSafeB64Encode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function urlSafeB64Decode(s: string): Buffer {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  return Buffer.from(b64, "base64");
}

/** Derive 32-byte Fernet key from password + salt (matches Python KeyManager._derive_key). */
function deriveKeyBytes(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256");
}

/** Fernet signing / encryption key split (Fernet spec). */
function splitFernetKey(key32: Buffer): { signingKey: Buffer; encryptionKey: Buffer } {
  return { signingKey: key32.subarray(0, 16), encryptionKey: key32.subarray(16, 32) };
}

/** Fernet encrypt (version 128, 8-byte timestamp, 16-byte IV, AES-128-CBC, HMAC-SHA256). */
function fernetEncrypt(plaintext: Buffer, key32: Buffer): Buffer {
  const { signingKey, encryptionKey } = splitFernetKey(key32);
  const iv = randomBytes(16);
  const ts = Math.floor(Date.now() / 1000);
  const tsBuf = Buffer.allocUnsafe(8);
  tsBuf.writeBigUInt64BE(BigInt(ts), 0);

  const cipher = createCipheriv("aes-128-cbc", encryptionKey, iv);
  const padded = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  const header = Buffer.concat([Buffer.from([0x80]), tsBuf, iv, padded]);
  const h = createHmac("sha256", signingKey);
  h.update(header);
  const mac = h.digest();
  const token = Buffer.concat([header, mac]);
  return Buffer.from(urlSafeB64Encode(token), "ascii");
}

function fernetDecrypt(tokenB64: string, key32: Buffer): Buffer {
  const { signingKey, encryptionKey } = splitFernetKey(key32);
  const raw = urlSafeB64Decode(tokenB64);
  if (raw.length < 57) throw new InvalidPasswordError();

  const hmacSig = raw.subarray(raw.length - 32);
  const payload = raw.subarray(0, raw.length - 32);

  const h = createHmac("sha256", signingKey);
  h.update(payload);
  const expected = h.digest();
  if (!timingSafeEqual(hmacSig, expected)) throw new InvalidPasswordError();

  if (payload[0] !== 0x80) throw new InvalidPasswordError();

  const iv = payload.subarray(9, 25);
  const ciphertext = payload.subarray(25);

  const decipher = createDecipheriv("aes-128-cbc", encryptionKey, iv);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new InvalidPasswordError();
  }
}

export interface EncryptedKeyFile {
  version: number;
  salt: string;
  encrypted: string;
  key_length: number;
}

export class KeyManager {
  salt: Buffer = randomBytes(SALT_SIZE);

  /** Same material as Python Fernet after decoding POLY url-safe key wrapper: PBKDF2 → 32 bytes. */
  private fernetKeyFromPassword(password: string): Buffer {
    return deriveKeyBytes(password, this.salt);
  }

  encrypt(privateKey: string, password: string): EncryptedKeyFile {
    if (!privateKey) throw new Error("Private key cannot be empty");
    if (!password || password.length < 8) throw new Error("Password must be at least 8 characters");

    let key = privateKey.trim().toLowerCase();
    if (key.startsWith("0x")) key = key.slice(2);
    try {
      BigInt("0x" + key);
    } catch {
      throw new Error("Invalid private key format");
    }
    if (key.length !== 64) throw new Error("Invalid private key format");

    const keyBytes = this.fernetKeyFromPassword(password);
    const encBuf = fernetEncrypt(Buffer.from(key, "utf8"), keyBytes);
    const encryptedB64 = encBuf.toString("ascii");

    return {
      version: 1,
      salt: urlSafeB64Encode(this.salt),
      encrypted: encryptedB64,
      key_length: key.length,
    };
  }

  decrypt(encryptedData: EncryptedKeyFile, password: string): string {
    try {
      this.salt = urlSafeB64Decode(encryptedData.salt);
      const keyBytes = this.fernetKeyFromPassword(password);
      const decrypted = fernetDecrypt(encryptedData.encrypted, keyBytes);
      const k = decrypted.toString("utf8");
      return `0x${k}`;
    } catch (e) {
      if (e instanceof InvalidPasswordError) throw e;
      throw new InvalidPasswordError(String(e));
    }
  }

  encryptAndSave(privateKey: string, password: string, filepath: string): string {
    const encryptedData = this.encrypt(privateKey, password);
    const dir = dirname(filepath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(filepath, JSON.stringify(encryptedData, null, 2), "utf8");
    try {
      chmodSync(filepath, 0o600);
    } catch {
      /* windows may ignore */
    }
    return filepath;
  }

  loadAndDecrypt(password: string, filepath: string): string {
    if (!existsSync(filepath)) throw new Error(`Encrypted key file not found: ${filepath}`);
    const raw = readFileSync(filepath, "utf8");
    const encryptedData = JSON.parse(raw) as EncryptedKeyFile;
    return this.decrypt(encryptedData, password);
  }

  generateNewSalt(): void {
    this.salt = randomBytes(SALT_SIZE);
  }
}

export function verifyPrivateKey(privateKey: string): [boolean, string] {
  let key = privateKey.trim().toLowerCase();
  if (key.startsWith("0x")) key = key.slice(2);
  if (key.length !== 64) return [false, "Key must be 64 hex characters"];
  try {
    BigInt("0x" + key);
  } catch {
    return [false, "Key contains invalid characters"];
  }
  return [true, `0x${key}`];
}

export function generateRandomPrivateKey(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

export const KeyStore = KeyManager;
