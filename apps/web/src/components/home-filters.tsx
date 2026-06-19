"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Compass, MapPin, UserRound } from "lucide-react";

/**
 * 首页左侧筛选区。提交后跳转到 /map 并把 city/creator_id 作为 query 透传，
 * 由地图页和 /api/shops/map 处理。M1 后端接 city 字段时再在地图页联通。
 */
export function HomeFilters({
  initialCity = "",
  initialCreator = "",
}: {
  initialCity?: string;
  initialCreator?: string;
}) {
  const router = useRouter();
  const [city, setCity] = useState(initialCity);
  const [creator, setCreator] = useState(initialCreator);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (city.trim()) params.set("city", city.trim());
    if (creator.trim()) params.set("creator_id", creator.trim());
    const query = params.toString();
    router.push(query ? `/map?${query}` : "/map");
  }

  function clearAll() {
    setCity("");
    setCreator("");
    router.push("/");
  }

  return (
    <aside className="h-fit rounded-lg border border-line bg-white p-4">
      <h1 className="text-xl font-semibold">推荐店铺</h1>
      <p className="mt-2 text-sm leading-6 text-muted">
        以 B站探店博主为索引，展示已审核店铺卡片、视频来源和 AI 证据链。
      </p>
      <form className="mt-5 space-y-3 text-sm" onSubmit={handleSubmit}>
        <label className="block">
          <span className="mb-1 flex items-center gap-1 text-xs font-medium text-muted">
            <MapPin size={12} />
            城市
          </span>
          <input
            value={city}
            onChange={(event) => setCity(event.target.value)}
            className="w-full rounded-lg border border-line px-3 py-2"
            placeholder="上海 / 北京 / 成都"
            name="city"
          />
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-1 text-xs font-medium text-muted">
            <UserRound size={12} />
            博主 UID 或昵称
          </span>
          <input
            value={creator}
            onChange={(event) => setCreator(event.target.value)}
            className="w-full rounded-lg border border-line px-3 py-2"
            placeholder="例：3546888255048212"
            name="creator"
          />
        </label>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="submit"
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white"
          >
            <Compass size={13} />
            在地图上查看
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-brand hover:text-brand"
          >
            清空
          </button>
        </div>
      </form>
    </aside>
  );
}
