// Application-layer encryption for secrets stored in the database
// (currently provider API keys). Without this, anyone with read access to
// Postgres — a DB dump, a backup, a stray SQL injection elsewhere — recovers
// every live API key in cleartext. We encrypt at rest with AES-256-GCM and
// decrypt only at the point of use.
//
// Key resolution (first match wins):
//   1. RECALLMEM_ENCRYPTION_KEY env var — 32 bytes as base64 or hex.
//   2. A key file persisted in the install dir (auto-generated on first use,
//      chmod 0600). This keeps the local-first app zero-config: existing
//      installs start encrypting new writes automatically.
//
// Backward compatibility: decryptSecret() returns any value that is NOT in
// our ciphertext envelope unchanged, so pre-existing plaintext rows keep
// working and get re-encrypted the next time they're written.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ALGO = "aes-256-gcm";
const ENVELOPE_PREFIX = "enc:v1:"; // marks an encrypted value
const IV_BYTES = 12;
const TAG_BYTES = 16;

let _key: Buffer | null = null;

function installDir(): string {
  const home =
    process.env.RECALLMEM_HOME ||
    path.join(process.env.HOME || process.env.USERPROFILE || ".", ".recallmem");
  // If ~/.recallmem exists (npx install), use it; otherwise use cwd (dev).
  if (fs.existsSync(path.join(home, "package.json"))) return home;
  return process.cwd();
}

function keyFilePath(): string {
  return path.join(installDir(), ".recallmem-secret.key");
}

function parseEnvKey(raw: string): Buffer | null {
  const trimmed = raw.trim();
  // hex (64 chars) or base64
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  try {
    const buf = Buffer.from(trimmed, "base64");
    if (buf.length === 32) return buf;
  } catch {
    /* fall through */
  }
  return null;
}

function loadOrCreateKeyFile(): Buffer {
  const file = keyFilePath();
  try {
    if (fs.existsSync(file)) {
      const stored = fs.readFileSync(file, "utf-8").trim();
      const buf = Buffer.from(stored, "base64");
      if (buf.length === 32) return buf;
    }
  } catch {
    /* regenerate below */
  }
  const generated = crypto.randomBytes(32);
  try {
    fs.writeFileSync(file, generated.toString("base64"), { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  } catch (err) {
    throw new Error(
      `Could not persist encryption key at ${file}: ${err instanceof Error ? err.message : String(err)}. ` +
        "Set RECALLMEM_ENCRYPTION_KEY instead."
    );
  }
  return generated;
}

function getKey(): Buffer {
  if (_key) return _key;
  const envKey = process.env.RECALLMEM_ENCRYPTION_KEY;
  if (envKey) {
    const parsed = parseEnvKey(envKey);
    if (!parsed) {
      throw new Error(
        "RECALLMEM_ENCRYPTION_KEY must be 32 bytes encoded as hex (64 chars) or base64."
      );
    }
    _key = parsed;
    return _key;
  }
  _key = loadOrCreateKeyFile();
  return _key;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENVELOPE_PREFIX);
}

/** Encrypt a secret for storage. Returns an `enc:v1:` envelope string. */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, ciphertext]).toString("base64");
  return ENVELOPE_PREFIX + payload;
}

/**
 * Decrypt a stored secret. Values that aren't in our envelope (legacy
 * plaintext rows) are returned unchanged so existing data keeps working.
 */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored; // legacy plaintext
  const payload = Buffer.from(stored.slice(ENVELOPE_PREFIX.length), "base64");
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf-8");
}
