import type { FastifyReply } from "fastify";
import { ZodError } from "zod";
import { env } from "./env";

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * 统一错误响应 envelope：{ error: { code, message, details? } }。
 *
 * - HttpError：用业务约定的 statusCode + code
 * - ZodError：归一为 400 validation_error，并把 issues 折叠到 details
 * - 其他：500 internal_error
 *   - dev: 把 message 上抛便于排查
 *   - prod: 只返回固定 "Internal server error" 字符串，详细错误只走结构化日志
 */
export function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof HttpError) {
    return reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
  }

  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: {
        code: "validation_error",
        message: "Request payload failed schema validation",
        details: env.isProduction
          ? undefined
          : { issues: error.issues },
      },
    });
  }

  // 未知错误：P1-1 生产环境脱敏。
  if (env.isProduction) {
    if (reply.log && typeof reply.log.error === "function") {
      reply.log.error({ err: error }, "internal_error");
    }
    return reply.status(500).send({
      error: {
        code: "internal_error",
        message: "Internal server error",
      },
    });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return reply.status(500).send({
    error: {
      code: "internal_error",
      message,
    },
  });
}
