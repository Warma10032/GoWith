import type { Metadata, Viewport } from "next";
import "./globals.css";

// Direct access so Next.js can statically replace NEXT_PUBLIC_* at build time.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
if (!siteUrl) throw new Error("NEXT_PUBLIC_SITE_URL is required");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "GoWith · B站探店博主店铺地图",
    template: "%s · GoWith",
  },
  description:
    "以 B 站探店博主为索引，将视频内容转化为全国可检索的店铺情报。AI 解析 + 高德 POI 匹配 + 人工审核。",
  applicationName: "GoWith",
  keywords: ["探店", "B站", "高德地图", "店铺地图", "推荐", "GoWith"],
  authors: [{ name: "GoWith" }],
  openGraph: {
    type: "website",
    locale: "zh_CN",
    siteName: "GoWith",
    title: "GoWith · B站探店博主店铺地图",
    description:
      "以 B 站探店博主为索引，将视频内容转化为全国可检索的店铺情报。",
    url: siteUrl,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "GoWith · B站探店博主店铺地图",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "GoWith · B站探店博主店铺地图",
    description:
      "以 B 站探店博主为索引，将视频内容转化为全国可检索的店铺情报。",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

export const viewport: Viewport = {
  themeColor: "#faf8f5",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
