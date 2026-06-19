import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/**
 * 自生成站点 favicon。方形 brand 色背景 + 白色 G 字母。
 * 不依赖外部图片资源，构建期生成。
 */
export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        fontSize: 22,
        background: "#211a17",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#faf8f5",
        fontWeight: 700,
        borderRadius: 8,
        letterSpacing: -0.5,
      }}
    >
      G
    </div>,
    { ...size },
  );
}
