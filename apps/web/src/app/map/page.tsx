import { AmapCanvas } from "@/components/amap-canvas";
import { TopNav } from "@/components/top-nav";

export default function MapPage() {
  return (
    <main>
      <TopNav />
      <section className="mx-auto grid max-w-7xl gap-4 px-4 py-6 lg:grid-cols-[1fr_380px]">
        <AmapCanvas />
      </section>
    </main>
  );
}
