/**
 * Encrypted file-based credential storage.
 *
 * Stores credentials in an AES-256-GCM encrypted JSON file on disk.
 * Master key is resolved from: NATHAN_MASTER_KEY env var → OS keychain → auto-generate.
 *
 * File format: { version: 1, credentials: { [service]: StoredCredential } }
 * Encryption format: [12B iv][16B tag][ciphertext]
 */

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { keychainGet, keychainSet, isKeychainAvailable } from "./keychain.js";

/** Type predicate for Node.js filesystem errors with an error code. */
function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

export interface StoredCredential {
  service: string;
  type: string;
  fields: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

/** Input for storing a new credential. */
export interface CredentialInput {
  type: string;
  fields: Record<string, string>;
}

export interface CredentialStore {
  /** Store a credential for a service. */
  set(service: string, credential: CredentialInput): Promise<void>;
  /** Retrieve a credential for a service. */
  get(service: string): Promise<StoredCredential | null>;
  /** List all stored service names. */
  list(): Promise<StoredCredential[]>;
  /** Remove a credential for a service. */
  remove(service: string): Promise<boolean>;
  /** Test if a credential exists for a service. */
  has(service: string): Promise<boolean>;
}

interface StoreFile {
  version: 1;
  credentials: Record<string, StoredCredential>;
}

// ---------------------------------------------------------------------------
// Master key management
// ---------------------------------------------------------------------------

const KEYCHAIN_SERVICE = "master-key";
const KEYCHAIN_ACCOUNT = "default";
const KEY_LENGTH = 32; // AES-256

let cachedMasterKey: Buffer | null = null;

/**
 * Resolve the master encryption key.
 *
 * Resolution order:
 * 1. NATHAN_MASTER_KEY env var (hex-encoded 32 bytes)
 * 2. OS keychain
 * 3. Auto-generate and store in OS keychain
 * 4. Error with setup instructions
 */
async function resolveMasterKey(): Promise<Buffer> {
  if (cachedMasterKey) return cachedMasterKey;

  // 1. Environment variable — accepts any string, derives a 32-byte key via scrypt
  //    (resistant to brute-force on low-entropy passphrases, unlike bare SHA-256)
  const envKey = process.env.NATHAN_MASTER_KEY;
  if (envKey) {
    const buf = scryptSync(envKey, "nathan-master-key-v1", KEY_LENGTH, { N: 16384, r: 8, p: 1 });
    cachedMasterKey = buf;
    return buf;
  }

  // 2. OS keychain
  const keychainAvailable = await isKeychainAvailable();
  if (keychainAvailable) {
    const stored = await keychainGet(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    if (stored) {
      const buf = Buffer.from(stored, "hex");
      if (buf.length === KEY_LENGTH) {
        cachedMasterKey = buf;
        return buf;
      }
    }

    // 3. Auto-generate and store
    const newKey = randomBytes(KEY_LENGTH);
    await keychainSet(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, newKey.toString("hex"));
    cachedMasterKey = newKey;
    return newKey;
  }

  // 4. File-based fallback (~/.nathan/master.key) — auto-generate if missing
  const keyFilePath = join(homedir(), ".nathan", "master.key");
  try {
    const hex = await readFile(keyFilePath, "utf-8");
    const buf = Buffer.from(hex.trim(), "hex");
    if (buf.length === KEY_LENGTH) {
      cachedMasterKey = buf;
      return buf;
    }
    // File exists but has invalid content — do NOT silently overwrite
    throw new Error(
      `Master key file ${keyFilePath} exists but contains invalid data (expected ${KEY_LENGTH * 2} hex chars). ` +
      "Delete it manually to auto-generate a new key (this will make existing credentials unreadable).",
    );
  } catch (err: unknown) {
    // File not found — generate a new one
    if (isErrnoException(err) && err.code === "ENOENT") {
      const newKey = randomBytes(KEY_LENGTH);
      await mkdir(dirname(keyFilePath), { recursive: true });
      await writeFile(keyFilePath, newKey.toString("hex") + "\n", { mode: 0o600 });
      cachedMasterKey = newKey;
      return newKey;
    }
    // Re-throw all other errors (permission issues, corrupted file, etc.)
    throw err;
  }
}

/** Clear the cached master key (for testing). Zeros memory before nullifying. */
export function clearMasterKeyCache(): void {
  if (cachedMasterKey) {
    cachedMasterKey.fill(0);
    cachedMasterKey = null;
  }
}

// ---------------------------------------------------------------------------
// AES-256-GCM encryption
// ---------------------------------------------------------------------------

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function encrypt(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: [12B iv][16B tag][ciphertext]
  return Buffer.concat([iv, tag, encrypted]);
}

function decrypt(data: Buffer, key: Buffer): string {
  if (data.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Encrypted data too short");
  }
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final("utf-8");
}

// ---------------------------------------------------------------------------
// File I/O with atomic writes
// ---------------------------------------------------------------------------

async function readStore(storePath: string, key: Buffer): Promise<StoreFile> {
  let raw: Buffer;
  try {
    raw = await readFile(storePath);
  } catch (err: unknown) {
    if (isErrnoException(err) && err.code === "ENOENT") {
      return { version: 1, credentials: {} };
    }
    throw err;
  }
  try {
    const json = decrypt(raw, key);
    return JSON.parse(json) as StoreFile;
  } catch {
    throw new Error(
      "Failed to decrypt credential store. Wrong master key?\n" +
      "If you changed NATHAN_MASTER_KEY, delete ~/.nathan/credentials.enc and re-add credentials.",
    );
  }
}

async function writeStore(storePath: string, key: Buffer, store: StoreFile): Promise<void> {
  const json = JSON.stringify(store);
  const encrypted = encrypt(json, key);
  const dir = dirname(storePath);
  await mkdir(dir, { recursive: true });
  const tmpPath = `${storePath}.tmp`;
  await writeFile(tmpPath, encrypted, { mode: 0o600 });
  await rename(tmpPath, storePath);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const DEFAULT_STORE_PATH = join(homedir(), ".nathan", "credentials.enc");

/**
 * Create a file-based encrypted credential store.
 */
export function createCredentialStore(storePath?: string): CredentialStore {
  const path = storePath ?? DEFAULT_STORE_PATH;

  return {
    async set(service, credential) {
      const key = await resolveMasterKey();
      const store = await readStore(path, key);
      const now = new Date().toISOString();
      const existing = store.credentials[service];
      store.credentials[service] = {
        service,
        type: credential.type,
        fields: credential.fields,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await writeStore(path, key, store);
    },

    async get(service) {
      const key = await resolveMasterKey();
      const store = await readStore(path, key);
      return store.credentials[service] ?? null;
    },

    async list() {
      const key = await resolveMasterKey();
      const store = await readStore(path, key);
      return Object.values(store.credentials);
    },

    async remove(service) {
      const key = await resolveMasterKey();
      const store = await readStore(path, key);
      if (!(service in store.credentials)) return false;
      delete store.credentials[service];
      await writeStore(path, key, store);
      return true;
    },

    async has(service) {
      const key = await resolveMasterKey();
      const store = await readStore(path, key);
      return service in store.credentials;
    },
  };
}
