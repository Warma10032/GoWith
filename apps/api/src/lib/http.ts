import type { FastifyReply } from "fastify";
import { ZodError } from "zod";

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
 * - 其他：500 internal_error，并把 message 上抛，便于日志反查
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
        details: { issues: error.issues },
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
