/**
 * market-trust.ts — Cryptographic root of trust for /market content (audit 1.5)
 *
 * The `/market` folder is a prompt-injection surface: its `.md` files are
 * concatenated verbatim into agent system prompts (market-loader.ts). Today the
 * only guarantee that a market/ tree hasn't been tampered with is the social rule
 * "only humans edit market/" — this module makes that guarantee technical.
 *
 * Canonical manifest: every `market/**\/*.md` file + `market/inventory.json`,
 * hashed with sha256 and sorted by relative (POSIX-style) path — a deterministic,
 * order-independent fingerprint of the tree's content. Detached signature file:
 * `market/.signature.json` = { version, keyId, manifest, signature (base64) }.
 *
 * Signing uses ed25519 (node:crypto) — the algorithm parameter to sign/verify
 * MUST be `null`: ed25519 has its digest built in and rejects a separate one.
 *
 * This module has NO Electron dependency (usable from `scripts/market-sign.ts`,
 * a plain Node/tsx CLI, as well as from market-loader.ts inside the app). Policy
 * (when to warn vs. fail closed) lives in market-loader.ts, not here — this
 * module only builds manifests and signs/verifies them.
 */
import {
  createPrivateKey,
  createPublicKey,
  createHash,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface MarketManifestEntry {
  /** POSIX-style path relative to the market root, e.g. "roles/security-researcher.md". */
  path: string;
  /** Lowercase hex sha256 of the file's raw bytes. */
  sha256: string;
}

/** Sorted by `path` — the canonical, deterministic order signed over. */
export type MarketManifest = MarketManifestEntry[];

function toPosixRelative(root: string, absPath: string): string {
  return relative(root, absPath).split(sep).join('/');
}

function sha256Hex(absPath: string): string {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex');
}

function collectMdFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectMdFiles(full, acc);
    } else if (entry.endsWith('.md')) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Builds the canonical manifest for a market directory: every `**\/*.md` file
 * (recursive) plus the root `inventory.json`, sorted by relative path.
 * Throws if `dir` or `dir/inventory.json` does not exist — a market tree without
 * an inventory is not a valid signing target.
 */
export function buildManifest(dir: string): MarketManifest {
  if (!existsSync(dir)) {
    throw new Error(`market-trust: directory not found: ${dir}`);
  }
  const inventoryPath = join(dir, 'inventory.json');
  if (!existsSync(inventoryPath)) {
    throw new Error(`market-trust: ${inventoryPath} not found — a market tree must have an inventory to sign.`);
  }

  const files = [...collectMdFiles(dir), inventoryPath];
  const entries: MarketManifest = files.map((absPath) => ({
    path: toPosixRelative(dir, absPath),
    sha256: sha256Hex(absPath),
  }));
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}

/** Deterministic signing payload for a manifest — same manifest ⇒ same bytes, always. */
function manifestPayload(manifest: MarketManifest): Buffer {
  return Buffer.from(JSON.stringify(manifest), 'utf-8');
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

export interface MarketSignatureFile {
  version: 1;
  keyId: string;
  manifest: MarketManifest;
  /** base64 ed25519 signature over JSON.stringify(manifest). */
  signature: string;
}

/** Generates a fresh ed25519 keypair, PEM-encoded (spki public / pkcs8 private). */
export function generateMarketSigningKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/** Builds the manifest for `dir` and signs it with `privateKeyPem` under `keyId`. */
export function signMarket(dir: string, privateKeyPem: string, keyId: string): MarketSignatureFile {
  const manifest = buildManifest(dir);
  const privateKey: KeyObject = createPrivateKey(privateKeyPem);
  const signature = cryptoSign(null, manifestPayload(manifest), privateKey).toString('base64');
  return { version: 1, keyId, manifest, signature };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type MarketVerifyResult =
  | { ok: true; keyId: string }
  | {
    ok: false;
    reason: 'missing-signature' | 'invalid-signature-file' | 'unknown-key' | 'invalid-signature' | 'tampered';
    detail?: string;
  };

function readSignatureFile(dir: string): MarketSignatureFile | null {
  const sigPath = join(dir, '.signature.json');
  if (!existsSync(sigPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(sigPath, 'utf-8'));
    if (
      !parsed
      || typeof parsed !== 'object'
      || parsed.version !== 1
      || typeof parsed.keyId !== 'string'
      || typeof parsed.signature !== 'string'
      || !Array.isArray(parsed.manifest)
    ) {
      return null;
    }
    return parsed as MarketSignatureFile;
  } catch {
    return null;
  }
}

function manifestsMatch(a: MarketManifest, b: MarketManifest): boolean {
  if (a.length !== b.length) return false;
  return a.every((entry, i) => entry.path === b[i].path && entry.sha256 === b[i].sha256);
}

/**
 * Verifies `dir/.signature.json` against `publicKeys` (keyId → PEM). Checks, in
 * order: signature file present and well-formed; keyId known; signature
 * cryptographically valid over the recorded manifest; recorded manifest matches
 * the live on-disk content (tamper detection).
 */
export function verifyMarket(dir: string, publicKeys: Record<string, string>): MarketVerifyResult {
  const sigFile = readSignatureFile(dir);
  if (!sigFile) {
    return { ok: false, reason: existsSync(join(dir, '.signature.json')) ? 'invalid-signature-file' : 'missing-signature' };
  }

  const publicKeyPem = publicKeys[sigFile.keyId];
  if (!publicKeyPem) {
    return { ok: false, reason: 'unknown-key', detail: sigFile.keyId };
  }

  const publicKey: KeyObject = createPublicKey(publicKeyPem);
  const signatureValid = cryptoVerify(
    null,
    manifestPayload(sigFile.manifest),
    publicKey,
    Buffer.from(sigFile.signature, 'base64'),
  );
  if (!signatureValid) {
    return { ok: false, reason: 'invalid-signature' };
  }

  const liveManifest = buildManifest(dir);
  if (!manifestsMatch(liveManifest, sigFile.manifest)) {
    return { ok: false, reason: 'tampered' };
  }

  return { ok: true, keyId: sigFile.keyId };
}

// ---------------------------------------------------------------------------
// Trusted keys — bootstrap mode
// ---------------------------------------------------------------------------

/**
 * keyId → ed25519 public key (PEM, spki). EMPTY today — no signing key has been
 * provisioned yet (bootstrap mode). market-loader.ts treats an empty map as
 * "verification skipped" rather than "everything is untrusted"; see its own
 * policy comment for the packaged-vs-dev behavior once a key is added here.
 * Populate via `npx tsx scripts/market-sign.ts --gen-key`.
 */
export const TRUSTED_MARKET_KEYS: Record<string, string> = {};
