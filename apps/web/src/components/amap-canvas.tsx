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
import { wgs84ToGcj02 } from "@gowith/shared";
import { apiBaseUrl } from "@/lib/api";
import { getBrowserLocation } from "@/lib/browser-location";

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
    tags?: string[];
  } | null;
  quality?: Record<string, unknown> | null;
  source_videos?: SourceVideo[];
  rank_score?: number;
  external_links?: Array<{
    id: string;
    platform: "dianping" | "meituan";
    url: string;
  }>;
  poi_business?: {
    provider: string;
    rating: number | null;
    avg_cost: number | null;
  } | null;
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
  resize(): void;
  setZoomAndCenter(zoom: number, center: [number, number]): void;
};

type AMapLoaderModule = {
  load(options: {
    key: string;
    version: string;
    plugins?: string[];
  }): Promise<AMapNamespace>;
};

type AMapLoaderExport = AMapLoaderModule & {
  default?: AMapLoaderModule;
};

let amapLoaderPromise: Promise<AMapNamespace> | null = null;

function loadAmapSdk(key: string) {
  if (!amapLoaderPromise) {
    amapLoaderPromise = import("@amap/amap-jsapi-loader")
      .then((loaderModule: AMapLoaderExport) => {
        const loader = loaderModule.default ?? loaderModule;
        return loader.load({
          key,
          version: "2.0",
          plugins: ["AMap.Scale", "AMap.ToolBar"],
        });
      })
      .catch((error: unknown) => {
        amapLoaderPromise = null;
        throw error;
      });
  }

  return amapLoaderPromise;
}

function waitForContainerLayout(
  container: HTMLDivElement,
  signal: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    let observer: ResizeObserver | null = null;

    const cleanup = () => {
      observer?.disconnect();
      signal.removeEventListener("abort", handleAbort);
    };
    const handleAbort = () => {
      cleanup();
      reject(new DOMException("Map initialization aborted", "AbortError"));
    };
    const resolveWhenReady = () => {
      const { width, height } = container.getBoundingClientRect();
      if (!container.isConnected || width <= 0 || height <= 0) return;
      cleanup();
      resolve();
    };

    if (signal.aborted) {
      handleAbort();
      return;
    }

    signal.addEventListener("abort", handleAbort, { once: true });
    observer = new ResizeObserver(resolveWhenReady);
    observer.observe(container);
    resolveWhenReady();
  });
}

declare global {
  interface Window {
    _AMapSecurityConfig?: {
      securityJsCode?: string;
    };
  }
}

