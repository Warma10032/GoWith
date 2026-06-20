import { apiBaseUrl } from "./api";

export async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
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
