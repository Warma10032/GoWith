"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { SafeImage } from "./safe-image";
import { CREATOR_STATUS_LABELS, lookupLabel } from "@/lib/labels";

interface CreatorListItem {
  id: string;
  bilibili_uid: string;
  name: string;
  avatar_url?: string | null;
  profile_url: string;
  bio?: string | null;
  follower_count?: number | null;
  status: string;
  shop_count: number;
}

interface CreatorListClientProps {
  creators: CreatorListItem[];
}

/**
 * 客户端搜索过滤 + 渲染。Server component 已按 follower_count desc 排序，
 * 这里再做 name / bio / bilibili_uid 的子串匹配。
 */
export function CreatorListClient({ creators }: CreatorListClientProps) {
  const [keyword, setKeyword] = useState("");

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return creators;
    return creators.filter((creator) => {
      const fields = [
        creator.name,
        creator.bio ?? "",
        creator.bilibili_uid,
      ].map((field) => field.toLowerCase());
      return fields.some((field) => field.includes(q));
    });
  }, [creators, keyword]);

  return (
    <>
      <div className="mt-6 rounded-lg border border-line bg-white p-4">
        <label className="block">
          <span className="sr-only">搜索博主</span>
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索博主名 / 简介 / UID"
              className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-9 text-sm focus:border-brand focus:outline-none"
            />
            {keyword ? (
              <button
                type="button"
                onClick={() => setKeyword("")}
                className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-[#f4efe7]"
                aria-label="清除搜索"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        </label>
        <p className="mt-2 text-xs text-muted">
          {keyword
            ? `匹配 ${filtered.length} / ${creators.length} 位博主`
            : `共 ${creators.length} 位博主`}
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">
          没有匹配「{keyword}」的博主。试试别的关键字，或
          <button
            type="button"
            onClick={() => setKeyword("")}
            className="ml-1 text-brand hover:underline"
          >
            清空搜索
          </button>
          。
        </div>
      ) : (
        <ul className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((creator) => (
            <li key={creator.id}>
              <Link
                href={`/creators/${creator.id}`}
                className="flex h-full gap-3 rounded-lg border border-line bg-white p-4 transition hover:border-brand hover:shadow-card"
              >
                {creator.avatar_url ? (
                  <SafeImage
                    src={creator.avatar_url}
                    alt=""
                    className="size-16 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="grid size-16 shrink-0 place-items-center rounded-lg bg-[#f7efe8] text-xl font-semibold text-muted">
                    {creator.name.slice(0, 1)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="line-clamp-1 font-semibold">
                      {creator.name}
                    </h2>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        creator.status === "active"
                          ? "bg-[#dff5e7] text-[#1a7a3d]"
                          : "bg-[#f1f3f6] text-[#5a6776]"
                      }`}
                    >
                      {lookupLabel(CREATOR_STATUS_LABELS, creator.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    UID {creator.bilibili_uid}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    粉丝 {creator.follower_count?.toLocaleString() ?? "—"}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    已发布店铺{" "}
                    <span className="font-semibold text-ink">
                      {creator.shop_count}
                    </span>
                  </p>
                  {creator.bio ? (
                    <p className="mt-2 line-clamp-2 text-xs text-ink/80">
                      {creator.bio}
                    </p>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
