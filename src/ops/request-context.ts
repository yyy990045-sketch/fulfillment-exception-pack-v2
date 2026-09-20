/**
 * 每请求上下文（requestId / tenantId / subjectId）。
 *
 * requestId 只用于日志与审计关联，**不是**安全 token：
 * 客户端可以传 `X-Request-ID`，但必须通过格式校验，否则由后端重新生成。
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  requestId: string;
  method?: string;
  path?: string;
  tenantId?: string;
  subjectId?: string;
  roles?: string[];
};

const storage = new AsyncLocalStorage<RequestContext>();

export const REQUEST_ID_HEADER = "x-request-id";
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function isSafeRequestId(value: string) {
  return SAFE_REQUEST_ID.test(value);
}

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** 认证完成后把 tenantId / subjectId 写回当前请求上下文，供日志与审计复用 */
export function annotateRequestContext(patch: Partial<RequestContext>) {
  const context = storage.getStore();
  if (!context) return;
  if (patch.tenantId) context.tenantId = patch.tenantId;
  if (patch.subjectId) context.subjectId = patch.subjectId;
  if (patch.roles) context.roles = patch.roles;
}
