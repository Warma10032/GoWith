/**
 * AES-256-GCM 加密 / 解密 B站 Cookie 等服务端敏感数据。
 *
 * P2-2: 密文格式升级为 envelope `v1:<key_id>:<base64(iv|tag|ciphertext)>`。
 * 旧格式（纯 base64）依然兼容读取，但写入只走新格式，便于后续 key rotation：
 *
 * 1. 启动时从 env.COOKIE_ENCRYPTION_KEYS 解析多密钥（id1:secret1,id2:secret2）
 * 2. 写入用第一个 key（newest key），其它 key 用于解密历史数据
 * 3. 提供 rotate-cookies 脚本把历史数据批量重加密到最新 key
 * 4. key_id 形如 "k1" / "2026-01" / 任何字符串；只用于识别，不参与密码学
 *
 * 单 key 旧版（env.COOKIE_ENCRYPTION_KEY）作为 active 兼容读取。
 */
import crypto from "node:crypto";
import { env } from "../lib/env";

interface KeyEntry {
  id: string;
  key: Buffer;
}

const ACTIVE_KEY_ID = "active";
const LEGACY_KEY_ID = "legacy";
const ENVELOPE_VERSION = "v1";

const keys: KeyEntry[] = (() => {
  const list: KeyEntry[] = [];
  const multi = process.env.COOKIE_ENCRYPTION_KEYS;
  if (multi && multi.trim()) {
    for (const pair of multi.split(",")) {
      const [id, secret] = pair.split(":");
      if (!id || !secret) continue;
      list.push({ id: id.trim(), key: deriveKey(secret.trim()) });
    }
  }
  if (!list.length) {
    list.push({ id: ACTIVE_KEY_ID, key: deriveKey(env.cookieEncryptionKey) });
  }
  return list;
})();

function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

function findKey(id: string): KeyEntry {
  const key = keys.find((entry) => entry.id === id);
  if (!key) {
    throw new Error(`Unknown encryption key_id: ${id}`);
  }
  return key;
}

function requireKey(index: number): KeyEntry {
  const key = keys[index];
  if (!key) {
    throw new Error("No encryption key configured");
  }
  return key;
}

export function hashToken(token: string): string {
  return crypto
    .createHash("sha256")
    .update(`${env.authSecret}:${token}`)
    .digest("hex");
}

export function encryptSecret(plainText: string): string {
  const key = requireKey(0);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key.key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const body = Buffer.concat([iv, tag, encrypted]).toString("base64");
  return `${ENVELOPE_VERSION}:${key.id}:${body}`;
}

export function decryptSecret(encoded: string): string {
  if (encoded.startsWith(`${ENVELOPE_VERSION}:`)) {
    const [, keyId, body] = encoded.split(":", 3);
    if (!keyId || !body) {
      throw new Error("Malformed ciphertext envelope");
    }
    const key = findKey(keyId);
    return decryptWithKey(body, key.key);
  }
  // 旧格式（纯 base64）兼容读取：用第一个 key 兜底。
  const fallback = requireKey(0);
  return decryptWithKey(encoded, fallback.key);
}

function decryptWithKey(body: string, key: Buffer): string {
  const raw = Buffer.from(body, "base64");
  if (raw.length < 12 + 16) {
    throw new Error("Ciphertext too short");
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}
