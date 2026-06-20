import type { ReactNode } from "react";
import { AdminRealtimeProvider } from "@/components/admin-realtime-provider";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminRealtimeProvider>{children}</AdminRealtimeProvider>;
}
