"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

import { loadLatestBalances, loadMinComfortableBalance, PRIMARY_CASH_ACCOUNT } from "@/lib/cashflow";

// Kept as a raw string (not imported from AppIdentityGate) to avoid a
// circular import, since AppIdentityGate itself renders <Sidebar />.
const IDENTITY_SESSION_KEY = "dd_identity";

type PermissionLevel =
  | "public"          // no login needed at all
  | "any"             // any logged-in identity (self-service pages)
  | "canAdmin"
  | "canManageLeave"
  | "canManageEvents"
  | "canManagePayroll";

interface StoredIdentity {
  canAdmin?: boolean;
  canManageLeave?: boolean;
  canManageEvents?: boolean;
  canManageCerts?: boolean;
  canManagePayroll?: boolean;
}

const navItems: { label: string; href: string; icon: string; permission: PermissionLevel; group?: string }[] = [
  { label: "Calendar", href: "/", icon: "📅", permission: "public" },
  { label: "Leave Request", href: "/leave", icon: "📝", permission: "any" },
  { label: "Staff Dashboard", href: "/staff-dashboard", icon: "🗂️", permission: "any" },
  { label: "Certifications", href: "/certifications", icon: "📄", permission: "any" },
  { label: "Schedule Builder", href: "/schedule-builder", icon: "✏️", permission: "canAdmin" },
  { label: "Availability", href: "/availability", icon: "🏥", permission: "canAdmin" },
  { label: "Staff", href: "/staff", icon: "👥", permission: "canAdmin" },
  { label: "Temp Staff", href: "/temps", icon: "🔄", permission: "canAdmin" },
  { label: "Holidays & Closures", href: "/holidays", icon: "🏖️", permission: "canAdmin" },
  { label: "Manage Leave", href: "/leave/manage", icon: "🔐", permission: "canManageLeave" },
  { label: "Events", href: "/events", icon: "📌", permission: "canManageEvents" },
  { label: "Payroll Dashboard", href: "/payroll", icon: "💵", permission: "canManagePayroll", group: "Finances" },
  { label: "Cash Flow", href: "/cashflow", icon: "📊", permission: "canManagePayroll", group: "Finances" },
];

function useIdentity(): StoredIdentity | null {
  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(IDENTITY_SESSION_KEY);
      if (saved) setIdentity(JSON.parse(saved));
    } catch {
      // sessionStorage unavailable — treat as not logged in
    }
  }, []);
  return identity;
}

function hasAccess(permission: PermissionLevel, identity: StoredIdentity | null): boolean {
  if (permission === "public") return true;
  if (!identity) return false;
  if (permission === "any") return true;
  return !!identity[permission];
}

function useLowBalanceWarning(identity: StoredIdentity | null): boolean {
  const [warning, setWarning] = useState(false);
  useEffect(() => {
    if (!identity?.canManagePayroll) return;
    let cancelled = false;
    Promise.all([loadLatestBalances(), loadMinComfortableBalance()]).then(([balances, minComfortable]) => {
      if (cancelled) return;
      const current = balances[PRIMARY_CASH_ACCOUNT]?.balance ?? 0;
      setWarning(current < minComfortable);
    });
    return () => { cancelled = true; };
  }, [identity?.canManagePayroll]);
  return warning;
}

function NavContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const identity = useIdentity();
  const lowBalanceWarning = useLowBalanceWarning(identity);

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

      <nav className="flex-1 overflow-y-auto px-4 py-4 space-y-0.5">
        {navItems.map((item, i) => {
          const active = pathname === item.href;
          const accessible = hasAccess(item.permission, identity);
          const showGroupLabel = item.group && item.group !== navItems[i - 1]?.group;
          return (
            <div key={item.href}>
              {showGroupLabel && (
                <div className="px-3 pt-4 pb-1 text-xs font-semibold tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>
                  {item.group}
                </div>
              )}
              <Link
                href={item.href}
                onClick={onNavigate}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150"
                style={
                  active
                    ? { background: "#e8622a", color: "white", boxShadow: "0 4px 14px rgba(232, 98, 42, 0.35)" }
                    : accessible
                    ? { color: "rgba(255,255,255,0.6)" }
                    : { color: "rgba(255,255,255,0.25)" }
                }
                onMouseEnter={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)";
                    (e.currentTarget as HTMLElement).style.color = accessible ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.4)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                    (e.currentTarget as HTMLElement).style.color = accessible ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.25)";
                  }
                }}
              >
                <span className="text-base leading-none w-5 text-center flex-shrink-0" style={{ opacity: accessible ? 1 : 0.4 }}>{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {item.href === "/cashflow" && lowBalanceWarning && (
                  <span className="text-xs flex-shrink-0" title="Cash balance is low">🚨</span>
                )}
                {!accessible && <span className="text-xs flex-shrink-0" style={{ opacity: 0.5 }}>🔒</span>}
                {active && <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.85)" }} />}
              </Link>
            </div>
          );
        })}
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
