"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

import { loadLatestBalances, loadCashAccounts } from "@/lib/cashflow";
import { supabase } from "@/lib/supabase";

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
  mode?: "super" | "staff";
  employeeId?: number;
  employeeName?: string;
  exemptFromPolicySigning?: boolean;
  canAdmin?: boolean;
  canManageLeave?: boolean;
  canManageEvents?: boolean;
  canManageCerts?: boolean;
  canManagePayroll?: boolean;
}

const navItems: { label: string; href: string; icon: string; permission: PermissionLevel; group?: string }[] = [
  { label: "Calendar", href: "/calendar", icon: "📅", permission: "public" },
  { label: "Leave Request", href: "/leave", icon: "📝", permission: "any" },
  { label: "Staff Dashboard", href: "/staff-dashboard", icon: "🗂️", permission: "any" },
  { label: "Certifications", href: "/certifications", icon: "📄", permission: "any" },
  { label: "Wishlist", href: "/wishlist", icon: "⭐", permission: "any" },
  { label: "Handbook", href: "/handbook", icon: "📘", permission: "any" },
  { label: "Check-Ins", href: "/checkins", icon: "🤝", permission: "any" },
  { label: "Events Calendar", href: "/events-calendar", icon: "🗓️", permission: "any" },
  { label: "Schedule Builder", href: "/schedule-builder", icon: "✏️", permission: "canAdmin", group: "Admin" },
  { label: "Availability", href: "/availability", icon: "🏥", permission: "canAdmin", group: "Admin" },
  { label: "Staff", href: "/staff", icon: "👥", permission: "canAdmin", group: "Admin" },
  { label: "Temp Staff", href: "/temps", icon: "🔄", permission: "canAdmin", group: "Admin" },
  { label: "Holidays & Closures", href: "/holidays", icon: "🏖️", permission: "canAdmin", group: "Admin" },
  { label: "Manage Leave", href: "/leave/manage", icon: "🔐", permission: "canManageLeave", group: "Admin" },
  { label: "Events", href: "/events", icon: "📌", permission: "canManageEvents", group: "Admin" },
  { label: "Payroll Dashboard", href: "/payroll", icon: "💵", permission: "canManagePayroll", group: "Finances" },
  { label: "Cash Flow", href: "/cashflow", icon: "📊", permission: "canManagePayroll", group: "Finances" },
];

// Quick-access tabs in the mobile toolbar — a handful of the most-used
// pages, so switching between them doesn't require opening the full menu
// each time. "More" (added separately) opens the full drawer for everything else.
const MOBILE_QUICK_TABS = [
  { label: "Dashboard", href: "/staff-dashboard", icon: "🗂️" },
  { label: "Calendar", href: "/calendar", icon: "📅" },
  { label: "Leave", href: "/leave", icon: "📝" },
  { label: "Certs", href: "/certifications", icon: "📄" },
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
    Promise.all([loadLatestBalances(), loadCashAccounts()]).then(([balances, accounts]) => {
      if (cancelled) return;
      const fifthThird = accounts.find((a) => a.name === "Fifth Third");
      if (!fifthThird) { setWarning(false); return; }
      const current = balances[fifthThird.name]?.balance ?? 0;
      setWarning(current < fifthThird.cushionTarget);
    });
    return () => { cancelled = true; };
  }, [identity?.canManagePayroll]);
  return warning;
}

function usePendingSignature(identity: StoredIdentity | null): boolean {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (identity?.employeeId == null || identity.exemptFromPolicySigning) return;
    let cancelled = false;
    (async () => {
      const { data: docs } = await supabase.from("policy_documents").select("id, restricted_to_employee_id");
      for (const doc of docs ?? []) {
        if (doc.restricted_to_employee_id != null && doc.restricted_to_employee_id !== identity.employeeId) continue;
        const { data: reqRow } = await supabase.from("policy_requirements").select("id")
          .eq("document_id", doc.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (!reqRow) continue;
        const { data: sig } = await supabase.from("policy_signatures").select("id")
          .eq("requirement_id", reqRow.id).eq("employee_id", identity.employeeId).maybeSingle();
        if (!sig && !cancelled) { setPending(true); return; }
      }
      if (!cancelled) setPending(false);
    })();
    return () => { cancelled = true; };
  }, [identity?.employeeId]);
  return pending;
}

function NavContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const identity = useIdentity();
  const lowBalanceWarning = useLowBalanceWarning(identity);
  const pendingSignature = usePendingSignature(identity);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(["Admin", "Finances"]));

  function toggleGroup(group: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  }

  return (
    <>
      <div className="px-5 py-6 flex-shrink-0" style={{ borderBottom: "1px solid rgba(35,38,52,0.08)" }}>
        <div className="flex items-center justify-center">
          <Image src="/logo.svg" alt="Deccan Dental Sleep Center" width={230} height={80} className="object-contain" priority />
        </div>
        <div className="mt-3 text-xs font-semibold tracking-widest uppercase text-center" style={{ color: "rgba(35,38,52,0.45)", fontFamily: "'Poppins', sans-serif" }}>
          Staff Scheduler
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {navItems.map((item, i) => {
          const active = pathname === item.href;
          const accessible = hasAccess(item.permission, identity);
          const showGroupLabel = item.group && item.group !== navItems[i - 1]?.group;
          // A group stays open if the current page lives inside it, even if collapsed.
          const groupHasActiveItem = item.group ? navItems.some((n) => n.group === item.group && n.href === pathname) : false;
          const groupCollapsed = !!item.group && collapsedGroups.has(item.group) && !groupHasActiveItem;
          if (item.group && groupCollapsed && !showGroupLabel) return null;
          return (
            <div key={item.href}>
              {showGroupLabel && (
                <button
                  onClick={() => toggleGroup(item.group!)}
                  className="w-full flex items-center justify-between px-4 pt-4 pb-1 text-xs font-bold tracking-widest uppercase"
                  style={{ color: "rgba(74,66,56,0.6)" }}
                >
                  <span>{item.group}</span>
                  <span className="text-[10px] normal-case tracking-normal font-semibold" style={{ transform: groupCollapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>▾</span>
                </button>
              )}
              {!groupCollapsed && (
              <Link
                href={item.href}
                onClick={onNavigate}
                className="flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-150"
                style={
                  active
                    ? { background: "#EF843F", color: "white", boxShadow: "0 4px 14px rgba(239, 132, 63, 0.35)" }
                    : accessible
                    ? { color: "rgba(74,66,56,0.85)" }
                    : { color: "rgba(74,66,56,0.28)" }
                }
                onMouseEnter={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLElement).style.background = "#FCE8D5";
                    (e.currentTarget as HTMLElement).style.color = accessible ? "#B8501E" : "rgba(74,66,56,0.55)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                    (e.currentTarget as HTMLElement).style.color = accessible ? "rgba(74,66,56,0.85)" : "rgba(74,66,56,0.28)";
                  }
                }}
              >
                <span className="text-base leading-none w-5 text-center flex-shrink-0" style={{ opacity: accessible ? 1 : 0.4 }}>{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {item.href === "/cashflow" && lowBalanceWarning && (
                  <span className="text-xs flex-shrink-0" title="Cash balance is low">🚨</span>
                )}
                {item.href === "/handbook" && pendingSignature && (
                  <span className="text-xs flex-shrink-0" title="Signature needed">✍️</span>
                )}
                {!accessible && <span className="text-xs flex-shrink-0" style={{ opacity: 0.5 }}>🔒</span>}
                {active && <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.85)" }} />}
              </Link>
              )}
            </div>
          );
        })}
      </nav>

      <div className="px-5 py-4 flex-shrink-0" style={{ borderTop: "1px solid rgba(74,66,56,0.08)" }}>
        {identity ? (
          <div>
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ background: "#EF843F" }}>
                {identity.mode === "super" ? "A" : (identity.employeeName ?? "?").charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="text-xs font-bold" style={{ color: "#4A4238" }}>
                  {identity.mode === "super" ? "Admin (passcode)" : identity.employeeName ?? "Signed in"}
                </div>
                <div className="text-xs" style={{ color: "rgba(74,66,56,0.55)" }}>Deccan Dental</div>
              </div>
            </div>
            <button
              onClick={() => { try { sessionStorage.removeItem(IDENTITY_SESSION_KEY); } catch {} window.location.href = "/"; }}
              className="mt-2 text-xs underline font-medium"
              style={{ color: "rgba(74,66,56,0.6)" }}
            >
              Not you? Log off
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ background: "#EF843F" }}>D</div>
            <div>
              <div className="text-xs font-bold" style={{ color: "#4A4238" }}>Deccan Dental</div>
              <div className="text-xs" style={{ color: "rgba(74,66,56,0.55)" }}>Sleep Center</div>
            </div>
          </div>
        )}
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
        style={{ background: "#FBF7EF", borderRight: "1px solid rgba(74,66,56,0.08)" }}
      >
        <NavContent pathname={pathname} />
      </aside>

      {/* ── Mobile top bar (< lg) ── */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50" style={{ background: "#FBF7EF", boxShadow: "0 1px 3px rgba(74,66,56,0.08)" }}>
        <div className="flex items-center justify-between px-4 py-2">
          <div style={{ fontWeight: 700, color: "#232634", fontSize: 16, fontFamily: "'Poppins', sans-serif" }}>
            deccan<span style={{ color: "#EF843F" }}>|</span>dental
          </div>
        </div>
        <div className="flex items-stretch border-t" style={{ borderColor: "rgba(35,38,52,0.08)" }}>
          {MOBILE_QUICK_TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <a key={tab.href} href={tab.href} className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2"
                style={{ borderTop: active ? "2px solid #EF843F" : "2px solid transparent" }}>
                <span style={{ fontSize: 19 }}>{tab.icon}</span>
                <span style={{ fontSize: 10, fontWeight: active ? 700 : 500, color: active ? "#DE6C24" : "rgba(35,38,52,0.55)", fontFamily: "'Poppins', sans-serif" }}>{tab.label}</span>
              </a>
            );
          })}
          <button onClick={() => setOpen(true)} className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2" style={{ borderTop: "2px solid transparent" }}>
            <span style={{ fontSize: 19 }}>☰</span>
            <span style={{ fontSize: 10, fontWeight: 500, color: "rgba(35,38,52,0.55)", fontFamily: "'Poppins', sans-serif" }}>More</span>
          </button>
        </div>
      </div>

      {/* ── Mobile drawer overlay ── */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black bg-opacity-50" onClick={() => setOpen(false)} />
          <aside
            className="relative flex flex-col w-72 h-full"
            style={{ background: "#FBF7EF" }}
          >
            <button
              onClick={() => setOpen(false)}
              className="absolute top-4 right-4 text-xl opacity-50 hover:opacity-100 transition"
              style={{ color: "#4A4238" }}
              aria-label="Close menu"
            >✕</button>
            <NavContent pathname={pathname} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
