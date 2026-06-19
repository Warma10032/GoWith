import { AdminRunDetailPage } from "@/components/admin-run-detail-page";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminRunDetailRoute({ params }: PageProps) {
  const { id } = await params;
  return <AdminRunDetailPage runId={id} />;
}
