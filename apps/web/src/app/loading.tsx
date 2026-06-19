import { Loader2 } from "lucide-react";
import { TopNav } from "@/components/top-nav";

/**
 * 全局 loading 占位。Next.js App Router 在 server component 渲染期间
 * 会把这个组件作为 Suspense fallback 渲染。每个页面的初次访问都会先看到这个。
 */
export default function GlobalLoading() {
  return (
    <main>
      <TopNav />
      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[280px_1fr]">
        <aside className="h-fit rounded-lg border border-line bg-white p-4">
          <div className="h-6 w-24 rounded bg-[#f1ece4]" />
          <div className="mt-3 h-4 w-40 rounded bg-[#f4efe7]" />
          <div className="mt-6 space-y-3">
            <div className="h-9 rounded-lg bg-[#f4efe7]" />
            <div className="h-9 rounded-lg bg-[#f4efe7]" />
          </div>
        </aside>
        <section className="space-y-4">
          <div className="flex items-center gap-3 text-muted">
            <Loader2 size={18} className="animate-spin text-brand" />
            <span className="text-sm font-medium">正在加载内容…</span>
          </div>
          <div className="space-y-3">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="flex gap-4 rounded-lg border border-line bg-white p-4 shadow-card"
              >
                <div className="size-24 shrink-0 rounded-lg bg-[#f4efe7]" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-5 w-1/3 rounded bg-[#f4efe7]" />
                  <div className="h-4 w-2/3 rounded bg-[#f4efe7]" />
                  <div className="h-4 w-1/2 rounded bg-[#f4efe7]" />
                </div>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
