"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { usePathname } from "next/navigation";

const navGroups = [
  {
    label: "Open Access",
    items: [
      { label: "Calendar", href: "/", icon: "📅" },
      { label: "Leave Request", href: "/leave", icon: "📝" },
    ],
  },
  {
    label: "Admin 🔒",
    items: [
      { label: "Schedule Builder", href: "/schedule-builder", icon: "✏️" },
      { label: "Availability", href: "/availability", icon: "🏥" },
      { label: "Staff", href: "/staff", icon: "👥" },
      { label: "Temp Staff", href: "/temps", icon: "🔄" },
      { label: "Holidays & Closures", href: "/holidays", icon: "🏖️" },
    ],
  },
  {
    label: "Leave Management 🔒",
    items: [
      { label: "Manage Leave", href: "/leave/manage", icon: "🔐" },
    ],
  },
];

function NavContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      <div className="px-5 py-5 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="rounded-xl px-3 py-2.5 flex items-center justify-center" style={{ background: "white" }}>
          <Image src="/logo.svg" alt="Deccan Dental Sleep Center" width={160} height={55} className="object-contain" priority />
        </div>
        <div className="mt-3 text-xs font-semibold tracking-widest uppercase text-center" style={{ color: "rgba(255,255,255,0.3)" }}>
          Staff Scheduler
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div className="text-xs font-bold uppercase tracking-widest mb-1.5 px-3" style={{ color: "rgba(255,255,255,0.28)" }}>
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150"
                    style={active
                      ? { background: "#e8622a", color: "white", boxShadow: "0 4px 14px rgba(232, 98, 42, 0.35)" }
                      : { color: "rgba(255,255,255,0.6)" }
                    }
                    onMouseEnter={(e) => {
                      if (!active) {
                        (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)";
                        (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.95)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!active) {
                        (e.currentTarget as HTMLElement).style.background = "transparent";
                        (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.6)";
                      }
                    }}
                  >
                    <span className="text-base leading-none w-5 text-center flex-shrink-0">{item.icon}</span>
                    <span className="flex-1">{item.label}</span>
                    {active && <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.85)" }} />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-5 py-4 flex-shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ background: "#e8622a" }}>D</div>
          <div>
            <div className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.75)" }}>Deccan Dental</div>
            <div className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Sleep Center</div>
          </div>
        </div>
      </div>
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* ── Desktop sidebar (lg+) ── */}
      <aside
        className="hidden lg:flex fixed left-0 top-0 z-50 h-screen w-64 flex-col"
        style={{ background: "linear-gradient(180deg, #2d3148 0%, #353a56 100%)", borderRight: "1px solid rgba(255,255,255,0.08)" }}
      >
        <NavContent pathname={pathname} />
      </aside>

      {/* ── Mobile top bar (< lg) ── */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3 bg-white shadow-sm">
        <div>
          <div style={{ fontWeight: 700, color: "#5a5a5a", fontSize: 16 }}>
            deccan<span style={{ color: "#e8622a" }}>|</span>dental
          </div>
          <div style={{ fontSize: 10, color: "#9a9a9a", letterSpacing: "0.1em" }}>STAFF SCHEDULER</div>
        </div>
        <button onClick={() => setOpen(true)} style={{ fontSize: 24, color: "#5a5a5a", lineHeight: 1 }} aria-label="Open menu">☰</button>
      </div>

      {/* ── Mobile drawer overlay ── */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black bg-opacity-50" onClick={() => setOpen(false)} />
          <aside
            className="relative flex flex-col w-72 h-full"
            style={{ background: "linear-gradient(180deg, #2d3148 0%, #353a56 100%)" }}
          >
            <button
              onClick={() => setOpen(false)}
              className="absolute top-4 right-4 text-white text-xl opacity-60 hover:opacity-100 transition"
              aria-label="Close menu"
            >✕</button>
            <NavContent pathname={pathname} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
