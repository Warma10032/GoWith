"use client";

import { useEffect, useState } from "react";

const PLACEHOLDER_SRC = "/images/shop-placeholder.webp";

export function ShopCoverImage({
  src,
  alt,
  className,
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={!src || failed ? PLACEHOLDER_SRC : src}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
