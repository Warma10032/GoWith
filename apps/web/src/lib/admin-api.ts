import { apiBaseUrl } from "./api";

const CSRF_COOKIE_NAME = "gowith_csrf";
const CSRF_HEADER_NAME = "x-csrf-token";

/**
 * 读取浏览器上的非 httpOnly cookie (gowith_csrf)。该 cookie 由后端
 * 登录后下发，前端读取后写进 X-CSRF-Token 头。所有非 GET / HEAD / OPTIONS
 * 的 /api/admin/** 请求都必须带这个头。
 */
function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith(`${CSRF_COOKIE_NAME}=`)) {
      return decodeURIComponent(trimmed.slice(CSRF_COOKIE_NAME.length + 1));
    }
  }
  return null;
}

function isSafeMethod(method: string | undefined): boolean {
  if (!method) return true;
  const upper = method.toUpperCase();
  return upper === "GET" || upper === "HEAD" || upper === "OPTIONS";
}

export async function adminFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    ...(init?.body ? { "content-type": "application/json" } : {}),
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  // P0-3: 自动把 cookie 中的 CSRF token 加到写操作请求头。
  if (!isSafeMethod(method)) {
    const token = readCsrfToken();
    if (token) {
      headers[CSRF_HEADER_NAME] = token;
    }
  }
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    method,
    credentials: "include",
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string; code?: string };
    } | null;
    throw new Error(
      payload?.error?.message ?? payload?.error?.code ?? `Request failed: ${response.status}`,
    );
  }
  return (await response.json()) as T;
}

export interface TaskAcceptedResponse {
  run_id: string;
  job_id: string | null;
  run_type: string;
  entity_type: string;
  entity_id: string;
  status: "queued" | "running";
}

export function isTaskAccepted(value: unknown): value is TaskAcceptedResponse {
  return Boolean(
    value && typeof value === "object" && "run_id" in value && typeof value.run_id === "string",
  );
}
