"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    {
      label: "Dashboard",
      href: "/",
    },
    {
      label: "Staff",
      href: "/staff",
    },
    {
      label: "Planner",
      href: "/schedule",
    },
    {
      label: "Availability",
      href: "/availability",
    },
  ];

  return (
    <aside
      className="
        fixed
        left-0
        top-0
        z-50
        h-screen
        w-64
        border-r
        border-slate-200
        bg-slate-100
        p-6
      "
    >
      <h1 className="mb-8 text-2xl font-bold">
        Deccan Staffing
      </h1>

      <nav className="space-y-2">
        {navItems.map((item) => {
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-4 py-3 transition ${
                active
                  ? "bg-cyan-600 text-white"
                  : "hover:bg-white"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}