/**
 * Encrypted file-based credential storage.
 *
 * Stores credentials in an AES-256-GCM encrypted JSON file on disk.
 * Master key is resolved from: NATHAN_MASTER_KEY env var → OS keychain → auto-generate.
 *
 * File format: { version: 1, credentials: { [service]: StoredCredential } }
 * Encryption format: [12B iv][16B tag][ciphertext]
 */

import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { keychainGet, keychainSet, isKeychainAvailable } from "./keychain.js";

export interface StoredCredential {
  service: string;
  type: string;
  fields: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialStore {
  /** Store a credential for a service. */
  set(service: string, credential: Omit<StoredCredential, "service" | "createdAt" | "updatedAt">): Promise<void>;
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

  // 1. Environment variable — accepts any string, derives a 32-byte key via SHA-256
  const envKey = process.env.NATHAN_MASTER_KEY;
  if (envKey) {
    const buf = createHash("sha256").update(envKey).digest();
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

  // 4. No keychain available and no env var
  throw new Error(
    "No master key available. Set NATHAN_MASTER_KEY env var (hex, 32 bytes):\n" +
    "  export NATHAN_MASTER_KEY=$(openssl rand -hex 32)\n" +
    "Or install a system keyring (macOS Keychain / Linux libsecret).",
  );
}

/** Clear the cached master key (for testing). */
export function clearMasterKeyCache(): void {
  cachedMasterKey = null;
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
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
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
// n8n credential type introspection
// ---------------------------------------------------------------------------

export interface CredentialTypeField {
  name: string;
  displayName: string;
  type: string;
  default?: unknown;
  isPassword: boolean;
  required: boolean;
  description?: string;
}

export interface CredentialTypeDefinition {
  name: string;
  displayName: string;
  properties: CredentialTypeField[];
  authenticate: unknown;
  test: unknown;
}

/**
 * Dynamically load an n8n credential type definition.
 *
 * Example: "githubApi" → loads GithubApi.credentials.js → returns properties, authenticate, test.
 */
export function loadCredentialTypeDefinition(credTypeName: string): CredentialTypeDefinition | null {
  try {
    const pascalName = credTypeName.charAt(0).toUpperCase() + credTypeName.slice(1);
    const mod = require(`n8n-nodes-base/dist/credentials/${pascalName}.credentials.js`);
    const CredClass = mod[pascalName] ?? mod.default ?? Object.values(mod)[0];
    if (!CredClass || typeof CredClass !== "function") return null;

    const instance = new (CredClass as new () => Record<string, unknown>)();
    const properties: CredentialTypeField[] = ((instance.properties ?? []) as Array<Record<string, unknown>>).map((p) => {
      const isPassword = (p.typeOptions as Record<string, unknown> | undefined)?.password === true;
      const hasEmptyDefault = p.default === "" || p.default === undefined;
      return {
        name: String(p.name ?? ""),
        displayName: String(p.displayName ?? p.name ?? ""),
        type: String(p.type ?? "string"),
        default: p.default,
        isPassword,
        // Required if explicitly marked, or if it's a password field with no default
        required: p.required === true || (isPassword && hasEmptyDefault),
        description: p.description as string | undefined,
      };
    });

    return {
      name: String(instance.name ?? credTypeName),
      displayName: String(instance.displayName ?? credTypeName),
      properties,
      authenticate: instance.authenticate ?? null,
      test: instance.test ?? null,
    };
  } catch {
    return null;
  }
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
