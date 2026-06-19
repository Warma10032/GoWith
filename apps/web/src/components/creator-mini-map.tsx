"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";

interface MiniMapShop {
  id: string;
  display_name: string;
  city?: string | null;
  lng?: number | string | null;
  lat?: number | string | null;
}

interface CreatorMiniMapProps {
  shops: MiniMapShop[];
  creatorId: string;
}

const VIEW_W = 400;
const VIEW_H = 260;
// 简化国境范围，足够覆盖博主探店常见城市。
const LNG_MIN = 73;
const LNG_MAX = 135;
const LAT_MIN = 18;
const LAT_MAX = 54;

function toNumber(value: number | string | null | undefined): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function project(lng: number, lat: number): { x: number; y: number } {
  const x = ((lng - LNG_MIN) / (LNG_MAX - LNG_MIN)) * VIEW_W;
  const y = VIEW_H - ((lat - LAT_MIN) / (LAT_MAX - LAT_MIN)) * VIEW_H;
  return { x, y };
}

/**
 * 博主详情页的简易 SVG 散点地图。Placeholder 替代品：
 * - 不引第三方地图依赖，构建期零成本
 * - pin 可点击跳 /shops/[id]
 * - 无坐标的店铺在下方以「待补坐标」标签形式列出
 */
export function CreatorMiniMap({ shops, creatorId }: CreatorMiniMapProps) {
  const [hoverId, setHoverId] = useState<string | null>(null);

  const geocoded = shops
    .map((shop) => {
      const lng = toNumber(shop.lng);
      const lat = toNumber(shop.lat);
      return lng === null || lat === null
        ? null
        : { shop, ...project(lng, lat) };
    })
    .filter(
      (entry): entry is { shop: MiniMapShop; x: number; y: number } =>
        entry !== null,
    );

  const unlocated = shops.filter((shop) => {
    const lng = toNumber(shop.lng);
    const lat = toNumber(shop.lat);
    return lng === null || lat === null;
  });

  if (!shops.length) {
    return (
      <div className="grid min-h-[260px] place-items-center bg-map p-6 text-center">
        <div>
          <MapPin size={24} className="mx-auto text-brand" />
          <p className="mt-3 text-sm font-medium">暂无探店店铺</p>
          <p className="mt-1 text-xs text-muted">
            等 AI 工作流跑出候选并审核发布后，会出现在这里。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-map">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="block w-full"
        role="img"
        aria-label="博主探店散点地图"
      >
        <rect
          x="0"
          y="0"
          width={VIEW_W}
          height={VIEW_H}
          fill="transparent"
          stroke="#cdd5dc"
          strokeDasharray="3 3"
          strokeWidth={1}
        />
        {geocoded.map(({ shop, x, y }) => {
          const active = hoverId === shop.id;
          const labelText =
            shop.display_name.length > 14
              ? `${shop.display_name.slice(0, 14)}…`
              : shop.display_name;
          const labelX = Math.min(x + 14, VIEW_W - 154);
          const labelY = Math.max(y - 13, 20);
          const rectX = Math.min(x + 8, VIEW_W - 160);
          const rectY = Math.max(y - 30, 4);
          return (
            <a key={shop.id} href={`/shops/${shop.id}`}>
              <g
                onMouseEnter={() => setHoverId(shop.id)}
                onMouseLeave={() =>
                  setHoverId((current) =>
                    current === shop.id ? null : current,
                  )
                }
                style={{ cursor: "pointer" }}
              >
                <circle
                  cx={x}
                  cy={y}
                  r={active ? 7 : 5}
                  fill="#d94f30"
                  fillOpacity={active ? 0.9 : 0.65}
                  stroke="#faf8f5"
                  strokeWidth={1.5}
                />
                {active ? (
                  <g>
                    <rect
                      x={rectX}
                      y={rectY}
                      width={152}
                      height={26}
                      rx={4}
                      fill="#211a17"
                      fillOpacity={0.92}
                    />
                    <text
                      x={labelX}
                      y={labelY}
                      fill="#faf8f5"
                      fontSize={11}
                      fontWeight={600}
                      style={{ pointerEvents: "none" }}
                    >
                      {labelText}
                    </text>
                  </g>
                ) : null}
              </g>
            </a>
          );
        })}
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-white px-4 py-2 text-[11px] text-muted">
        <span>
          共 {geocoded.length} 个有坐标 · {unlocated.length} 个待补
        </span>
        <a
          href={`/map?creator_id=${creatorId}`}
          className="font-medium text-brand hover:underline"
        >
          打开完整地图视图 →
        </a>
      </div>
      {unlocated.length ? (
        <ul className="space-y-1 border-t border-line bg-white px-4 py-3 text-xs text-muted">
          {unlocated.slice(0, 6).map((shop) => (
            <li key={shop.id} className="flex items-center gap-2">
              <MapPin size={11} className="text-muted" />
              <a href={`/shops/${shop.id}`} className="hover:text-brand">
                {shop.display_name}
              </a>
              <span>· {shop.city ?? "位置待补充"}</span>
            </li>
          ))}
          {unlocated.length > 6 ? (
            <li className="text-[11px]">
              还有 {unlocated.length - 6} 家无坐标店铺…
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
