export type SqliteStatementLike = {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
};

export type SqliteDatabaseLike = {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatementLike;
};

export type SqliteMigration = {
  version: string;
  sql: string;
};

export const V2_MIGRATIONS: SqliteMigration[] = [
  {
    version: "001_v2_core",
    sql: `
      CREATE TABLE IF NOT EXISTS fulfillment_contexts (
        tenant_id TEXT NOT NULL,
        id TEXT NOT NULL,
        business_key TEXT NOT NULL,
        context_type TEXT NOT NULL,
        status TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, context_type, business_key)
      );

      CREATE TABLE IF NOT EXISTS source_systems (
        tenant_id TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        system_type TEXT NOT NULL,
        authority_level TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, system_type, name)
      );

      CREATE TABLE IF NOT EXISTS business_entities (
        tenant_id TEXT NOT NULL,
        id TEXT NOT NULL,
        context_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        business_key TEXT NOT NULL,
        attributes_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, context_id, entity_type, business_key),
        FOREIGN KEY (tenant_id, context_id)
          REFERENCES fulfillment_contexts (tenant_id, id)
      );

      CREATE TABLE IF NOT EXISTS source_documents (
        tenant_id TEXT NOT NULL,
        id TEXT NOT NULL,
        source_system_id TEXT NOT NULL,
        external_document_id TEXT NOT NULL,
        document_type TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        received_at TEXT NOT NULL,
        effective_at TEXT,
        version TEXT NOT NULL,
        context_id TEXT,
        entity_id TEXT,
        file_name TEXT,
        mime_type TEXT,
        metadata_json TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, source_system_id, external_document_id, version),
        FOREIGN KEY (tenant_id, source_system_id)
          REFERENCES source_systems (tenant_id, id),
        FOREIGN KEY (tenant_id, context_id)
          REFERENCES fulfillment_contexts (tenant_id, id),
        FOREIGN KEY (tenant_id, entity_id)
          REFERENCES business_entities (tenant_id, id)
      );

      CREATE TABLE IF NOT EXISTS entity_references (
        tenant_id TEXT NOT NULL,
        id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        source_system_id TEXT NOT NULL,
        external_id TEXT NOT NULL,
        external_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, source_system_id, external_type, external_id),
        FOREIGN KEY (tenant_id, entity_id)
          REFERENCES business_entities (tenant_id, id),
        FOREIGN KEY (tenant_id, source_system_id)
          REFERENCES source_systems (tenant_id, id)
      );

      CREATE TABLE IF NOT EXISTS fulfillment_events (
        tenant_id TEXT NOT NULL,
        id TEXT NOT NULL,
        context_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        source_system_id TEXT NOT NULL,
        source_document_id TEXT,
        payload_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, source_system_id, idempotency_key),
        FOREIGN KEY (tenant_id, context_id)
          REFERENCES fulfillment_contexts (tenant_id, id),
        FOREIGN KEY (tenant_id, entity_id)
          REFERENCES business_entities (tenant_id, id),
        FOREIGN KEY (tenant_id, source_system_id)
          REFERENCES source_systems (tenant_id, id),
        FOREIGN KEY (tenant_id, source_document_id)
          REFERENCES source_documents (tenant_id, id)
      );

      CREATE TABLE IF NOT EXISTS v2_evidence (
        tenant_id TEXT NOT NULL,
        id TEXT NOT NULL,
        context_id TEXT NOT NULL,
        source_system_id TEXT NOT NULL,
        source_document_id TEXT NOT NULL,
        source_version TEXT NOT NULL,
        entity_id TEXT,
        event_id TEXT,
        field TEXT NOT NULL,
        value_json TEXT NOT NULL,
        value_type TEXT NOT NULL,
        locator_json TEXT NOT NULL,
        quote TEXT NOT NULL,
        confidence REAL NOT NULL,
        support TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id),
        FOREIGN KEY (tenant_id, context_id)
          REFERENCES fulfillment_contexts (tenant_id, id),
        FOREIGN KEY (tenant_id, source_system_id)
          REFERENCES source_systems (tenant_id, id),
        FOREIGN KEY (tenant_id, source_document_id)
          REFERENCES source_documents (tenant_id, id),
        FOREIGN KEY (tenant_id, entity_id)
          REFERENCES business_entities (tenant_id, id),
        FOREIGN KEY (tenant_id, event_id)
          REFERENCES fulfillment_events (tenant_id, id)
      );

      CREATE INDEX IF NOT EXISTS fulfillment_events_context_time_idx
        ON fulfillment_events (tenant_id, context_id, occurred_at, recorded_at, id);
      CREATE INDEX IF NOT EXISTS v2_evidence_context_time_idx
        ON v2_evidence (tenant_id, context_id, observed_at, created_at, id);
      CREATE INDEX IF NOT EXISTS source_documents_context_idx
        ON source_documents (tenant_id, context_id, received_at, id);
    `,
  },
  {
    version: "002_rule_engine",
    sql: `
      CREATE TABLE IF NOT EXISTS rule_definitions (
        tenant_id TEXT NOT NULL,
        id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        exception_type TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, code)
      );

      CREATE TABLE IF NOT EXISTS rule_versions (
        tenant_id TEXT NOT NULL,
        id TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        version TEXT NOT NULL,
        status TEXT NOT NULL,
        config_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, rule_id, version),
        FOREIGN KEY (tenant_id, rule_id)
          REFERENCES rule_definitions (tenant_id, id)
      );

      CREATE TABLE IF NOT EXISTS rule_evaluations (
        tenant_id TEXT NOT NULL,
        id TEXT NOT NULL,
        context_id TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        rule_version_id TEXT NOT NULL,
        status TEXT NOT NULL,
        observations_json TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        match_key TEXT NOT NULL,
        evaluated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, context_id, rule_version_id, input_hash),
        FOREIGN KEY (tenant_id, context_id)
          REFERENCES fulfillment_contexts (tenant_id, id),
        FOREIGN KEY (tenant_id, rule_id)
          REFERENCES rule_definitions (tenant_id, id),
        FOREIGN KEY (tenant_id, rule_version_id)
          REFERENCES rule_versions (tenant_id, id)
      );

      CREATE TABLE IF NOT EXISTS exceptions (
        tenant_id TEXT NOT NULL,
        id TEXT NOT NULL,
        context_id TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        rule_version_id TEXT NOT NULL,
        rule_evaluation_id TEXT NOT NULL,
        exception_type TEXT NOT NULL,
        status TEXT NOT NULL,
        match_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, rule_evaluation_id, exception_type),
        FOREIGN KEY (tenant_id, context_id)
          REFERENCES fulfillment_contexts (tenant_id, id),
        FOREIGN KEY (tenant_id, rule_id)
          REFERENCES rule_definitions (tenant_id, id),
        FOREIGN KEY (tenant_id, rule_version_id)
          REFERENCES rule_versions (tenant_id, id),
        FOREIGN KEY (tenant_id, rule_evaluation_id)
          REFERENCES rule_evaluations (tenant_id, id)
      );

      CREATE TABLE IF NOT EXISTS exception_evidence (
        tenant_id TEXT NOT NULL,
        exception_id TEXT NOT NULL,
        evidence_id TEXT NOT NULL,
        PRIMARY KEY (tenant_id, exception_id, evidence_id),
        FOREIGN KEY (tenant_id, exception_id)
          REFERENCES exceptions (tenant_id, id),
        FOREIGN KEY (tenant_id, evidence_id)
          REFERENCES v2_evidence (tenant_id, id)
      );

      CREATE TABLE IF NOT EXISTS exception_entities (
        tenant_id TEXT NOT NULL,
        exception_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        PRIMARY KEY (tenant_id, exception_id, entity_id),
        FOREIGN KEY (tenant_id, exception_id)
          REFERENCES exceptions (tenant_id, id),
        FOREIGN KEY (tenant_id, entity_id)
          REFERENCES business_entities (tenant_id, id)
      );

      CREATE INDEX IF NOT EXISTS rule_evaluations_context_idx
        ON rule_evaluations (tenant_id, context_id, evaluated_at, id);
      CREATE INDEX IF NOT EXISTS exceptions_context_idx
        ON exceptions (tenant_id, context_id, created_at, id);
    `,
  },
];

export function runV2Migrations(
  db: SqliteDatabaseLike,
  migrations: SqliteMigration[] = V2_MIGRATIONS,
): string[] {
  const versions = new Set<string>();
  for (const migration of migrations) {
    if (versions.has(migration.version)) throw new Error(`MIGRATION_VERSION_DUPLICATE:${migration.version}`);
    versions.add(migration.version);
  }
  db.exec("PRAGMA foreign_keys = ON; CREATE TABLE IF NOT EXISTS v2_schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
  const applied = new Set(
    (db.prepare("SELECT version FROM v2_schema_migrations").all() as Array<{ version: string }>).map((row) => row.version),
  );
  const pending = migrations
    .filter((migration) => !applied.has(migration.version))
    .sort((left, right) => left.version.localeCompare(right.version));

  for (const migration of pending) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO v2_schema_migrations (version, applied_at) VALUES (?, ?)").run(migration.version, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* preserve the original migration failure */ }
      throw error;
    }
  }
  return pending.map((migration) => migration.version);
}
