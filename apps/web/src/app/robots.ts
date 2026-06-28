import type { MetadataRoute } from "next";

// Direct access so Next.js can statically replace NEXT_PUBLIC_* at build time.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
if (!siteUrl) throw new Error("NEXT_PUBLIC_SITE_URL is required");

/**
 * robots.txt：允许爬公共页面与 sitemap，禁止后台与 API 路由。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/map", "/creators"],
        disallow: ["/admin", "/api", "/shops", "/creators/*/"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
