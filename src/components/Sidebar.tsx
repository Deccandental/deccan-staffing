"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const navGroups = [
  {
    label: "Scheduling",
    items: [
      { label: "Calendar", href: "/", icon: "📅" },
      { label: "Schedule Builder", href: "/schedule-builder", icon: "✏️" },
      { label: "Availability", href: "/availability", icon: "🏥" },
    ],
  },
  {
    label: "Team",
    items: [
      { label: "Staff", href: "/staff", icon: "👥" },
      { label: "Temp Staff", href: "/temps", icon: "🔄" },
    ],
  },
  {
    label: "Leave",
    items: [
      { label: "Leave Request", href: "/leave", icon: "📝" },
      { label: "Manage Leave", href: "/leave/manage", icon: "🔐" },
    ],
  },
  {
    label: "Office",
    items: [
      { label: "Holidays & Closures", href: "/holidays", icon: "🏖️" },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="fixed left-0 top-0 z-50 h-screen w-64 flex flex-col"
      style={{
        background: "linear-gradient(180deg, #1e1e2e 0%, #2a2a3e 100%)",
        borderRight: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Logo area */}
      <div className="px-6 py-6 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <Image
          src="/logo.svg"
          alt="Deccan Dental Sleep Center"
          width={160}
          height={60}
          className="object-contain brightness-0 invert"
          priority
        />
        <div
          className="mt-2 text-xs font-semibold tracking-widest uppercase"
          style={{ color: "rgba(255,255,255,0.3)" }}
        >
          Staff Scheduler
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div
              className="text-xs font-bold uppercase tracking-widest mb-2 px-3"
              style={{ color: "rgba(255,255,255,0.25)" }}
            >
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150"
                    style={
                      active
                        ? {
                            background: "#e8622a",
                            color: "white",
                            boxShadow: "0 4px 12px rgba(232, 98, 42, 0.4)",
                          }
                        : {
                            color: "rgba(255,255,255,0.55)",
                          }
                    }
                    onMouseEnter={(e) => {
                      if (!active) {
                        (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.07)";
                        (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.9)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!active) {
                        (e.currentTarget as HTMLElement).style.background = "transparent";
                        (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.55)";
                      }
                    }}
                  >
                    <span className="text-base leading-none w-5 text-center flex-shrink-0">{item.icon}</span>
                    <span>{item.label}</span>
                    {active && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white opacity-80 flex-shrink-0" />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div
        className="px-6 py-4 flex-shrink-0"
        style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
            style={{ background: "#e8622a" }}
          >
            D
          </div>
          <div>
            <div className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.7)" }}>
              Deccan Dental
            </div>
            <div className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
              Sleep Center
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
