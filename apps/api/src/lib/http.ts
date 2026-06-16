import type { FastifyReply } from "fastify";

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

  const message = error instanceof Error ? error.message : "Unknown error";
  return reply.status(500).send({
    error: {
      code: "internal_error",
      message,
    },
  });
}

