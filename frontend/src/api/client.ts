export type ApiIdentity = {
  tenantId: string;
  actorId: string;
};

export type ApiRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  identity: ApiIdentity;
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly payload: unknown,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

function authHeaders(identity: ApiIdentity, hasBody: boolean) {
  const headers: Record<string, string> = { accept: "application/json" };
  const token = window.localStorage.getItem("authToken") || window.sessionStorage.getItem("authToken");
  if (token) {
    headers.authorization = `Bearer ${token}`;
  } else {
    headers["x-tenant-id"] = identity.tenantId;
    headers["x-actor"] = identity.actorId;
  }
  if (hasBody) headers["content-type"] = "application/json";
  return headers;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions): Promise<T> {
  const method = options.method ?? "GET";
  const hasBody = options.body !== undefined;
  const response = await fetch(path, {
    method,
    headers: authHeaders(options.identity, hasBody),
    ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const code = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error: unknown }).error)
      : `http_${response.status}`;
    throw new ApiError(response.status, code, payload);
  }
  return payload as T;
}
