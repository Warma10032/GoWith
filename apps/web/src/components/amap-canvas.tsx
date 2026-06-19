"use client";

import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  LocateFixed,
  MapPin,
  MapPinned,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { apiBaseUrl } from "@/lib/api";

type SourceVideo = {
  video_id?: string;
  title: string;
  source_url: string;
  bvid?: string;
  creator_name?: string;
};

type MapShop = {
  id: string;
  display_name: string;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  lng?: number | string | null;
  lat?: number | string | null;
  coord_type?: string | null;
  card_payload?: {
    subtitle?: string;
    recommend_reason?: string;
    avg_price_hint?: string;
    tags?: string[];
  } | null;
  quality?: Record<string, unknown> | null;
  source_videos?: SourceVideo[];
  rank_score?: number;
};

type LngLat = {
  getLng?: () => number;
  getLat?: () => number;
  lng?: number;
  lat?: number;
};

type Bounds = {
  getSouthWest(): LngLat;
  getNorthEast(): LngLat;
};

type AMapNamespace = {
  Map: new (
    container: HTMLDivElement,
    options: {
      center: [number, number];
      mapStyle?: string;
      viewMode: "2D" | "3D";
      zoom: number;
      zooms?: [number, number];
    },
  ) => AMapInstance;
  Marker: new (options: {
    position: [number, number];
    title?: string;
    offset?: unknown;
  }) => AMapMarker;
  Pixel: new (x: number, y: number) => unknown;
  InfoWindow: new (options: {
    content: string;
    offset?: unknown;
    closeWhenClickMap?: boolean;
  }) => AMapInfoWindow;
  Scale: new () => unknown;
  ToolBar: new (options?: { position?: "LT" | "RT" | "LB" | "RB" }) => unknown;
};

type AMapMarker = {
  on(eventName: "click", handler: () => void): void;
  setMap(map: AMapInstance | null): void;
};

type AMapInfoWindow = {
  setContent(content: string): void;
  open(map: AMapInstance, position: [number, number]): void;
  close(): void;
};

type AMapInstance = {
  addControl(control: unknown): void;
  destroy(): void;
  getBounds(): Bounds;
  on(eventName: "complete" | "moveend" | "zoomend", handler: () => void): void;
  panTo(position: [number, number]): void;
  setZoomAndCenter(zoom: number, center: [number, number]): void;
};

type AMapLoaderModule = {
  load(options: {
    key: string;
    version: string;
    plugins?: string[];
  }): Promise<AMapNamespace>;
};

declare global {
  interface Window {
    _AMapSecurityConfig?: {
      securityJsCode?: string;
    };
  }
}

type MapStatus = "idle" | "loading" | "ready" | "error" | "missing-key";

function lngLatValue(value: LngLat, axis: "lng" | "lat") {
  const getter = axis === "lng" ? value.getLng : value.getLat;
  const direct = axis === "lng" ? value.lng : value.lat;
  return typeof getter === "function" ? getter.call(value) : Number(direct);
}

function toNumber(value: number | string | null | undefined) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function escapeHtml(value: string | null | undefined) {
  return (value ?? "").replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[char] ?? char;
  });
}

function shopSummary(shop: MapShop) {
  return (
    shop.card_payload?.recommend_reason ??
    shop.card_payload?.subtitle ??
    "已通过审核的探店店铺"
  );
}

function shopLocation(shop: MapShop) {
  return (
    [shop.city, shop.district, shop.address].filter(Boolean).join(" · ") ||
    "位置待补充"
  );
}

function infoWindowHtml(shop: MapShop) {
  const video = shop.source_videos?.[0];
  const videoLink = video?.source_url
    ? `<a href="${escapeHtml(video.source_url)}" target="_blank" rel="noreferrer" style="color:#c15f3c;font-weight:600;">来源视频</a>`
    : "";
  return `
    <div style="min-width:220px;max-width:280px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <div style="font-weight:700;font-size:15px;margin-bottom:4px;">${escapeHtml(shop.display_name)}</div>
      <div style="font-size:12px;color:#756b62;line-height:1.5;">${escapeHtml(shopLocation(shop))}</div>
      <div style="font-size:12px;color:#2b2520;line-height:1.55;margin-top:8px;">${escapeHtml(shopSummary(shop))}</div>
      <div style="font-size:11px;color:#9a341f;margin-top:8px;">AI 总结，仅供参考</div>
      <div style="display:flex;gap:10px;margin-top:8px;font-size:12px;">
        <a href="/shops/${escapeHtml(shop.id)}" style="color:#c15f3c;font-weight:600;">店铺详情</a>
        ${videoLink}
      </div>
    </div>
  `;
}

