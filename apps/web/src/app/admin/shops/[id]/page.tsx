import { AdminShopDetailPage } from "@/components/admin-shop-detail-page";
import { TopNav } from "@/components/top-nav";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main>
      <TopNav />
      <AdminShopDetailPage shopId={id} />
    </main>
  );
}
