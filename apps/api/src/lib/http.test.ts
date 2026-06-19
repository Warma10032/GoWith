import type { FastifyReply } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ZodError, z } from "zod";
import { HttpError, sendError } from "./http";

/**
 * 构造一个最小可用的 FastifyReply mock。
 * sendError 内部仅调用 reply.status(code).send(payload)，两个方法都返回 reply。
 */
function makeReply(): FastifyReply & {
  status: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
} {
  const reply = {
    status: vi.fn(),
    send: vi.fn(),
  };
  reply.status.mockReturnValue(reply);
  reply.send.mockReturnValue(reply);
  // FastifyReply 实际有 30+ 属性；测试只断言 status/send 两个调用。
  return reply as unknown as FastifyReply & {
    status: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
}

describe("sendError", () => {
  it("HttpError 用业务约定的 statusCode + envelope", () => {
    const reply = makeReply();
    sendError(
      reply,
      new HttpError(404, "shop_not_found", "Shop not found", { id: "abc" }),
    );

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({
      error: {
        code: "shop_not_found",
        message: "Shop not found",
        details: { id: "abc" },
      },
    });
  });

  it("HttpError 不带 details 时省略字段", () => {
    const reply = makeReply();
    sendError(reply, new HttpError(400, "invalid_input", "bad uuid"));

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({
      error: {
        code: "invalid_input",
        message: "bad uuid",
        details: undefined,
      },
    });
  });

  it("ZodError 归一为 400 validation_error 并把 issues 放进 details", () => {
    const reply = makeReply();
    let captured: unknown;
    try {
      z.object({ id: z.string().uuid() }).parse({ id: "not-a-uuid" });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(ZodError);

    sendError(reply, captured);

    expect(reply.status).toHaveBeenCalledWith(400);
    const payload = reply.send.mock.calls[0]?.[0] as {
      error: { code: string; message: string; details: { issues: unknown[] } };
    };
    expect(payload.error.code).toBe("validation_error");
    expect(payload.error.message).toMatch(/schema validation/i);
    expect(Array.isArray(payload.error.details.issues)).toBe(true);
    expect(payload.error.details.issues.length).toBeGreaterThan(0);
  });

  it("普通 Error 归一为 500 internal_error 并暴露 message", () => {
    const reply = makeReply();
    sendError(reply, new Error("db connection refused"));

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({
      error: {
        code: "internal_error",
        message: "db connection refused",
      },
    });
  });

  it("非 Error 抛出（如字符串、对象）也归一为 500", () => {
    const reply1 = makeReply();
    sendError(reply1, "boom");
    expect(reply1.status).toHaveBeenCalledWith(500);
    expect(reply1.send).toHaveBeenCalledWith({
      error: { code: "internal_error", message: "Unknown error" },
    });

    const reply2 = makeReply();
    sendError(reply2, { weird: "object" });
    expect(reply2.status).toHaveBeenCalledWith(500);
    expect(reply2.send).toHaveBeenCalledWith({
      error: { code: "internal_error", message: "Unknown error" },
    });
  });
});

describe("HttpError", () => {
  it("保留构造时的 statusCode / code / message", () => {
    const err = new HttpError(403, "forbidden", "nope");
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("forbidden");
    expect(err.message).toBe("nope");
  });
});
