import type { MetadataRoute } from "next";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const siteUrl = requireEnv("NEXT_PUBLIC_SITE_URL");

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
