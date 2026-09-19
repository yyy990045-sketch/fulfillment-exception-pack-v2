import { ConnectorError, type InboundConnector, type InboundReadPageInput, type InboundReadPageResult } from "../core/types.js";
import { REFERENCE_INBOUND_HTTP_MANIFEST } from "./manifest.js";
import { validateReferenceInboundConfig } from "./validator.js";

function retryAfterMs(headers: Headers) {
  const value = headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined;
}

function parsePage(body: unknown): InboundReadPageResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ConnectorError("INVALID_RESPONSE", 422, { retryable: false });
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.records) || typeof record.hasMore !== "boolean" || !(record.nextCursor === null || typeof record.nextCursor === "string")) {
    throw new ConnectorError("INVALID_RESPONSE", 422, { retryable: false });
  }
  const records = record.records.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ConnectorError("INVALID_RESPONSE", 422, { retryable: false });
    const value = item as Record<string, unknown>;
    if (
      typeof value.externalRecordId !== "string" ||
      typeof value.recordType !== "string" ||
      typeof value.occurredAt !== "string" ||
      typeof value.sourceVersion !== "string" ||
      !value.payload ||
      typeof value.payload !== "object" ||
      Array.isArray(value.payload)
    ) {
      throw new ConnectorError("INVALID_RESPONSE", 422, { retryable: false });
    }
    const locator = value.locator;
    if (locator !== undefined && (!locator || typeof locator !== "object" || Array.isArray(locator))) {
      throw new ConnectorError("INVALID_RESPONSE", 422, { retryable: false });
    }
    return {
      externalRecordId: value.externalRecordId,
      recordType: value.recordType,
      occurredAt: value.occurredAt,
      ...(typeof value.observedAt === "string" ? { observedAt: value.observedAt } : {}),
      sourceVersion: value.sourceVersion,
      ...(locator ? { locator: locator as Record<string, unknown> } : {}),
      payload: value.payload as Record<string, unknown>,
    };
  });
  return {
    records,
    nextCursor: record.nextCursor,
    hasMore: record.hasMore,
    ...(typeof record.providerRequestId === "string" ? { providerRequestId: record.providerRequestId } : {}),
    ...(typeof record.observedAt === "string" ? { observedAt: record.observedAt } : {}),
  };
}

export class ReferenceInboundHttpConnector implements InboundConnector {
  readonly manifest = REFERENCE_INBOUND_HTTP_MANIFEST;

  validateConfig(config: Record<string, unknown>) {
    return validateReferenceInboundConfig(config);
  }

  async readPage(input: InboundReadPageInput): Promise<InboundReadPageResult> {
    const config = validateReferenceInboundConfig(input.installation.config);
    const url = new URL(`${config.baseUrl.replace(/\/$/, "")}/records`);
    if (input.cursor) url.searchParams.set("cursor", input.cursor);
    url.searchParams.set("pageSize", String(input.pageSize));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          ...(input.secret ? { authorization: `Bearer ${input.secret}` } : {}),
        },
        signal: controller.signal,
      });
      if (response.status === 429) {
        throw new ConnectorError("RATE_LIMITED", 429, {
          retryable: true,
          ...(retryAfterMs(response.headers) !== undefined ? { retryAfterMs: retryAfterMs(response.headers)! } : {}),
        });
      }
      if (response.status === 401) throw new ConnectorError("AUTHENTICATION_FAILED", 401, { retryable: false });
      if (response.status === 403) throw new ConnectorError("PERMISSION_DENIED", 403, { retryable: false });
      if (response.status >= 500) throw new ConnectorError("NETWORK_ERROR", response.status, { retryable: true });
      if (!response.ok) throw new ConnectorError("INVALID_RESPONSE", response.status, { retryable: false });
      return parsePage(await response.json());
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      if (controller.signal.aborted) throw new ConnectorError("TIMEOUT", 504, { retryable: true });
      throw new ConnectorError("NETWORK_ERROR", 502, { retryable: true });
    } finally {
      clearTimeout(timeout);
    }
  }
}
