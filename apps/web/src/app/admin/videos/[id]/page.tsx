import { AdminVideoDetailPage } from "@/components/admin-video-detail-page";
import { TopNav } from "@/components/top-nav";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main>
      <TopNav />
      <AdminVideoDetailPage videoId={id} />
    </main>
  );
}
