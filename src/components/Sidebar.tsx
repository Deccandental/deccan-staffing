"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

export function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    { label: "📅 Calendar", href: "/" },
    { label: "✏️ Schedule Builder", href: "/schedule-builder" },
    { label: "🏥 Availability", href: "/availability" },
    { label: "👥 Staff", href: "/staff" },
    { label: "📝 Leave Request", href: "/leave" },
    { label: "🔐 Manage Leave", href: "/leave/manage" },
    { label: "🏖️ Holidays & Closures", href: "/holidays" },
    { label: "🔄 Temp Staff", href: "/temps" },
  ];

  return (
    <aside className="fixed left-0 top-0 z-50 h-screen w-64 border-r border-gray-200 bg-white p-6 shadow-sm flex flex-col">
      <div className="mb-8">
        <Image src="/logo.svg" alt="Deccan Dental Sleep Center" width={180} height={80} className="object-contain" priority />
      </div>
      <nav className="space-y-1 flex-1">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} className="block rounded-xl px-4 py-3 text-sm font-medium transition" style={active ? { backgroundColor: "#e8622a", color: "white" } : { color: "#6b7280" }}>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="pt-4 border-t border-gray-100">
        <p className="text-xs text-gray-400 text-center">Staff Scheduler</p>
      </div>
    </aside>
  );
}
