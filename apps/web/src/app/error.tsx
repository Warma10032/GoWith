"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { TopNav } from "@/components/top-nav";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * 全局错误边界。未捕获的 throw（渲染或 server component）会落到这里。
 * 服务端错误带 digest，可在日志里反查对应请求。
 */
export default function GlobalError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // 上报到控制台即可；M1 接 Sentry / OTel 时把这里换成 logger。
    // eslint-disable-next-line no-console
    console.error("[gowith:error-boundary]", error.message, error.digest);
  }, [error]);

  return (
    <main>
      <TopNav />
      <section className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-[#fff1ee] text-[#9a341f]">
          <AlertTriangle size={24} />
        </div>
        <h1 className="mt-5 text-2xl font-semibold">页面出错了</h1>
        <p className="mt-3 text-sm leading-7 text-muted">
          我们已经记录这次错误。可以尝试刷新页面，或回到首页继续浏览。
        </p>
        {error.digest ? (
          <p className="mt-2 text-xs text-muted">错误编号：{error.digest}</p>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
          >
            <RotateCcw size={16} />
            重试
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold hover:border-brand hover:text-brand"
          >
            回到首页
          </Link>
        </div>
      </section>
    </main>
  );
}
