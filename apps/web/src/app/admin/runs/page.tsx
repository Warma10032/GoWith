import { AdminRunsPage } from "@/components/admin-runs-page";
import { TopNav } from "@/components/top-nav";

export default function Page() {
  return (
    <main>
      <TopNav />
      <AdminRunsPage mode="pipeline" />
    </main>
  );
}
