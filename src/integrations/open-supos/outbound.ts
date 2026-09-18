import type { ResolutionCase, V2Exception } from "../../domain/v2/index.js";
import { encodeTopicSegment } from "./topic-mapper.js";

export function buildExceptionUnsTopic(input: {
  tenantKey: string;
  contextBusinessKey: string;
  exceptionCode: string;
  exceptionId: string;
}) {
  return [
    "fulfillment",
    input.tenantKey,
    input.contextBusinessKey,
    "exceptions",
    input.exceptionCode,
    input.exceptionId,
  ].map(encodeTopicSegment).join("/");
}

export function mapExceptionToUnsMessage(exception: V2Exception, contextBusinessKey: string) {
  return {
    topic: buildExceptionUnsTopic({
      tenantKey: exception.tenantId,
      contextBusinessKey,
      exceptionCode: exception.code,
      exceptionId: exception.id,
    }),
    payload: {
      schemaVersion: "1.0",
      messageType: "exception",
      exceptionId: exception.id,
      contextId: exception.contextId,
      contextBusinessKey,
      code: exception.code,
      severity: exception.severity,
      status: exception.status,
      title: exception.title,
      summary: exception.summary,
      metrics: exception.metrics,
      latestRuleEvaluationId: exception.latestRuleEvaluationId,
      detectedAt: exception.createdAt,
      lastDetectedAt: exception.lastDetectedAt,
      metadata: exception.metadata,
    },
  };
}

export function buildResolutionUnsTopic(input: {
  tenantKey: string;
  contextBusinessKey: string;
  caseId: string;
}) {
  return [
    "fulfillment",
    input.tenantKey,
    input.contextBusinessKey,
    "resolution",
    input.caseId,
  ].map(encodeTopicSegment).join("/");
}

export function mapResolutionCaseToUnsMessage(
  resolutionCase: ResolutionCase,
  contextBusinessKey: string,
  sourceChanged?: boolean,
) {
  return {
    topic: buildResolutionUnsTopic({
      tenantKey: resolutionCase.tenantId,
      contextBusinessKey,
      caseId: resolutionCase.id,
    }),
    payload: {
      schemaVersion: "1.0",
      messageType: "resolution_case",
      caseId: resolutionCase.id,
      exceptionId: resolutionCase.exceptionId,
      contextId: resolutionCase.contextId,
      contextBusinessKey,
      status: resolutionCase.status,
      ownerRole: resolutionCase.ownerRole,
      updatedAt: resolutionCase.updatedAt,
      ...(sourceChanged !== undefined ? { sourceChanged } : {}),
    },
  };
}
