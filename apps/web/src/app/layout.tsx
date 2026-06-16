import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GoWith",
  description: "B站探店博主店铺地图 MVP",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

