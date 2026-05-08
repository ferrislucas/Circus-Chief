#!/usr/bin/env node
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import {
  createFreshBaselineDb,
  getActiveDbPath,
  getIndexColumns,
  getSchemaObjects,
  getTableColumns,
  normalizeSql,
} from './dbUtils.js';
import {
  BUILT_IN_ANTHROPIC_MODELS,
  BUILT_IN_OPENAI_MODELS,
  BUILT_IN_ANTHROPIC_PROVIDER,
  BUILT_IN_OPENAI_PROVIDER,
} from '../db/seedBaselineData.js';

export const DRIFT_SENSITIVE_TABLES = [
  'sessions',
  'project_session_defaults',
  'session_templates',
  'canvas_items',
  'providers',
  'provider_models',
  'agent_call_logs',
  'kanban_lanes',
];

export const REQUIRED_INDEXES = {
  idx_sessions_project: ['project_id'],
  idx_sessions_status: ['status'],
  idx_sessions_archived: ['archived'],
  idx_sessions_starred: ['archived', 'starred'],
  idx_sessions_next_template: ['next_template_id'],
  idx_sessions_parent: ['parent_session_id'],
  idx_sessions_scheduled: ['scheduled_at'],
  idx_messages_conversation: ['conversation_id'],
  idx_canvas_deleted: ['deleted_at'],
  idx_todos_conversation: ['conversation_id'],
  idx_project_defaults_projectId: ['project_id'],
  idx_conversations_parent: ['parent_conversation_id'],
  idx_agent_call_logs_agent_type: ['agent_type'],
  idx_agent_call_logs_call_type: ['call_type'],
  idx_agent_call_logs_status: ['status'],
  idx_agent_call_logs_model: ['model'],
};

function byName(rows) {
  return new Map(rows.map((row) => [row.name, row]));
}

function compareTables(actualDb, expectedDb, errors) {
  const actualObjects = byName(getSchemaObjects(actualDb).filter((row) => row.type === 'table'));
  const expectedObjects = getSchemaObjects(expectedDb).filter((row) => row.type === 'table');

  for (const expected of expectedObjects) {
    const actual = actualObjects.get(expected.name);
    if (!actual) {
      errors.push(`Missing table: ${expected.name}`);
      continue;
    }

    const actualColumns = new Map(
      getTableColumns(actualDb, expected.name).map((col) => [col.name, col])
    );
    const expectedColumns = getTableColumns(expectedDb, expected.name);

    for (const expectedColumn of expectedColumns) {
      const actualColumn = actualColumns.get(expectedColumn.name);
      if (!actualColumn) {
        errors.push(`Missing column: ${expected.name}.${expectedColumn.name}`);
        continue;
      }

      const actualSummary = {
        type: actualColumn.type,
        notnull: actualColumn.notnull,
        dflt_value: actualColumn.dflt_value,
        pk: actualColumn.pk,
      };
      const expectedSummary = {
        type: expectedColumn.type,
        notnull: expectedColumn.notnull,
        dflt_value: expectedColumn.dflt_value,
        pk: expectedColumn.pk,
      };
      if (JSON.stringify(actualSummary) !== JSON.stringify(expectedSummary)) {
        errors.push(`Column mismatch for ${expected.name}.${expectedColumn.name}`);
      }
    }
  }
}

function compareIndexes(actualDb, expectedDb, errors) {
  const actualObjects = byName(getSchemaObjects(actualDb).filter((row) => row.type === 'index'));
  const expectedObjects = byName(getSchemaObjects(expectedDb).filter((row) => row.type === 'index'));

  for (const [name, expectedColumns] of Object.entries(REQUIRED_INDEXES)) {
    const actual = actualObjects.get(name);
    if (!actual) {
      errors.push(`Missing index: ${name}`);
      continue;
    }
    const actualColumns = getIndexColumns(actualDb, name);
    if (JSON.stringify(actualColumns) !== JSON.stringify(expectedColumns)) {
      errors.push(`Index column mismatch for ${name}: ${actualColumns.join(',')} !== ${expectedColumns.join(',')}`);
    }
  }

  const expectedScheduledSql = normalizeSql(expectedObjects.get('idx_sessions_scheduled')?.sql);
  const actualScheduledSql = normalizeSql(actualObjects.get('idx_sessions_scheduled')?.sql);
  if (expectedScheduledSql !== actualScheduledSql) {
    errors.push('Partial index SQL mismatch for idx_sessions_scheduled');
  }
}

function validateProviders(actualDb, errors) {
  for (const provider of [BUILT_IN_ANTHROPIC_PROVIDER, BUILT_IN_OPENAI_PROVIDER]) {
    const row = actualDb.prepare(
      'SELECT id, name, kind, base_url, auth_token, commit_attribution_override FROM providers WHERE id = ?'
    ).get(provider.id);
    if (!row) {
      errors.push(`Missing provider seed row: ${provider.id}`);
      continue;
    }
    if (row.name !== provider.name || row.kind !== provider.kind) {
      errors.push(`Provider seed mismatch: ${provider.id}`);
    }
    if (row.base_url !== null || row.auth_token !== null) {
      errors.push(`Provider nullable seed columns mismatch: ${provider.id}`);
    }
  }
}

function validateProviderModels(actualDb, errors) {
  for (const model of [...BUILT_IN_ANTHROPIC_MODELS, ...BUILT_IN_OPENAI_MODELS]) {
    const row = actualDb.prepare(
      'SELECT provider_id, model_id, display_name, description, tier FROM provider_models WHERE id = ?'
    ).get(model.id);
    if (!row) {
      errors.push(`Missing provider model seed row: ${model.id}`);
      continue;
    }
    const expected = {
      provider_id: model.providerId,
      model_id: model.modelId,
      display_name: model.displayName,
      description: model.description,
      tier: model.tier,
    };
    if (JSON.stringify(row) !== JSON.stringify(expected)) {
      errors.push(`Provider model seed mismatch: ${model.id}`);
    }
  }
}

function compareSeedRows(actualDb, errors) {
  const tables = new Set(actualDb.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table'"
  ).all().map((row) => row.name));
  if (!tables.has('providers') || !tables.has('provider_models') || !tables.has('quick_responses') || !tables.has('session_templates')) {
    errors.push('Required seed tables are missing');
    return;
  }
  validateProviders(actualDb, errors);
  validateProviderModels(actualDb, errors);
}

export function validateDatabaseBaseline(actualDb) {
  const fresh = createFreshBaselineDb();
  const errors = [];

  try {
    compareTables(actualDb, fresh.db, errors);
    compareIndexes(actualDb, fresh.db, errors);
    compareSeedRows(actualDb, errors);
  } finally {
    fresh.close();
  }

  return errors;
}

export function main() {
  const dbPath = getActiveDbPath();
  if (!existsSync(dbPath)) {
    console.log(`No database found at ${dbPath}; nothing to validate.`);
    return 0;
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const errors = validateDatabaseBaseline(db);
    if (errors.length === 0) {
      console.log(`Database baseline validation passed: ${dbPath}`);
      return 0;
    }

    console.error(`Database baseline validation failed: ${dbPath}`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    return 1;
  } finally {
    db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
