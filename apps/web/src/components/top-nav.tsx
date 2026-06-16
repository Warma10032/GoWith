import Link from "next/link";
import { Compass, MapPinned, ShieldCheck, UserRound } from "lucide-react";

const navItems = [
  { href: "/", label: "推荐", icon: Compass },
  { href: "/map", label: "地图", icon: MapPinned },
  { href: "/creators/demo", label: "博主", icon: UserRound },
  { href: "/admin", label: "后台", icon: ShieldCheck },
];

export function TopNav() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-[#faf8f5]/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-ink text-sm font-semibold text-white">
            G
          </span>
          <span>
            <span className="block text-base font-semibold leading-tight">GoWith</span>
            <span className="block text-xs text-muted">B站探店地图</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted transition hover:bg-white hover:text-ink"
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

