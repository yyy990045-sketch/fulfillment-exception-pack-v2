import type { V2SqliteStore } from "../../domain/v2/index.js";
import { applyDomainWritePlan } from "./domain-plan.js";
import { parseOpenSupOSUnsEnvelope } from "./envelope.js";
import { mapUnsEnvelopeToDomainPlan } from "./mapper.js";
import { buildUnsTopic, parseUnsTopic } from "./topic-mapper.js";
import { OpenSupOSIntegrationError, type OpenSupOSInboundResult } from "./types.js";

export class OpenSupOSAdapter {
  constructor(private readonly store: V2SqliteStore) {}

  ingest(topic: string, payload: string | unknown): OpenSupOSInboundResult {
    const topicParts = parseUnsTopic(topic);
    const envelope = parseOpenSupOSUnsEnvelope(payload);
    if (
      topicParts.tenantKey !== envelope.tenantKey ||
      topicParts.contextBusinessKey !== envelope.context.businessKey ||
      topicParts.entityType !== envelope.entity.entityType ||
      topicParts.entityBusinessKey !== envelope.entity.businessKey ||
      topicParts.eventType !== envelope.event.eventType
    ) throw new OpenSupOSIntegrationError("INVALID_UNS_TOPIC", "topic envelope mismatch");

    const plan = mapUnsEnvelopeToDomainPlan(envelope);
    const duplicated = Boolean(this.store.getEventByIdempotency(plan.event.tenantId, plan.event.sourceSystemId, plan.event.idempotencyKey));
    applyDomainWritePlan(this.store, plan);
    return {
      messageId: envelope.messageId,
      contextId: plan.context.id,
      entityId: plan.businessEntity.id,
      eventId: plan.event.id,
      evidenceIds: plan.evidence.map((item) => item.id),
      duplicated,
    };
  }
}

export { buildUnsTopic };
