import Link from "next/link";
import { Compass, MapPinned, Search } from "lucide-react";
import { TopNav } from "@/components/top-nav";

/**
 * 全局 404。覆盖三种来源：
 * - 用户输入错误的 URL
 * - 详情页参数不是 UUID（已在 page.tsx 内早返回，但作为兜底）
 * - 其他未显式处理的 notFound() 调用
 */
export default function NotFoundPage() {
  return (
    <main>
      <TopNav />
      <section className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand">
          404
        </p>
        <h1 className="mt-2 text-2xl font-semibold">页面不存在</h1>
        <p className="mt-3 text-sm leading-7 text-muted">
          你访问的链接可能已下架，或 URL 不正确。可以从下面的入口继续逛。
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Link
            href="/"
            className="flex flex-col items-center gap-2 rounded-lg border border-line bg-white p-4 text-sm hover:border-brand hover:text-brand"
          >
            <Compass size={20} />
            推荐首页
          </Link>
          <Link
            href="/map"
            className="flex flex-col items-center gap-2 rounded-lg border border-line bg-white p-4 text-sm hover:border-brand hover:text-brand"
          >
            <MapPinned size={20} />
            全国地图
          </Link>
          <Link
            href="/creators"
            className="flex flex-col items-center gap-2 rounded-lg border border-line bg-white p-4 text-sm hover:border-brand hover:text-brand"
          >
            <Search size={20} />
            博主列表
          </Link>
        </div>
      </section>
    </main>
  );
}
