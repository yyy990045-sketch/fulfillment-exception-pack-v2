import { createHash, randomUUID } from "node:crypto";
import type {
  ConnectorSyncErrorClass,
  ConnectorSyncRunRecord,
  ConnectorSyncStateRecord,
  V2SqliteStore,
} from "../../domain/v2/index.js";
import { EnvironmentSecretResolver, type SecretResolver } from "./secrets.js";
import {
  ConnectorError,
  type AdaptedSourceRecord,
  type InboundConnector,
  type SourceAdapter,
  type SourceRecordEnvelope,
} from "./types.js";

export type RunInboundSyncInput = {
  tenantId: string;
  connectorInstallationId: string;
  recordType: string;
  mappingId: string;
  mappingVersion: string;
  adapter: SourceAdapter;
  cursor?: string | null;
  pageSize?: number;
  maxPages?: number;
  maxRecords?: number;
  runId?: string;
  secretResolver?: SecretResolver;
  now?: () => Date;
  afterPageCommit?: (input: {
    contextIds: string[];
    accepted: AdaptedSourceRecord[];
    committedCursor: string | null;
  }) => void | Promise<void>;
  beforeFinalize?: () => void | Promise<void>;
};

export type InboundSyncResult = {
  run: ConnectorSyncRunRecord;
  state: ConnectorSyncStateRecord;
  accepted: AdaptedSourceRecord[];
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function connectorRawHash(payload: Record<string, unknown>) {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export function canAdvanceInboundCursor(input: {
  recordsRejected: number;
  downstreamPending: number;
}) {
  return input.recordsRejected === 0 && input.downstreamPending === 0;
}

function errorClassification(error: unknown): {
  code: string;
  errorClass: ConnectorSyncErrorClass;
  retryAfterMs?: number;
} {
  const code = error instanceof ConnectorError ? error.code : "NETWORK_ERROR";
  const retryable = error instanceof ConnectorError
    ? error.options.retryable ?? ["RATE_LIMITED", "TIMEOUT", "NETWORK_ERROR"].includes(code)
    : true;
  if (retryable) {
    return {
      code,
      errorClass: "retryable",
      ...(error instanceof ConnectorError && error.options.retryAfterMs !== undefined
        ? { retryAfterMs: error.options.retryAfterMs }
        : {}),
    };
  }
  if (["AUTHENTICATION_FAILED", "PERMISSION_DENIED", "INVALID_RESPONSE", "MAPPING_FAILED", "CURSOR_INVALID", "CONNECTOR_NOT_FOUND"].includes(code)) {
    return { code, errorClass: "blocked" };
  }
  return { code, errorClass: "permanent" };
}

function canonicalRefs(adapted: AdaptedSourceRecord) {
  return [
    ...adapted.entities.map((item) => `entity:${item.id}`),
    ...adapted.events.map((item) => `event:${item.id}`),
  ];
}

export async function runInboundSync(
  store: V2SqliteStore,
  connector: InboundConnector,
  input: RunInboundSyncInput,
): Promise<InboundSyncResult> {
  const clock = input.now ?? (() => new Date());
  const installation = store.getConnectorInstallation(input.tenantId, input.connectorInstallationId);
  if (!installation || installation.connectorId !== connector.manifest.id || installation.status !== "active") {
    throw new ConnectorError("CONNECTOR_NOT_FOUND", 404, { retryable: false });
  }
  if (installation.connectorVersion !== connector.manifest.version) {
    throw new ConnectorError("CONNECTOR_NOT_FOUND", 409, { retryable: false });
  }
  const mapping = store.getConnectorMappingVersion(
    input.tenantId,
    connector.manifest.id,
    input.mappingId,
    input.mappingVersion,
  );
  if (!mapping) throw new ConnectorError("MAPPING_FAILED", 409, { retryable: false });

  const existingState = store.getConnectorSyncState(input.tenantId, installation.id, input.recordType);
  const cursor = input.cursor === undefined ? existingState?.lastSuccessfulCursor ?? null : input.cursor;
  const startedAt = clock().toISOString();
  const runId = input.runId ?? `sync-${randomUUID()}`;
  const maxPages = input.maxPages ?? 10;
  const maxRecords = input.maxRecords ?? 1_000;
  const pageSize = input.pageSize ?? 100;
  let run = store.saveConnectorSyncRun({
    tenantId: input.tenantId,
    id: runId,
    connectorInstallationId: installation.id,
    connectorId: connector.manifest.id,
    recordType: input.recordType,
    status: "running",
    startedAt,
    completedAt: null,
    recordsRead: 0,
    recordsCommitted: 0,
    recordsAccepted: 0,
    recordsRejected: 0,
    recordsDuplicate: 0,
    attemptedCursor: cursor,
    committedCursor: cursor,
    mappingId: input.mappingId,
    mappingVersion: input.mappingVersion,
  });
  let state = store.saveConnectorSyncState({
    tenantId: input.tenantId,
    connectorInstallationId: installation.id,
    recordType: input.recordType,
    lastSuccessfulCursor: existingState?.lastSuccessfulCursor ?? null,
    lastAttemptedCursor: cursor,
    updatedAt: startedAt,
  });

  const accepted: AdaptedSourceRecord[] = [];
  let currentCursor = cursor;
  let pages = 0;
  try {
    const secret = installation.secretRef
      ? (input.secretResolver ?? new EnvironmentSecretResolver()).resolve(installation.secretRef)
      : undefined;
    while (pages < maxPages) {
      pages += 1;
      const page = await connector.readPage({
        installation,
        cursor: currentCursor,
        pageSize,
        ...(secret ? { secret } : {}),
        now: clock,
      });
      const nextCursor = page.nextCursor;
      if (page.hasMore && nextCursor === currentCursor) {
        throw new ConnectorError("CURSOR_INVALID", 409, { retryable: false });
      }
      const pageAccepted: AdaptedSourceRecord[] = [];
      const pageContextIds = new Set<string>();
      const pageLedgerIds = new Set<string>();
      let pageRead = 0;
      let pageCommitted = 0;
      let pageRejected = 0;
      let pageDuplicate = 0;

      for (const record of page.records) {
        if (run.recordsRead + pageRead >= maxRecords) {
          throw new ConnectorError("RECORD_LIMIT_EXCEEDED", 409, { retryable: false });
        }
        pageRead += 1;
        const observedAt = record.observedAt ?? page.observedAt ?? clock().toISOString();
        const rawHash = connectorRawHash(record.payload);
        const exact = store.findConnectorSourceRecordExact({
          tenantId: input.tenantId,
          connectorInstallationId: installation.id,
          recordType: record.recordType,
          externalRecordId: record.externalRecordId,
          sourceVersion: record.sourceVersion,
          rawHash,
          mappingId: input.mappingId,
          mappingVersion: input.mappingVersion,
        });
        if (exact) {
          pageDuplicate += 1;
          const updated = store.saveConnectorSourceRecord({
            ...exact,
            lastSeenAt: observedAt,
          });
          if (!updated.downstreamProcessedAt) {
            pageLedgerIds.add(updated.id);
            for (const evidenceId of updated.evidenceRefs) {
              const evidence = store.getEvidence(input.tenantId, evidenceId);
              if (evidence) pageContextIds.add(evidence.contextId);
            }
          }
          continue;
        }
        const envelope: SourceRecordEnvelope = {
          tenantId: input.tenantId,
          connectorId: connector.manifest.id,
          connectorInstallationId: installation.id,
          externalRecordId: record.externalRecordId,
          recordType: record.recordType,
          occurredAt: record.occurredAt,
          observedAt,
          sourceVersion: record.sourceVersion,
          locator: record.locator ?? {},
          rawHash,
          mappingId: input.mappingId,
          mappingVersion: input.mappingVersion,
          payload: record.payload,
        };
        let adapted: AdaptedSourceRecord;
        try {
          adapted = input.adapter.adapt(envelope);
        } catch {
          pageRejected += 1;
          continue;
        }
        try {
          let sourceRecordId = "";
          store.transaction(() => {
            for (const sourceSystem of adapted.sourceSystems) store.saveSourceSystem(sourceSystem);
            for (const entity of adapted.entities) store.saveBusinessEntity(entity);
            for (const document of adapted.sourceDocuments) store.saveSourceDocument(document);
            for (const event of adapted.events) store.appendEvent(event);
            for (const evidence of adapted.evidence) store.saveEvidence(evidence);
            const sourceRecord = store.saveConnectorSourceRecord({
              tenantId: input.tenantId,
              id: `source-${installation.id}-${connectorRawHash({
                externalRecordId: record.externalRecordId,
                sourceVersion: record.sourceVersion,
                rawHash,
                mappingId: input.mappingId,
                mappingVersion: input.mappingVersion,
              })}`,
              connectorId: connector.manifest.id,
              connectorInstallationId: installation.id,
              recordType: record.recordType,
              externalRecordId: record.externalRecordId,
              sourceVersion: record.sourceVersion,
              rawHash,
              locator: envelope.locator,
              observedAt,
              mappingId: input.mappingId,
              mappingVersion: input.mappingVersion,
              firstSeenAt: observedAt,
              lastSeenAt: observedAt,
              canonicalCommittedAt: observedAt,
              downstreamProcessedAt: null,
              canonicalRefs: canonicalRefs(adapted),
              evidenceRefs: adapted.evidence.map((item) => item.id),
            });
            sourceRecordId = sourceRecord.id;
          });
          pageLedgerIds.add(sourceRecordId);
        } catch {
          throw new ConnectorError("CANONICAL_COMMIT_FAILED", 500, { retryable: true });
        }
        pageCommitted += 1;
        pageContextIds.add(adapted.contextId);
        pageAccepted.push(adapted);
      }

      const attemptedCursor = nextCursor ?? currentCursor;
      const committedCursor = state.lastSuccessfulCursor;
      run = store.saveConnectorSyncRun({
        ...run,
        recordsRead: run.recordsRead + pageRead,
        recordsCommitted: run.recordsCommitted + pageCommitted,
        recordsAccepted: run.recordsAccepted + pageCommitted,
        recordsRejected: run.recordsRejected + pageRejected,
        recordsDuplicate: run.recordsDuplicate + pageDuplicate,
        attemptedCursor,
        committedCursor,
        providerRequestId: page.providerRequestId ?? run.providerRequestId,
      });
      state = store.saveConnectorSyncState({
        ...state,
        lastSuccessfulCursor: state.lastSuccessfulCursor,
        lastAttemptedCursor: attemptedCursor,
        updatedAt: clock().toISOString(),
      });
      currentCursor = attemptedCursor;

      if (pageRejected > 0) {
        throw new ConnectorError("RECORD_REJECTED", 422, { retryable: false });
      }

      await input.afterPageCommit?.({
        contextIds: [...pageContextIds],
        accepted: pageAccepted,
        committedCursor: attemptedCursor,
      });
      await input.beforeFinalize?.();
      store.markConnectorSourceRecordsDownstreamProcessed(
        input.tenantId,
        [...pageLedgerIds],
        clock().toISOString(),
      );
      if (!canAdvanceInboundCursor({ recordsRejected: pageRejected, downstreamPending: 0 })) {
        throw new ConnectorError("RECORD_REJECTED", 422, { retryable: false });
      }

      accepted.push(...pageAccepted);
      state = store.saveConnectorSyncState({
        ...state,
        lastSuccessfulCursor: attemptedCursor,
        lastAttemptedCursor: attemptedCursor,
        updatedAt: clock().toISOString(),
      });
      if (!page.hasMore) {
        run = store.saveConnectorSyncRun({
          ...run,
          status: "succeeded",
          completedAt: clock().toISOString(),
        });
        return { run, state, accepted };
      }
    }
    throw new ConnectorError("PAGE_LIMIT_EXCEEDED", 409, { retryable: false });
  } catch (error) {
    const classified = errorClassification(error);
    state = store.saveConnectorSyncState({
      ...state,
      lastAttemptedCursor: currentCursor,
      updatedAt: clock().toISOString(),
    });
    run = store.saveConnectorSyncRun({
      ...run,
      status: classified.errorClass === "blocked" ? "blocked" : "failed",
      completedAt: clock().toISOString(),
      attemptedCursor: currentCursor,
      committedCursor: state.lastSuccessfulCursor,
      lastErrorCode: classified.code,
      errorClass: classified.errorClass,
      ...(classified.retryAfterMs !== undefined ? { retryAfterMs: classified.retryAfterMs } : {}),
    });
    return { run, state, accepted };
  }
}
