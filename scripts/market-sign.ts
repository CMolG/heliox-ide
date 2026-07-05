// scripts/market-sign.ts — Root-of-trust key management + signing for /market (audit 1.5)
// Usage:
//   npx tsx scripts/market-sign.ts --gen-key
//     Generates an ed25519 keypair, writes the private key to
//     ~/.heliox/market-signing/<keyId>.private.pem (mode 0600 — never in the
//     repo) and the public key alongside it, and prints a TRUSTED_MARKET_KEYS
//     snippet to paste into src/main/market/market-trust.ts.
//
//   npx tsx scripts/market-sign.ts --sign [--dir <marketDir>] [--key-id <keyId>]
//     Signs `<marketDir>` (default: <cwd>/market) with the given key (default:
//     the most recently generated one) and writes <marketDir>/.signature.json.
//
// This script only reads/writes the market directory it is pointed at and the
// key directory under the user's home — it never touches anything else in the
// repo. Human operators run --sign against the real market/; agents must not.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { buildManifest, generateMarketSigningKeyPair, signMarket } from '../src/main/market/market-trust';

const KEY_DIR = join(homedir(), '.heliox', 'market-signing');

function parseArgs(argv: string[]): { mode: '--gen-key' | '--sign' | null; dir?: string; keyId?: string } {
  const mode = argv.includes('--gen-key') ? '--gen-key' : argv.includes('--sign') ? '--sign' : null;
  const dirIdx = argv.indexOf('--dir');
  const keyIdIdx = argv.indexOf('--key-id');
  return {
    mode,
    dir: dirIdx !== -1 ? argv[dirIdx + 1] : undefined,
    keyId: keyIdIdx !== -1 ? argv[keyIdIdx + 1] : undefined,
  };
}

function generateKeyId(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `heliox-market-${date}-${randomBytes(4).toString('hex')}`;
}

function runGenKey(): void {
  mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });

  const keyId = generateKeyId();
  const { publicKeyPem, privateKeyPem } = generateMarketSigningKeyPair();
  const privatePath = join(KEY_DIR, `${keyId}.private.pem`);
  const publicPath = join(KEY_DIR, `${keyId}.public.pem`);

  writeFileSync(privatePath, privateKeyPem, { mode: 0o600 });
  writeFileSync(publicPath, publicKeyPem, { mode: 0o644 });

  console.log(`Generated ed25519 signing key "${keyId}"`);
  console.log(`  private key: ${privatePath} (0600 — do NOT commit this)`);
  console.log(`  public key:  ${publicPath}`);
  console.log('');
  console.log('Paste this into TRUSTED_MARKET_KEYS in src/main/market/market-trust.ts:');
  console.log('');
  console.log(`  '${keyId}': \`${publicKeyPem.trim()}\`,`);
}

/** Resolves the private key to sign with: explicit --key-id, else the newest one in KEY_DIR. */
function resolvePrivateKeyPath(keyId?: string): { keyId: string; privateKeyPem: string } {
  if (!existsSync(KEY_DIR)) {
    throw new Error(`No signing keys found at ${KEY_DIR}. Run --gen-key first.`);
  }

  if (keyId) {
    const privatePath = join(KEY_DIR, `${keyId}.private.pem`);
    if (!existsSync(privatePath)) {
      throw new Error(`No private key found for "${keyId}" at ${privatePath}.`);
    }
    return { keyId, privateKeyPem: readFileSync(privatePath, 'utf-8') };
  }

  const candidates = readdirSync(KEY_DIR)
    .filter((file) => file.endsWith('.private.pem'))
    .map((file) => ({ file, mtime: statSync(join(KEY_DIR, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (candidates.length === 0) {
    throw new Error(`No private keys found at ${KEY_DIR}. Run --gen-key first.`);
  }

  const newest = candidates[0].file;
  return {
    keyId: newest.replace(/\.private\.pem$/, ''),
    privateKeyPem: readFileSync(join(KEY_DIR, newest), 'utf-8'),
  };
}

function runSign(dir: string, explicitKeyId?: string): void {
  const { keyId, privateKeyPem } = resolvePrivateKeyPath(explicitKeyId);
  const sigFile = signMarket(dir, privateKeyPem, keyId);
  const sigPath = join(dir, '.signature.json');
  writeFileSync(sigPath, JSON.stringify(sigFile, null, 2) + '\n');

  console.log(`Signed ${dir} with key "${keyId}"`);
  console.log(`  manifest entries: ${buildManifest(dir).length}`);
  console.log(`  wrote: ${sigPath}`);
}

function main(): void {
  const { mode, dir, keyId } = parseArgs(process.argv.slice(2));

  if (mode === '--gen-key') {
    runGenKey();
    return;
  }

  if (mode === '--sign') {
    runSign(dir ?? join(process.cwd(), 'market'), keyId);
    return;
  }

  console.error('Usage:');
  console.error('  npx tsx scripts/market-sign.ts --gen-key');
  console.error('  npx tsx scripts/market-sign.ts --sign [--dir <marketDir>] [--key-id <keyId>]');
  process.exitCode = 1;
}

main();