export function AmapCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<AMapInstance | null>(null);
  const amapRef = useRef<AMapNamespace | null>(null);
  const markersRef = useRef<AMapMarker[]>([]);
  const infoWindowRef = useRef<AMapInfoWindow | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeQueryRef = useRef("");
  const selectedShopIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<MapStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [shops, setShops] = useState<MapShop[]>([]);
  const [searchText, setSearchText] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [selectedShopId, setSelectedShopId] = useState<string | null>(null);
  const [loadingPins, setLoadingPins] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);

  const selectedShop = useMemo(
    () => shops.find((shop) => shop.id === selectedShopId) ?? null,
    [selectedShopId, shops],
  );

  useEffect(() => {
    activeQueryRef.current = activeQuery;
  }, [activeQuery]);

  useEffect(() => {
    selectedShopIdRef.current = selectedShopId;
  }, [selectedShopId]);

  const postMapPinClick = useCallback((shop: MapShop) => {
    void fetch(`${apiBaseUrl}/api/users/events`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event_name: "map_pin_click",
        entity_type: "shop",
        entity_id: shop.id,
        shop_id: shop.id,
        surface: "map",
        client_type: "web",
        event_payload: { coord_type: shop.coord_type ?? "gcj02" },
      }),
    }).catch(() => undefined);
  }, []);

  const openShop = useCallback(
    (shop: MapShop, shouldPan = false) => {
      const lng = toNumber(shop.lng);
      const lat = toNumber(shop.lat);
      const map = mapRef.current;
      if (!map || lng === null || lat === null) return;
      if (shouldPan) map.setZoomAndCenter(16, [lng, lat]);
      selectedShopIdRef.current = shop.id;
      setSelectedShopId(shop.id);
      infoWindowRef.current?.setContent(infoWindowHtml(shop));
      infoWindowRef.current?.open(map, [lng, lat]);
      postMapPinClick(shop);
    },
    [postMapPinClick],
  );

  const renderMarkers = useCallback(
    (nextShops: MapShop[]) => {
      const AMap = amapRef.current;
      const map = mapRef.current;
      if (!AMap || !map) return;
      for (const marker of markersRef.current) marker.setMap(null);
      markersRef.current = [];

      for (const shop of nextShops) {
        const lng = toNumber(shop.lng);
        const lat = toNumber(shop.lat);
        if (lng === null || lat === null) continue;
        const marker = new AMap.Marker({
          position: [lng, lat],
          title: shop.display_name,
          offset: new AMap.Pixel(-10, -30),
        });
        marker.on("click", () => openShop(shop));
        marker.setMap(map);
        markersRef.current.push(marker);
      }
    },
    [openShop],
  );

  const fetchViewportShops = useCallback(
    async (queryOverride?: string) => {
      const map = mapRef.current;
      if (!map) return;
      const bounds = map.getBounds();
      const southWest = bounds.getSouthWest();
      const northEast = bounds.getNorthEast();
      const params = new URLSearchParams({
        min_lng: String(lngLatValue(southWest, "lng")),
        min_lat: String(lngLatValue(southWest, "lat")),
        max_lng: String(lngLatValue(northEast, "lng")),
        max_lat: String(lngLatValue(northEast, "lat")),
        limit: "500",
      });
      const query = (queryOverride ?? activeQueryRef.current).trim();
      if (query) params.set("q", query);

      setLoadingPins(true);
      setPanelError(null);
      try {
        const response = await fetch(
          `${apiBaseUrl}/api/shops/map?${params.toString()}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`shops_map_${response.status}`);
        const payload = (await response.json()) as { shops: MapShop[] };
        setShops(payload.shops);
        renderMarkers(payload.shops);
        if (
          payload.shops.every((shop) => shop.id !== selectedShopIdRef.current)
        ) {
          selectedShopIdRef.current = null;
          setSelectedShopId(null);
          infoWindowRef.current?.close();
        }
      } catch (error) {
        setPanelError(
          error instanceof Error ? error.message : "地图店铺加载失败",
        );
      } finally {
        setLoadingPins(false);
      }
    },
    [renderMarkers],
  );

  const scheduleFetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchViewportShops();
    }, 350);
  }, [fetchViewportShops]);

  useEffect(() => {
    let cancelled = false;
    const key = process.env.NEXT_PUBLIC_AMAP_WEB_JS_KEY;
    const securityJsCode = process.env.NEXT_PUBLIC_AMAP_SECURITY_JS_CODE;

    if (!key) {
      setStatus("missing-key");
      return undefined;
    }

    if (securityJsCode) {
      window._AMapSecurityConfig = { securityJsCode };
    }

    setStatus("loading");
    setErrorMessage(null);

    import("@amap/amap-jsapi-loader")
      .then(({ load: loadAmap }: AMapLoaderModule) =>
        loadAmap({
          key,
          version: "2.0",
          plugins: ["AMap.Scale", "AMap.ToolBar"],
        }),
      )
      .then((AMap: AMapNamespace) => {
        if (cancelled || !containerRef.current) return;

        const map = new AMap.Map(containerRef.current, {
          center: [104.195397, 35.86166],
          mapStyle: "amap://styles/normal",
          viewMode: "2D",
          zoom: 4,
          zooms: [3, 18],
        });

        amapRef.current = AMap;
        map.addControl(new AMap.Scale());
        map.addControl(new AMap.ToolBar({ position: "RB" }));
        infoWindowRef.current = new AMap.InfoWindow({
          content: "",
          offset: new AMap.Pixel(0, -28),
          closeWhenClickMap: true,
        });
        map.on("complete", () => {
          if (cancelled) return;
          setStatus("ready");
          void fetchViewportShops();
        });
        map.on("moveend", scheduleFetch);
        map.on("zoomend", scheduleFetch);
        mapRef.current = map;
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(
          error instanceof Error ? error.message : "高德地图加载失败",
        );
      });

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      for (const marker of markersRef.current) marker.setMap(null);
      markersRef.current = [];
      infoWindowRef.current?.close();
      mapRef.current?.destroy();
      mapRef.current = null;
      amapRef.current = null;
    };
  }, [fetchViewportShops, scheduleFetch]);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchText.trim();
    setActiveQuery(query);
    if (!query) {
      await fetchViewportShops("");
      return;
    }

    setLoadingPins(true);
    setPanelError(null);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/shops/search?q=${encodeURIComponent(query)}&limit=20`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`shops_search_${response.status}`);
      const payload = (await response.json()) as { shops: MapShop[] };
      setShops(payload.shops);
      renderMarkers(payload.shops);
      const first = payload.shops.find(
        (shop) => toNumber(shop.lng) !== null && toNumber(shop.lat) !== null,
      );
      if (first) openShop(first, true);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "店铺搜索失败");
    } finally {
      setLoadingPins(false);
    }
  }

  return (
    <>
      <div className="relative min-h-[420px] overflow-hidden rounded-lg border border-line bg-map md:min-h-[620px]">
        <div
          ref={containerRef}
          className="absolute inset-0"
          aria-label="高德地图"
        />
        {status !== "ready" ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 px-6 text-center backdrop-blur-sm">
            {status === "missing-key" ? (
              <div className="max-w-sm">
                <AlertTriangle className="mx-auto text-brand" size={28} />
                <h1 className="mt-3 text-lg font-semibold">
                  高德地图 Key 未配置
                </h1>
                <p className="mt-2 text-sm leading-6 text-muted">
                  请在本地环境变量中配置 NEXT_PUBLIC_AMAP_WEB_JS_KEY 后重启 Web
                  服务。
                </p>
              </div>
            ) : status === "error" ? (
              <div className="max-w-sm">
                <AlertTriangle className="mx-auto text-brand" size={28} />
                <h1 className="mt-3 text-lg font-semibold">地图加载失败</h1>
                <p className="mt-2 text-sm leading-6 text-muted">
                  {errorMessage ?? "请检查高德 Key、域名白名单和网络状态。"}
                </p>
              </div>
            ) : (
              <div>
                <Loader2
                  className="mx-auto animate-spin text-brand"
                  size={28}
                />
                <p className="mt-3 text-sm font-medium text-muted">
                  正在加载高德地图
                </p>
              </div>
            )}
          </div>
        ) : null}
        <div className="pointer-events-none absolute left-6 top-6 z-10 rounded-lg bg-white/95 p-4 shadow-card">
          <div className="flex items-center gap-2">
            <MapPinned size={18} className="text-brand" />
            <h1 className="text-lg font-semibold">全国探店地图</h1>
          </div>
          <p className="mt-1 text-sm text-muted">
            {activeQuery
              ? `搜索「${activeQuery}」命中 ${shops.length} 家`
              : `当前视窗 ${shops.length} 家已发布店铺`}
          </p>
        </div>
      </div>

      <aside className="rounded-lg border border-line bg-white p-4">
        <form onSubmit={handleSearch} className="flex gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">搜索店铺</span>
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2 pr-9 text-sm"
              placeholder="搜索已发布店铺、地址、城区"
            />
            {searchText ? (
              <button
                type="button"
                onClick={() => {
                  setSearchText("");
                  if (activeQuery) {
                    setActiveQuery("");
                    void fetchViewportShops("");
                  }
                }}
                className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-[#f4efe7]"
                aria-label="清除搜索"
              >
                <X size={13} />
              </button>
            ) : null}
          </label>
          <button
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-white"
            aria-label="搜索店铺"
          >
            {loadingPins ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Search size={16} />
            )}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between text-sm">
          <div className="font-semibold">
            {activeQuery ? "搜索结果" : "当前视窗店铺"}
          </div>
          <button
            onClick={() => void fetchViewportShops()}
            className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium"
            disabled={loadingPins || status !== "ready"}
          >
            <LocateFixed size={13} />
            刷新范围
          </button>
        </div>

        {panelError ? (
          <div className="mt-3 rounded-lg border border-[#f2c7bd] bg-[#fff1ee] px-3 py-2 text-xs text-[#9a341f]">
            <p>{panelError}</p>
            <button
              type="button"
              onClick={() => void fetchViewportShops()}
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-[#f2c7bd] bg-white px-2 py-1 text-[11px] font-semibold hover:border-[#d94f30]"
            >
              <RotateCcw size={11} />
              重试
            </button>
          </div>
        ) : null}
        {selectedShop ? (
          <div className="mt-3 rounded-lg border border-[#f0d89a] bg-[#fffaf0] p-3 text-sm">
            <div className="font-semibold">{selectedShop.display_name}</div>
            <div className="mt-1 text-xs text-muted">
              {shopLocation(selectedShop)}
            </div>
            <div className="mt-2 text-xs text-[#9a341f]">AI 总结，仅供参考</div>
          </div>
        ) : null}

        <div className="mt-3 max-h-[500px] space-y-3 overflow-y-auto pr-1">
          {shops.length ? (
            shops.map((shop) => (
              <button
                key={shop.id}
                onClick={() => openShop(shop, true)}
                className="block w-full rounded-lg border border-line p-3 text-left text-sm hover:border-brand/60 hover:bg-[#fffaf0]"
              >
                <div className="flex items-start gap-2">
                  <MapPin size={16} className="mt-0.5 shrink-0 text-brand" />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-1 font-semibold">
                      {shop.display_name}
                    </div>
                    <div className="mt-1 line-clamp-1 text-xs text-muted">
                      {shopLocation(shop)}
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-ink/80">
                      {shopSummary(shop)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                      <span className="text-[#9a341f]">AI 总结，仅供参考</span>
                      <a
                        href={`/shops/${shop.id}`}
                        className="inline-flex items-center gap-1 font-medium text-brand"
                        onClick={(event) => event.stopPropagation()}
                      >
                        详情
                        <ExternalLink size={12} />
                      </a>
                      {shop.source_videos?.[0]?.source_url ? (
                        <a
                          href={shop.source_videos[0].source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-brand"
                          onClick={(event) => event.stopPropagation()}
                        >
                          来源视频
                          <ExternalLink size={12} />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              </button>
            ))
          ) : loadingPins ? (
            <div className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">
              <Loader2 className="mx-auto animate-spin text-brand" size={20} />
              <p className="mt-2">正在加载店铺点位…</p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-line p-6 text-center">
              <div className="mx-auto grid size-10 place-items-center rounded-full bg-[#f7efe8] text-brand">
                <MapPin size={18} />
              </div>
              <p className="mt-3 text-sm font-semibold text-ink">
                {activeQuery ? "没有匹配的店铺" : "当前范围暂无已发布店铺"}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted">
                {activeQuery
                  ? "试试换关键字，或清空搜索回到当前视窗。"
                  : "试试放大地图到城市级别，或去博主列表里挑感兴趣的探店博主。"}
              </p>
              {activeQuery ? (
                <button
                  type="button"
                  onClick={() => {
                    setActiveQuery("");
                    setSearchText("");
                    void fetchViewportShops("");
                  }}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                >
                  清空搜索回到视窗
                </button>
              ) : (
                <a
                  href="/creators"
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                >
                  浏览博主列表
                  <ExternalLink size={11} />
                </a>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
