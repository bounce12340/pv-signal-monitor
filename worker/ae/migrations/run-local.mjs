#!/usr/bin/env node
/**
 * Local SQLite migration preflight/runner for synthetic validation only.
 * It never contacts D1, Wrangler, R2, or any remote service.
 *
 * Usage: node worker/ae/migrations/run-local.mjs /path/to/database.sqlite
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.argv[2];
if (!target) throw new Error('usage: node worker/ae/migrations/run-local.mjs /path/to/database.sqlite');
const here = dirname(fileURLToPath(import.meta.url));
const sql = file => readFileSync(resolve(here, file), 'utf8');
const migrationSql = {
  '001_case_work': sql('001_case_work.sql'),
  '002_case_version': sql('002_case_version.sql'),
  '003_work_status_notifications': sql('003_work_status_notifications.sql'),
  '004_case_mutation_token': sql('004_case_mutation_token.sql'),
};
const quote = name => `"${name.replaceAll('"', '""')}"`;
const rows = (db, statement) => db.prepare(statement).all();
const object = (db, type, name) => db.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?').get(type, name) || null;

// This is deliberately not a whitespace stripper.  It only normalizes layout
// outside quoted identifiers/literals and keeps token boundaries and every
// quoted byte, so SQL string semantics cannot be merged by normalization.
function canonicalSql(text) {
  if (typeof text !== 'string') return text;
  let out = '', space = false, quoteChar = null;
  const emitSpace = () => { if (space && out && !out.endsWith(' ')) out += ' '; space = false; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoteChar) {
      out += ch;
      if (ch === quoteChar) {
        if (text[i + 1] === quoteChar && quoteChar !== ']') out += text[++i];
        else quoteChar = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { emitSpace(); out += ch; quoteChar = ch; continue; }
    if (ch === '[') { emitSpace(); out += ch; quoteChar = ']'; continue; }
    if (/\s/.test(ch)) { space = true; continue; }
    if ('(),;'.includes(ch)) { space = false; out += ch; continue; }
    emitSpace(); out += ch;
  }
  return out.trim();
}
const sameSql = (left, right) => canonicalSql(left) === canonicalSql(right);
const sameDefault = (left, right) => canonicalSql(left ?? '') === canonicalSql(right ?? '');
const sameColumn = (left, right) => left && right &&
  left.name === right.name && canonicalSql(left.type || '') === canonicalSql(right.type || '') &&
  Number(left.notnull) === Number(right.notnull) && Number(left.pk) === Number(right.pk) &&
  sameDefault(left.dflt_value, right.dflt_value);

function tableShape(db, name) {
  const entry = object(db, 'table', name);
  if (!entry) return null;
  return { sql: entry.sql, columns: rows(db, `PRAGMA table_info(${quote(name)})`) };
}
function sameTable(actual, expected, optionalColumns = new Set(), requireSql = false) {
  if (!actual) return false;
  if (requireSql && !sameSql(actual.sql, expected.sql)) return false;
  const actualByName = new Map(actual.columns.map(column => [column.name, column]));
  for (const expectedColumn of expected.columns) {
    if (optionalColumns.has(expectedColumn.name) && !actualByName.has(expectedColumn.name)) continue;
    if (!sameColumn(actualByName.get(expectedColumn.name), expectedColumn)) return false;
  }
  return true;
}
function indexShape(db, name) {
  const entry = object(db, 'index', name);
  if (!entry) return null;
  const indexes = rows(db, `PRAGMA index_list(${quote(entry.tbl_name || '')})`);
  // sqlite_master does not expose tbl_name through this query in every build;
  // find it from the CREATE INDEX target through all known table index lists.
  return entry;
}
function indexDefinition(db, name) {
  const entry = object(db, 'index', name);
  if (!entry) return null;
  const table = db.prepare("SELECT tbl_name FROM sqlite_master WHERE type='index' AND name=?").get(name)?.tbl_name;
  const list = rows(db, `PRAGMA index_list(${quote(table)})`).find(row => row.name === name);
  return { sql: entry.sql, list, columns: rows(db, `PRAGMA index_xinfo(${quote(name)})`).filter(row => Number(row.key) === 1) };
}
function sameIndex(actual, expected) {
  if (!actual || !expected || !actual.list || !expected.list) return false;
  if (Number(actual.list.unique) !== Number(expected.list.unique) || Number(actual.list.partial) !== Number(expected.list.partial)) return false;
  if (actual.columns.length !== expected.columns.length) return false;
  for (let i = 0; i < actual.columns.length; i++) {
    const a = actual.columns[i], e = expected.columns[i];
    if (Number(a.seqno) !== Number(e.seqno) || Number(a.cid) !== Number(e.cid) || a.name !== e.name || Number(a.desc) !== Number(e.desc) || String(a.coll) !== String(e.coll)) return false;
  }
  return sameSql(actual.sql, expected.sql);
}
function triggerDefinition(db, name) { return object(db, 'trigger', name)?.sql || null; }
const sameTrigger = (actual, expected) => Boolean(actual) && sameSql(actual, expected);

function referenceDatabase() {
  const reference = new DatabaseSync(':memory:');
  reference.exec(readFileSync(resolve(here, '../schema.sql'), 'utf8'));
  reference.exec(migrationSql['001_case_work']);
  const before003 = capture(reference);
  reference.exec(migrationSql['003_work_status_notifications']);
  const final = capture(reference);
  reference.close();
  return { before003, final };
}
function capture(db) {
  const table = name => tableShape(db, name);
  const index = name => indexDefinition(db, name);
  const trigger = name => triggerDefinition(db, name);
  return {
    aeCases: table('ae_cases'), caseWork: table('ae_case_work'), workAudit: table('ae_work_audit'), notifications: table('ae_notifications'),
    workbench: index('idx_ae_case_work_workbench'), notificationsRecipient: index('idx_ae_notifications_recipient'),
    triggers: Object.fromEntries(['ae_work_audit_no_update', 'ae_work_audit_no_delete', 'ae_work_created', 'ae_work_updated', 'ae_work_assignment_notification_insert', 'ae_work_assignment_notification_update'].map(name => [name, trigger(name)])),
  };
}
const expected = referenceDatabase();

function definitionStatus(db, migration) {
  const final = expected.final, old = expected.before003;
  switch (migration.id) {
    case '001_case_work': {
      const has003Footprint = footprintStatus(db, { id: '003_work_status_notifications' });
      // Once 003 is present, its own full-table comparison below owns the
      // augmented definition.  Before that, require the original 001 SQL.
      const tables = sameTable(tableShape(db, 'ae_case_work'), old.caseWork, new Set(), !has003Footprint) && sameTable(tableShape(db, 'ae_work_audit'), old.workAudit, new Set(), true);
      const immutable = sameTrigger(triggerDefinition(db, 'ae_work_audit_no_update'), old.triggers.ae_work_audit_no_update) && sameTrigger(triggerDefinition(db, 'ae_work_audit_no_delete'), old.triggers.ae_work_audit_no_delete);
      // 003 intentionally replaces these two 001 definitions.  Either the
      // verified legacy pair or the verified replacement pair is legitimate.
      const oldAudit = sameTrigger(triggerDefinition(db, 'ae_work_created'), old.triggers.ae_work_created) && sameTrigger(triggerDefinition(db, 'ae_work_updated'), old.triggers.ae_work_updated);
      const replacementAudit = sameTrigger(triggerDefinition(db, 'ae_work_created'), final.triggers.ae_work_created) && sameTrigger(triggerDefinition(db, 'ae_work_updated'), final.triggers.ae_work_updated);
      return tables && immutable && (oldAudit || replacementAudit);
    }
    case '002_case_version':
      return sameColumn(tableShape(db, 'ae_cases')?.columns.find(column => column.name === 'version'), final.aeCases.columns.find(column => column.name === 'version'));
    case '003_work_status_notifications': {
      const work = sameTable(tableShape(db, 'ae_case_work'), final.caseWork, new Set(), true);
      const notifications = sameTable(tableShape(db, 'ae_notifications'), final.notifications, new Set(), true);
      const indexes = sameIndex(indexDefinition(db, 'idx_ae_case_work_workbench'), final.workbench) && sameIndex(indexDefinition(db, 'idx_ae_notifications_recipient'), final.notificationsRecipient);
      const triggers = ['ae_work_created', 'ae_work_updated', 'ae_work_assignment_notification_insert', 'ae_work_assignment_notification_update'].every(name => sameTrigger(triggerDefinition(db, name), final.triggers[name]));
      return work && notifications && indexes && triggers;
    }
    case '004_case_mutation_token':
      return sameColumn(tableShape(db, 'ae_cases')?.columns.find(column => column.name === 'last_mutation_id'), final.aeCases.columns.find(column => column.name === 'last_mutation_id'));
    default:
      return false;
  }
}
function footprintStatus(db, migration) {
  switch (migration.id) {
    case '001_case_work': return Boolean(tableShape(db, 'ae_case_work') || tableShape(db, 'ae_work_audit') || triggerDefinition(db, 'ae_work_audit_no_update') || triggerDefinition(db, 'ae_work_audit_no_delete') || triggerDefinition(db, 'ae_work_created') || triggerDefinition(db, 'ae_work_updated'));
    case '002_case_version': return Boolean(tableShape(db, 'ae_cases')?.columns.some(column => column.name === 'version'));
    case '003_work_status_notifications': return Boolean(tableShape(db, 'ae_case_work')?.columns.some(column => ['status', 'assignee', 'work_due_date', 'audit_action'].includes(column.name)) || tableShape(db, 'ae_notifications') || indexDefinition(db, 'idx_ae_case_work_workbench') || indexDefinition(db, 'idx_ae_notifications_recipient') || triggerDefinition(db, 'ae_work_assignment_notification_insert') || triggerDefinition(db, 'ae_work_assignment_notification_update'));
    case '004_case_mutation_token': return Boolean(tableShape(db, 'ae_cases')?.columns.some(column => column.name === 'last_mutation_id'));
    default: return false;
  }
}

const db = new DatabaseSync(resolve(target));
const migrations = [
  { id: '001_case_work', file: '001_case_work.sql' },
  { id: '002_case_version', file: '002_case_version.sql' },
  { id: '003_work_status_notifications', file: '003_work_status_notifications.sql' },
  { id: '004_case_mutation_token', file: '004_case_mutation_token.sql' },
];
const ledgerExpected = { sql: 'CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)', columns: [
  { name: 'id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 1 },
  { name: 'applied_at', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
] };
const ledgerExists = () => Boolean(object(db, 'table', 'schema_migrations'));
const validLedger = () => !ledgerExists() || sameTable(tableShape(db, 'schema_migrations'), ledgerExpected, new Set(), true);
const applied = id => ledgerExists() && Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE id=?').get(id));
const record = id => db.prepare('INSERT INTO schema_migrations(id, applied_at) VALUES(?, ?)').run(id, new Date().toISOString());
try {
  db.exec('PRAGMA foreign_keys = ON');
  if (!tableShape(db, 'ae_cases')) throw new Error('preflight: ae_cases is missing; refuse to infer a schema');
  if (!validLedger()) throw new Error('preflight: schema_migrations definition differs (fail closed)');
  // Validate all existing ledger/schema metadata before writing even one ledger
  // row.  This prevents an early migration from being stamped if a later
  // migration is partial or drifted.
  const plan = migrations.map(migration => ({ migration, complete: definitionStatus(db, migration), footprint: footprintStatus(db, migration), ledger: applied(migration.id) }));
  for (const { migration, complete, footprint, ledger } of plan) {
    if (ledger && !complete) throw new Error(`${migration.id}: ledger says applied but schema definition differs (fail closed)`);
    if (!ledger && !complete && footprint) throw new Error(`${migration.id}: partial or drifted schema without ledger (fail closed; preserve data)`);
  }
  db.exec('BEGIN');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (const { migration, complete } of plan) {
      if (!complete) {
        db.exec(migrationSql[migration.id]);
        if (!definitionStatus(db, migration)) throw new Error(`${migration.id}: SQL completed without expected schema definition`);
      }
      if (!applied(migration.id)) record(migration.id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
} finally {
  db.close();
}
