"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, MapPinned, UserRound } from "lucide-react";

const navItems = [
  { href: "/", label: "推荐", icon: Compass },
  { href: "/map", label: "地图", icon: MapPinned },
  { href: "/creators", label: "博主", icon: UserRound },
];

function isActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TopNav() {
  const pathname = usePathname() ?? "/";

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-[#faf8f5]/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-ink text-sm font-semibold text-white">
            G
          </span>
          <span>
            <span className="block text-base font-semibold leading-tight">
              GoWith
            </span>
            <span className="hidden text-xs text-muted sm:block">
              B站探店地图
            </span>
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-white text-ink shadow-card"
                    : "text-muted hover:bg-white hover:text-ink"
                }`}
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
