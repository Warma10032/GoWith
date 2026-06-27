/**
 * P2-4: 第三方 API key 日志脱敏。
 *
 * 任何要写入日志 / 异常 message / 调试输出的 URL 都应过一遍 redactUrl，
 * 把 query 参数中的敏感字段（key / token / secret / signature / sig / access_token）替换为 ***。
 *
 * 反代日志、异常追踪、第三方抓包通常会记录完整 URL，泄露 query 中的 key。
 * 即使现在没在 log 路径里出现，也建议在 fetch 失败时打码再抛出。
 */

const REDACTED = "***";

const SENSITIVE_PARAM_KEYS = new Set([
  "key",
  "api_key",
  "apikey",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "signature",
  "sig",
  "client_secret",
  "password",
]);

/**
 * 脱敏 URL 中的 query 字符串敏感参数。
 * 失败时（无效 URL）原样返回字符串，避免抛错掩盖真实问题。
 */
export function redactUrl(value: string | URL | undefined | null): string {
  if (!value) return "";
  const text = typeof value === "string" ? value : value.toString();
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return text;
  }
  let mutated = false;
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (SENSITIVE_PARAM_KEYS.has(key.toLowerCase())) {
      parsed.searchParams.set(key, REDACTED);
      mutated = true;
    }
  }
  if (!mutated) return text;
  return parsed.toString();
}

/**
 * 脱敏任意对象中形如 "https://...?key=xxx" 的字符串字段。返回新对象，不修改原对象。
 */
export function redactUrlFields<T extends Record<string, unknown>>(
  input: T,
  fields: (keyof T)[] = ["url", "endpoint"] as (keyof T)[],
): T {
  const result: Record<string, unknown> = { ...input };
  for (const field of fields) {
    const value = result[field as string];
    if (typeof value === "string") {
      result[field as string] = redactUrl(value);
    }
  }
  return result as T;
}