type MapStatus = "idle" | "loading" | "ready" | "error" | "missing-key";
type LocationStatus = "locating" | "ready" | "error";

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
  const dianpingLink = shop.external_links?.find(
    (link) => link.platform === "dianping",
  );
  const videoLink = video?.source_url
    ? `<a href="${escapeHtml(video.source_url)}" target="_blank" rel="noreferrer" style="color:#c15f3c;font-weight:600;">来源视频</a>`
    : "";
  const dianpingAnchor = dianpingLink
    ? `<a href="${escapeHtml(dianpingLink.url)}" target="_blank" rel="noreferrer" data-dianping-link-id="${escapeHtml(dianpingLink.id)}" data-shop-id="${escapeHtml(shop.id)}" style="color:#c15f3c;font-weight:600;">大众点评</a>`
    : "";
  return `
    <div style="min-width:220px;max-width:280px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <div style="font-weight:700;font-size:15px;margin-bottom:4px;">${escapeHtml(shop.display_name)}</div>
      <div style="font-size:12px;color:#756b62;line-height:1.5;">${escapeHtml(shopLocation(shop))}</div>
      <div style="font-size:12px;color:#2b2520;line-height:1.55;margin-top:8px;">${escapeHtml(shopSummary(shop))}</div>
      <div style="display:flex;gap:10px;margin-top:8px;font-size:12px;">
        <a href="/shops/${escapeHtml(shop.id)}" style="color:#c15f3c;font-weight:600;">店铺详情</a>
        ${videoLink}
        ${dianpingAnchor}
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
  const userMarkerRef = useRef<AMapMarker | null>(null);
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
  const [locationStatus, setLocationStatus] =
    useState<LocationStatus>("locating");

  const selectedShop = useMemo(
    () => shops.find((shop) => shop.id === selectedShopId) ?? null,
    [selectedShopId, shops],
  );
  const busyLabel =
    locationStatus === "locating"
      ? "正在定位"
      : loadingPins
        ? "正在加载店铺点位"
        : null;

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

  const postDianpingNavigation = useCallback(
    (shopId: string, linkId: string) => {
      void fetch(`${apiBaseUrl}/api/users/events`, {
        method: "POST",
        credentials: "include",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event_name: "navigation_click",
          entity_type: "shop",
          entity_id: shopId,
          shop_id: shopId,
          surface: "map",
          client_type: "web",
          event_payload: {
            destination_platform: "dianping",
            external_link_id: linkId,
          },
        }),
      }).catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    function trackInfoWindowNavigation(event: MouseEvent) {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>(
        "a[data-dianping-link-id][data-shop-id]",
      );
      if (!link) return;
      const shopId = link.dataset.shopId;
      const linkId = link.dataset.dianpingLinkId;
      if (shopId && linkId) postDianpingNavigation(shopId, linkId);
    }
    document.addEventListener("click", trackInfoWindowNavigation);
    return () =>
      document.removeEventListener("click", trackInfoWindowNavigation);
  }, [postDianpingNavigation]);

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

  const locateUser = useCallback(async (force = true) => {
    const map = mapRef.current;
    const AMap = amapRef.current;
    if (!map || !AMap) return;
    setLocationStatus("locating");
    try {
      const browserLocation = await getBrowserLocation(force);
      const location = wgs84ToGcj02({
        lng: browserLocation.lng,
        lat: browserLocation.lat,
      });
      userMarkerRef.current?.setMap(null);
      const marker = new AMap.Marker({
        position: [location.lng, location.lat],
        title: "我的位置",
      });
      marker.setMap(map);
      userMarkerRef.current = marker;
      map.setZoomAndCenter(13, [location.lng, location.lat]);
      setLocationStatus("ready");
    } catch {
      setLocationStatus("error");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let initialFetchTimer: ReturnType<typeof setTimeout> | null = null;
    let postMountFrame: number | null = null;
    const initializationController = new AbortController();
    const key = process.env.NEXT_PUBLIC_AMAP_WEB_JS_KEY;
    const securityJsCode = process.env.NEXT_PUBLIC_AMAP_SECURITY_JS_CODE;

    if (!key) {
      setStatus("missing-key");
      setLocationStatus("error");
      return undefined;
    }

    if (securityJsCode) {
      window._AMapSecurityConfig = { securityJsCode };
    }

    setStatus("loading");
    setErrorMessage(null);

    const container = containerRef.current;
    if (!container) {
      setStatus("error");
      setLocationStatus("error");
      setErrorMessage("地图容器初始化失败");
      return undefined;
    }

    Promise.all([
      loadAmapSdk(key),
      waitForContainerLayout(container, initializationController.signal),
      getBrowserLocation().catch(() => null),
    ])
      .then(([AMap, _layout, browserLocation]) => {
        if (cancelled || containerRef.current !== container) return;

        const initialLocation = browserLocation
          ? wgs84ToGcj02({
              lng: browserLocation.lng,
              lat: browserLocation.lat,
            })
          : null;

        const map = new AMap.Map(container, {
          center: initialLocation
            ? [initialLocation.lng, initialLocation.lat]
            : [104.195397, 35.86166],
          mapStyle: "amap://styles/normal",
          viewMode: "2D",
          zoom: initialLocation ? 13 : 4,
          zooms: [3, 18],
        });

        amapRef.current = AMap;
        mapRef.current = map;
        map.addControl(new AMap.Scale());
        map.addControl(new AMap.ToolBar({ position: "RB" }));
        infoWindowRef.current = new AMap.InfoWindow({
          content: "",
          offset: new AMap.Pixel(0, -28),
          closeWhenClickMap: true,
        });
        if (initialLocation) {
          const marker = new AMap.Marker({
            position: [initialLocation.lng, initialLocation.lat],
            title: "我的位置",
          });
          marker.setMap(map);
          userMarkerRef.current = marker;
          setLocationStatus("ready");
        } else {
          setLocationStatus("error");
        }
        setStatus("ready");

        let initialFetchStarted = false;
        const fetchInitialViewport = () => {
          if (cancelled || initialFetchStarted) return;
          initialFetchStarted = true;
          map.resize();
          void fetchViewportShops();
        };
        map.on("complete", () => {
          fetchInitialViewport();
        });
        map.on("moveend", scheduleFetch);
        map.on("zoomend", scheduleFetch);

        resizeObserver = new ResizeObserver(() => map.resize());
        resizeObserver.observe(container);
        postMountFrame = requestAnimationFrame(() => map.resize());
        initialFetchTimer = setTimeout(fetchInitialViewport, 500);
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
      initializationController.abort();
      resizeObserver?.disconnect();
      if (postMountFrame !== null) cancelAnimationFrame(postMountFrame);
      if (initialFetchTimer) clearTimeout(initialFetchTimer);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      for (const marker of markersRef.current) marker.setMap(null);
      markersRef.current = [];
      userMarkerRef.current?.setMap(null);
      userMarkerRef.current = null;
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
      {busyLabel ? (
        <div className="lg:col-span-2 flex items-center gap-2 rounded-lg border border-[#f0d89a] bg-[#fffaf0] px-4 py-3 text-sm text-[#7c4a16]">
          <Loader2 size={15} className="animate-spin" />
          正在执行：{busyLabel}（其它操作按钮已禁用）
        </div>
      ) : null}
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
        <button
          type="button"
          onClick={() => void locateUser(true)}
          disabled={status !== "ready" || Boolean(busyLabel)}
          className="absolute right-4 top-28 z-10 inline-flex items-center gap-2 rounded-lg border border-line bg-white/95 px-3 py-2 text-sm font-medium text-brand shadow-card disabled:cursor-not-allowed disabled:opacity-60 sm:right-6 sm:top-6"
        >
          {locationStatus === "locating" ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <LocateFixed size={15} />
          )}
          {locationStatus === "ready" ? "已定位" : "重新定位"}
        </button>
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
                disabled={Boolean(busyLabel)}
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
            disabled={Boolean(busyLabel)}
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
            disabled={Boolean(busyLabel) || status !== "ready"}
          >
            <LocateFixed size={13} />
            刷新范围
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          {locationStatus === "ready"
            ? "地图已以当前位置为中心，左下角比例尺会随缩放保持真实距离。"
            : locationStatus === "locating"
              ? "正在获取当前位置…"
              : "未获得定位，当前显示全国视图。"}
        </p>

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
          </div>
        ) : null}

        <div className="mt-3 max-h-[500px] space-y-3 overflow-y-auto pr-1">
          {shops.length ? (
            shops.map((shop) => (
              <button
                key={shop.id}
                onClick={() => openShop(shop, true)}
                disabled={Boolean(busyLabel)}
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
                      {shop.external_links?.find(
                        (link) => link.platform === "dianping",
                      ) ? (
                        <a
                          href={
                            shop.external_links.find(
                              (link) => link.platform === "dianping",
                            )?.url
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-brand"
                          onClick={(event) => {
                            event.stopPropagation();
                            const link = shop.external_links?.find(
                              (item) => item.platform === "dianping",
                            );
                            if (link) postDianpingNavigation(shop.id, link.id);
                          }}
                        >
                          大众点评
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
                  disabled={Boolean(busyLabel)}
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
