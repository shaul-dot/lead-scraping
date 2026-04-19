/**
 * Utilities for 0_init baseline + migration history fixes.
 *
 * Writes baseline SQL (UTF-8, no BOM) only when explicitly requested — do not
 * use --to-schema-datasource after new migrations are applied, or 0_init will
 * include later tables and break checksums.
 *
 * From empty DB to current Postgres (introspected via DATABASE_URL):
 *   node packages/database/scripts/write-0-init-baseline.mjs --write-baseline-datasource
 *
 * Re-register 0_init checksum after editing migration.sql (no DDL on DB):
 *   node packages/database/scripts/write-0-init-baseline.mjs --re-register-only
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databaseDir = path.resolve(__dirname, '..');

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

const envPath = findEnvPath();
loadDotenv(envPath);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL missing after loading .env');
}

const shell = process.platform === 'win32';
const argv = process.argv.slice(2);

if (argv.includes('--write-baseline-datasource')) {
  const outPath = path.join(databaseDir, 'prisma/migrations/0_init/migration.sql');
  const cmd =
    'pnpm exec prisma migrate diff --from-empty --to-schema-datasource prisma/schema.prisma --script';
  const sql = execSync(cmd, {
    cwd: databaseDir,
    encoding: 'utf8',
    env: process.env,
    shell,
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, sql, { encoding: 'utf8' });
  const bytes = Buffer.byteLength(sql, 'utf8');
  const head = sql.slice(0, 120).replace(/\r?\n/g, '\\n');
  console.log('Wrote', outPath);
  console.log('UTF-8 byte length:', bytes);
  console.log('Head (escaped):', head);
}

if (argv.includes('--re-register-only') || argv.includes('--re-register-0-init')) {
  console.log('\nRe-registering 0_init checksum (no schema changes on DB)...');
  execSync(
    'pnpm exec prisma db execute --stdin --schema prisma/schema.prisma',
    {
      cwd: databaseDir,
      input:
        'DELETE FROM "_prisma_migrations" WHERE migration_name = \'0_init\';\n',
      encoding: 'utf8',
      stdio: ['pipe', 'inherit', 'inherit'],
      env: process.env,
      shell,
    },
  );
  execSync('pnpm exec prisma migrate resolve --applied 0_init', {
    cwd: databaseDir,
    stdio: 'inherit',
    env: process.env,
    shell,
  });
}

if (argv.includes('--migrate-dev')) {
  console.log('\nRunning prisma migrate dev --name add_advertiser_table ...');
  execSync('pnpm exec prisma migrate dev --name add_advertiser_table', {
    cwd: databaseDir,
    stdio: 'inherit',
    env: process.env,
    shell,
  });
}

if (argv.includes('--migrate-status') || argv.includes('--migrate-status-only')) {
  execSync('pnpm exec prisma migrate status', {
    cwd: databaseDir,
    stdio: 'inherit',
    env: process.env,
    shell,
  });
}

const didSomething =
  argv.includes('--write-baseline-datasource') ||
  argv.includes('--re-register-only') ||
  argv.includes('--re-register-0-init') ||
  argv.includes('--migrate-dev') ||
  argv.includes('--migrate-status') ||
  argv.includes('--migrate-status-only');

if (!didSomething) {
  console.error(
    'No action: pass --write-baseline-datasource, --re-register-only, --migrate-dev, and/or --migrate-status-only (see script header).',
  );
  process.exit(1);
}
