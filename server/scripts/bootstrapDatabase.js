import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const prismaDirectory = path.join(repositoryRoot, 'server', 'prisma');
const schemaPath = path.join(prismaDirectory, 'schema.prisma');
const prismaCliPath = path.join(repositoryRoot, 'node_modules', 'prisma', 'build', 'index.js');
const seedPath = path.join(prismaDirectory, 'seed.js');

dotenv.config({ path: path.join(repositoryRoot, '.env'), quiet: true });
process.env.DATABASE_URL ||= 'file:./dev.db';

const argumentsSet = new Set(process.argv.slice(2));
const seedIfEmpty = argumentsSet.has('--seed-if-empty');
const forceSeed = argumentsSet.has('--force-seed');

function runNode(script, args = []) {
  execFileSync(process.execPath, [script, ...args], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });
}

function runPrisma(args) {
  if (!existsSync(prismaCliPath)) {
    throw new Error('Prisma is not installed. Run `npm ci` (or `npm install` for local development) first.');
  }
  runNode(prismaCliPath, [...args, '--schema', schemaPath]);
}

function sqlitePathFromUrl(databaseUrl) {
  if (!databaseUrl.startsWith('file:')) return null;
  let databasePath = decodeURIComponent(databaseUrl.slice('file:'.length).split('?')[0]);
  if (/^\/[A-Za-z]:[\\/]/.test(databasePath)) databasePath = databasePath.slice(1);
  return path.isAbsolute(databasePath) ? databasePath : path.resolve(prismaDirectory, databasePath);
}

function sqliteTableExists(database, tableName) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(tableName));
}

function sqliteColumns(database, tableName) {
  if (!sqliteTableExists(database, tableName)) return new Set();
  return new Set(database.prepare(`PRAGMA table_info("${tableName}")`).all().map((column) => column.name));
}

function reflectedMigrationNames(database) {
  const reflected = [];
  if (sqliteTableExists(database, 'PlatformUser') && sqliteTableExists(database, 'Hospital')) {
    reflected.push(firstMigrationName());
  }

  const platformColumns = sqliteColumns(database, 'PlatformUser');
  const authLockoutParts = ['failedLoginAttempts', 'lockedUntil'].filter((column) => platformColumns.has(column));
  if (authLockoutParts.length === 1) {
    throw new Error('The existing SQLite database contains only part of the Super Admin lockout migration. Restore it or resolve that migration manually.');
  }
  if (authLockoutParts.length === 2) reflected.push('20260713010000_auth_lockout');

  const paymentIntentExists = sqliteTableExists(database, 'PaymentIntent');
  const inventoryExists = sqliteTableExists(database, 'PharmacyInventoryItem');
  if (paymentIntentExists !== inventoryExists) {
    throw new Error('The existing SQLite database contains only part of the payment-intent/inventory migration. Restore it or resolve that migration manually.');
  }
  if (paymentIntentExists && inventoryExists) reflected.push('20260713020000_payment_intents_inventory');

  if (sqliteColumns(database, 'PatientInvoice').has('notes')) {
    reflected.push('20260714000000_patient_invoice_notes');
  }
  return reflected.filter(Boolean);
}

function prepareSqliteDatabase(databasePath) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  // Opening the file and writing a valid SQLite header avoids a schema-engine
  // creation race seen with a brand-new database on Windows.
  database.exec('PRAGMA user_version = 1;');
  const applicationTablesExist = sqliteTableExists(database, 'PlatformUser');
  const migrationTableExists = sqliteTableExists(database, '_prisma_migrations');
  const reflectedMigrations = applicationTablesExist && !migrationTableExists ? reflectedMigrationNames(database) : [];
  database.close();
  return { applicationTablesExist, migrationTableExists, reflectedMigrations };
}

function firstMigrationName() {
  return readdirSync(path.join(prismaDirectory, 'migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()[0];
}

async function databaseIsEmpty() {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    return (await prisma.platformUser.count()) === 0 && (await prisma.hospital.count()) === 0;
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const sqlitePath = sqlitePathFromUrl(process.env.DATABASE_URL);
  const sqliteState = sqlitePath ? prepareSqliteDatabase(sqlitePath) : null;

  runPrisma(['generate']);

  // Earlier demo databases were created with `db push` and contain schema
  // milestones without Prisma's migration ledger. Baseline only milestones
  // whose exact marker columns/tables are present, then deploy anything newer.
  // This compatibility path is deliberately SQLite-only and must never be used
  // to infer production PostgreSQL migration history.
  if (sqliteState?.applicationTablesExist && !sqliteState.migrationTableExists) {
    if (!sqliteState.reflectedMigrations.length) throw new Error('No checked-in Prisma migration matches the existing SQLite schema.');
    for (const migrationName of sqliteState.reflectedMigrations) {
      console.log(`Baselining existing local SQLite database at migration ${migrationName}.`);
      runPrisma(['migrate', 'resolve', '--applied', migrationName]);
    }
  }

  runPrisma(['migrate', 'deploy']);

  if (forceSeed) {
    console.warn('Resetting and reseeding the demonstration database because --force-seed was supplied.');
    runNode(seedPath);
  } else if (seedIfEmpty && await databaseIsEmpty()) {
    console.log('The database is empty; installing the deterministic demonstration dataset.');
    runNode(seedPath, ['--no-reset']);
  } else if (seedIfEmpty) {
    console.log('The database already contains data; demonstration seeding was skipped.');
  }

  console.log('Database bootstrap completed successfully.');
}

main().catch((error) => {
  console.error('Database bootstrap failed.');
  console.error(error);
  process.exitCode = 1;
});
