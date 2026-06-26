"use client";

import { Compass, LoaderCircle, LocateFixed, MapPin } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiBaseUrl, type ShopCardData } from "@/lib/api";
import {
  getBrowserLocation,
  getCachedBrowserLocation,
  type BrowserLocation,
} from "@/lib/browser-location";
import { ShopCard } from "./shop-card";

type RecommendedPayload = {
  recommendation_request_id: string;
  shops: ShopCardData[];
};

export function HomeShopFeed() {
  const requestVersion = useRef(0);
  const backgroundLocationStarted = useRef(false);
  const [payload, setPayload] = useState<RecommendedPayload | null>(null);
  const [busy, setBusy] = useState<string | null>("正在加载推荐");
  const [locationMessage, setLocationMessage] = useState<string | null>(null);

  const load = useCallback(async (forceLocation = false) => {
    const version = ++requestVersion.current;
    setBusy(forceLocation ? "正在获取位置" : "正在加载推荐");
    setLocationMessage(null);

    let query = "";
    const applyLocation = (location: BrowserLocation) => {
      const params = new URLSearchParams({
        lng: String(location.lng),
        lat: String(location.lat),
        coord_type: location.coordType,
      });
      query = `?${params.toString()}`;
      setLocationMessage(
        `已按当前位置排序 · 精度约 ${Math.round(location.accuracy)} m`,
      );
    };

    const cachedLocation = forceLocation ? null : getCachedBrowserLocation();
    if (cachedLocation) {
      applyLocation(cachedLocation);
    } else if (forceLocation) {
      try {
        applyLocation(await getBrowserLocation(true));
      } catch {
        setLocationMessage("未获得定位，当前按发布时间排序");
      }
    } else {
      setLocationMessage("当前按发布时间排序，定位会在后台更新");
    }

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/shops/recommended${query}`,
        {
          credentials: "include",
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error(`recommendations_${response.status}`);
      const next = (await response.json()) as RecommendedPayload;
      if (version === requestVersion.current) setPayload(next);
    } catch (error) {
      if (version === requestVersion.current) {
        setLocationMessage(
          error instanceof Error
            ? `推荐加载失败：${error.message}`
            : "推荐加载失败",
        );
      }
    } finally {
      if (version === requestVersion.current) setBusy(null);
    }

    if (!forceLocation && !cachedLocation && !backgroundLocationStarted.current) {
      backgroundLocationStarted.current = true;
      void getBrowserLocation()
        .then(() => {
          if (version === requestVersion.current) void load(false);
        })
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);

  const shops = payload?.shops ?? [];
  return (
    <section className="space-y-4">
      {busy ? (
        <div className="flex items-center gap-2 rounded-lg border border-[#f0d89a] bg-[#fffaf0] px-4 py-3 text-sm text-[#7c4a16]">
          <LoaderCircle size={16} className="animate-spin" />
          正在执行：{busy}（其它操作按钮已禁用）
        </div>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">店铺卡片流</h2>
          <p className="mt-1 text-sm text-muted">
            {locationMessage ?? "正在准备离你最近的店铺。"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={Boolean(busy)}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "正在获取位置" ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <LocateFixed size={14} />
            )}
            重新定位
          </button>
          <span className="rounded-md bg-white px-3 py-2 text-sm text-muted">
            {!payload
              ? "加载中"
              : shops.length
                ? `${shops.length} 家店铺`
                : "暂无推荐"}
          </span>
        </div>
      </div>

      {!payload && busy ? (
        <div className="rounded-lg border border-dashed border-line bg-white p-10 text-center text-sm text-muted">
          <LoaderCircle className="mx-auto animate-spin text-brand" size={24} />
          <p className="mt-3">正在准备店铺推荐…</p>
        </div>
      ) : shops.length ? (
        <div className="space-y-3">
          {shops.map((shop) => (
            <ShopCard
              key={shop.id}
              shop={shop}
              recommendationRequestId={payload?.recommendation_request_id}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-line bg-white p-10 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-full bg-[#f7efe8] text-brand">
            <Compass size={20} />
          </div>
          <h3 className="mt-4 text-lg font-semibold">还没有可推荐的店铺</h3>
          <p className="mt-2 text-sm leading-7 text-muted">
            发布第一批审核通过的店铺后，它们会按距离出现在这里。
          </p>
          <a
            href="/map"
            className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-brand"
          >
            <MapPin size={12} />
            去地图页看看
          </a>
        </div>
      )}
    </section>
  );
}
