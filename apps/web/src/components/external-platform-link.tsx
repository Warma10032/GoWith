"use client";

import type { ReactNode } from "react";
import { apiBaseUrl } from "@/lib/api";

type ExternalPlatformLinkProps = {
  href: string;
  linkId: string;
  shopId: string;
  surface: "home" | "map" | "creator_page" | "shop_detail";
  recommendationRequestId?: string;
  recommendationItemId?: string;
  className?: string;
  children: ReactNode;
};

export function ExternalPlatformLink({
  href,
  linkId,
  shopId,
  surface,
  recommendationRequestId,
  recommendationItemId,
  className,
  children,
}: ExternalPlatformLinkProps) {
  function trackNavigation() {
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
        recommendation_request_id: recommendationRequestId,
        recommendation_item_id: recommendationItemId,
        surface,
        client_type: "web",
        event_payload: {
          destination_platform: "dianping",
          external_link_id: linkId,
        },
      }),
    }).catch(() => undefined);
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={className}
      onClick={trackNavigation}
    >
      {children}
    </a>
  );
}
