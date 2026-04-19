/**
 * Regenerate 0_init/migration.sql without Advertiser (for baseline after DB already has Advertiser).
 * Uses: prisma migrate diff --from-empty --to-schema-datamodel <stripped schema>
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databaseDir = path.resolve(__dirname, '..');
const schemaPath = path.join(databaseDir, 'prisma', 'schema.prisma');

function findEnvPath() {
  let dir = databaseDir;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not find .env walking up from packages/database');
}

function loadDotenv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotenv(findEnvPath());

let s = fs.readFileSync(schemaPath, 'utf8');

s = s.replace(
  /\r?\nenum AdvertiserQualStatus \{[^}]*\}\r?\n/s,
  '\n',
);

s = s.replace(
  /\r?\n  advertiserId\s+String\?\r?\n  advertiser\s+Advertiser\? @relation\(fields: \[advertiserId\], references: \[id\]\)\r?\n/s,
  '\n',
);

s = s.replace(/\r?\n  @@index\(\[advertiserId\]\)/, '');

const modelRe = /\r?\nmodel Advertiser \{/;
const modelMatch = modelRe.exec(s);
if (!modelMatch) throw new Error('schema.prisma: model Advertiser not found');
const modelStart = modelMatch.index;
const openBrace = s.indexOf('{', modelStart);
let depth = 0;
let closeIdx = -1;
for (let i = openBrace; i < s.length; i++) {
  const ch = s[i];
  if (ch === '{') depth++;
  else if (ch === '}') {
    depth--;
    if (depth === 0) {
      closeIdx = i;
      break;
    }
  }
}
if (closeIdx === -1) throw new Error('schema.prisma: model Advertiser brace mismatch');
s = s.slice(0, modelStart) + s.slice(closeIdx + 1);

const tmp = path.join(os.tmpdir(), `schema-pre-advertiser-${Date.now()}.prisma`);
fs.writeFileSync(tmp, s, 'utf8');

const tmpArg = tmp.replace(/\\/g, '/');
const shell = process.platform === 'win32';
const sql = execSync(
  `pnpm exec prisma migrate diff --from-empty --to-schema-datamodel "${tmpArg}" --script`,
  { cwd: databaseDir, encoding: 'utf8', env: process.env, shell },
);

const outPath = path.join(databaseDir, 'prisma', 'migrations', '0_init', 'migration.sql');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, sql, { encoding: 'utf8' });
fs.unlinkSync(tmp);

const bytes = Buffer.byteLength(sql, 'utf8');
console.log('Wrote', outPath, 'UTF-8 bytes:', bytes);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL required for DB vs schema check');
}
const drift = execSync(
  'pnpm exec prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script',
  { cwd: databaseDir, encoding: 'utf8', env: process.env, shell },
);
const driftTrim = drift.trim();
const isEmpty =
  driftTrim.length === 0 ||
  /^-- This is an empty migration\./i.test(driftTrim);
console.log('Live DB vs schema drift empty:', isEmpty);
if (!isEmpty) {
  console.log(drift.slice(0, 2000));
  process.exit(1);
}
