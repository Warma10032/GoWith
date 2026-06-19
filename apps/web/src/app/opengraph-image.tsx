import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "GoWith · B站探店博主店铺地图";

/**
 * 自生成 Open Graph 图。构建期由 `ImageResponse` 渲染为 PNG。
 * 不依赖外部图片资源，与品牌色一致（ink #211a17 / brand #d94f30 / 奶白底）。
 */
export default async function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: "#faf8f5",
        color: "#211a17",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: 24,
            background: "#211a17",
            color: "#faf8f5",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 56,
            fontWeight: 700,
            letterSpacing: -2,
          }}
        >
          G
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 48, fontWeight: 700, lineHeight: 1.1 }}>
            GoWith
          </div>
          <div style={{ fontSize: 22, color: "#71675f", marginTop: 4 }}>
            B站探店博主店铺地图
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 18,
          fontSize: 56,
          fontWeight: 700,
          lineHeight: 1.2,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span
            style={{
              display: "inline-block",
              width: 14,
              height: 56,
              background: "#d94f30",
              borderRadius: 4,
            }}
          />
          从 B 站视频到全国可检索店铺
        </div>
        <div style={{ color: "#71675f", fontSize: 28, fontWeight: 500 }}>
          AI 解析 + 高德 POI 匹配 + 人工审核
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 20,
          color: "#71675f",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: 999,
              background: "#68806a",
            }}
          />
          MVP 阶段 · 5 个种子博主 · 全链路闭环
        </div>
        <div style={{ fontWeight: 600, color: "#211a17" }}>gowith.local</div>
      </div>
    </div>,
    { ...size },
  );
}
