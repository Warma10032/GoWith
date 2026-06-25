"use client";

import { useEffect, useState } from "react";
import { AmapCanvas } from "@/components/amap-canvas";
import { TopNav } from "@/components/top-nav";

export default function MapPage() {
  // 每次 mount 后立即 +1 触发 AmapCanvas 重新挂载。
  // 用 useState 而不是 usePathname：避免 SSR / CSR 取到不同 pathname 触发 hydration 报错。
  const [mapKey, setMapKey] = useState(0);
  useEffect(() => {
    setMapKey((value) => value + 1);
  }, []);

  return (
    <main>
      <TopNav />
      <section className="mx-auto grid max-w-7xl gap-4 px-4 py-6 lg:grid-cols-[1fr_380px]">
        <AmapCanvas key={mapKey} />
      </section>
    </main>
  );
}
