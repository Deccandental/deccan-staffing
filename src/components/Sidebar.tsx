"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

import { loadLatestBalances, loadCashAccounts } from "@/lib/cashflow";
import { secureData as supabase } from "@/lib/secureData";
import { getSessionToken, clearSessionToken } from "@/lib/secureData";
import { NavIcon, NavIconName } from "@/components/NavIcons";

// Kept as a raw string (not imported from AppIdentityGate) to avoid a
// circular import, since AppIdentityGate itself renders <Sidebar />.
const IDENTITY_SESSION_KEY = "dd_identity";

type PermissionLevel =
  | "public"          // no login needed at all
  | "any"             // any logged-in identity (self-service pages)
  | "canAdmin"
  | "canManageLeave"
  | "canManageEvents"
  | "canManagePayroll"
  | "canManageStaffNotes";

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
  canManageStaffNotes?: boolean;
}

interface NavItem { label: string; href: string; icon: NavIconName; permission: PermissionLevel }
interface NavGroup { title: string; items: NavItem[]; collapsible?: boolean }

// Grouped so the menu reads as sections rather than one long list. Pages a
// person can't open are left out entirely (a logged-out visitor still sees
// the everyday pages, which ask them to log in).
const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/staff-dashboard", icon: "dashboard", permission: "any" },
      { label: "Calendar", href: "/calendar", icon: "calendar", permission: "public" },
      { label: "Leave Request", href: "/leave", icon: "leave", permission: "any" },
      { label: "Certifications", href: "/certifications", icon: "certificate", permission: "any" },
    ],
  },
  {
    title: "Workplace",
    items: [
      { label: "Handbook", href: "/handbook", icon: "book", permission: "any" },
      { label: "To Review", href: "/review", icon: "checklist", permission: "any" },
      { label: "Check-Ins", href: "/checkins", icon: "handshake", permission: "any" },
      { label: "Set-ups", href: "/setups", icon: "camera", permission: "any" },
      { label: "Events Calendar", href: "/events-calendar", icon: "events", permission: "any" },
    ],
  },
  {
    title: "Team",
    collapsible: true,
    items: [
      { label: "Wishlist", href: "/wishlist", icon: "star", permission: "any" },
      { label: "Live Quiz", href: "/quiz", icon: "target", permission: "any" },
      { label: "Secret Santa", href: "/secret-santa", icon: "gift", permission: "any" },
    ],
  },
  {
    title: "Admin",
    collapsible: true,
    items: [
      { label: "Schedule Builder", href: "/schedule-builder", icon: "pencil", permission: "canAdmin" },
      { label: "Availability", href: "/availability", icon: "clinic", permission: "canAdmin" },
      { label: "Staff", href: "/staff", icon: "users", permission: "canAdmin" },
      { label: "Staff Notes", href: "/staff-notes", icon: "notes", permission: "canManageStaffNotes" },
      { label: "Temp Staff", href: "/temps", icon: "swap", permission: "canAdmin" },
      { label: "Holidays & Closures", href: "/holidays", icon: "sun", permission: "canAdmin" },
      { label: "Open Dental", href: "/open-dental", icon: "clinic", permission: "canAdmin" },
      { label: "Manage Leave", href: "/leave/manage", icon: "shield", permission: "canManageLeave" },
      { label: "Events", href: "/events", icon: "pin", permission: "canManageEvents" },
      { label: "Send for Review", href: "/review-admin", icon: "send", permission: "canAdmin" },
      { label: "Quiz Builder", href: "/quiz-admin", icon: "puzzle", permission: "canAdmin" },
      { label: "Secret Santa Admin", href: "/santa-admin", icon: "giftbox", permission: "canAdmin" },
    ],
  },
  {
    title: "Finances",
    collapsible: true,
    items: [
      { label: "Payroll", href: "/payroll", icon: "money", permission: "canManagePayroll" },
      { label: "Cash Flow", href: "/cashflow", icon: "chart", permission: "canManagePayroll" },
      { label: "Statements", href: "/statements", icon: "folder", permission: "canManagePayroll" },
    ],
  },
];

// Quick-access tabs in the mobile toolbar — the most-used pages, so
// switching between them doesn't need the full menu. "Menu" opens the rest.
const MOBILE_QUICK_TABS: { label: string; href: string; icon: NavIconName }[] = [
  { label: "Dashboard", href: "/staff-dashboard", icon: "dashboard" },
  { label: "Calendar", href: "/calendar", icon: "calendar" },
  { label: "Leave", href: "/leave", icon: "leave" },
  { label: "Certs", href: "/certifications", icon: "certificate" },
];

// Palette: warm neutral surface, ink text, the brand orange as the accent.
// Text is kept dark enough to read comfortably (it was too faint before).
const C = {
  surface: "#FBF8F3",
  border: "rgba(35,38,52,0.10)",
  ink: "#1F2230",
  text: "#33364A",
  muted: "#6B6F80",
  hover: "rgba(35,38,52,0.06)",
  accent: "#E8622A",
  accentSoft: "rgba(232,98,42,0.10)",
};

function logOff() {
  try { sessionStorage.removeItem(IDENTITY_SESSION_KEY); } catch {}
  clearSessionToken();
  window.location.href = "/";
}

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
  const [reviewCount, setReviewCount] = useState(0);   // documents waiting for this person to review
  useEffect(() => {
    if (identity?.mode !== "staff" || identity.employeeId == null) { setReviewCount(0); return; }
    let cancelled = false;
    fetch("/api/reviews/mine", { method: "POST", headers: { "Content-Type": "application/json", "x-session-token": getSessionToken() }, body: JSON.stringify({ action: "count" }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j && typeof j.pending === "number") setReviewCount(j.pending); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [identity]);
  const lowBalanceWarning = useLowBalanceWarning(identity);
  const pendingSignature = usePendingSignature(identity);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(["Team"]));

  function toggle(title: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title); else next.add(title);
      return next;
    });
  }

  // Logged out: show the everyday pages (they lead to the login screen) but
  // not the manager-only sections.
  const visible = (item: NavItem) => hasAccess(item.permission, identity) || (!identity && item.permission === "any");
  const isActive = (href: string) => pathname === href;

  const badge = (href: string) => {
    if (href === "/review" && reviewCount > 0) {
      return <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold flex items-center justify-center" style={{ background: C.accent, color: "#fff" }} title="Documents waiting for your review">{reviewCount}</span>;
    }
    if ((href === "/cashflow" && lowBalanceWarning) || (href === "/handbook" && pendingSignature)) {
      return <span className="ml-auto h-2 w-2 rounded-full flex-shrink-0" style={{ background: href === "/cashflow" ? "#DC2626" : C.accent }}
        title={href === "/cashflow" ? "Cash balance is low" : "Your signature is needed"} />;
    }
    return null;
  };

  const initials = identity?.mode === "super"
    ? "A"
    : (identity?.employeeName ?? "").split(" ").filter((w) => /^[A-Za-z]/.test(w) && !/^Dr\.?$/.test(w)).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

  return (
    <>
      <div className="px-6 pt-7 pb-5 flex-shrink-0">
        <Link href="/staff-dashboard" onClick={onNavigate} className="block">
          <Image src="/logo.svg" alt="Deccan Dental Sleep Center" width={180} height={62} className="object-contain" priority />
        </Link>
        <div className="mt-2 text-[11px] font-medium tracking-[0.14em] uppercase" style={{ color: C.muted }}>Staff Portal</div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter(visible);
          if (items.length === 0) return null;
          const hasActive = items.some((i) => isActive(i.href));
          const isCollapsed = !!group.collapsible && collapsed.has(group.title) && !hasActive;
          return (
            <div key={group.title} className="mt-4 first:mt-0">
              {group.collapsible ? (
                <button onClick={() => toggle(group.title)} aria-expanded={!isCollapsed}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] uppercase rounded-md transition-colors"
                  style={{ color: C.muted }}>
                  <span>{group.title}</span>
                  <NavIcon name="chevron" size={14} style={{ transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform 0.15s" }} />
                </button>
              ) : (
                <div className="px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] uppercase" style={{ color: C.muted }}>{group.title}</div>
              )}
              {!isCollapsed && (
                <ul className="mt-0.5 space-y-0.5">
                  {items.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={onNavigate}
                          aria-current={active ? "page" : undefined}
                          className="group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors"
                          style={active
                            ? { background: C.accentSoft, color: C.ink, fontWeight: 600 }
                            : { color: C.text, fontWeight: 500 }}
                          onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = C.hover; }}
                          onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                        >
                          {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full" style={{ background: C.accent }} />}
                          <NavIcon name={item.icon} size={18} style={{ color: active ? C.accent : C.muted, flexShrink: 0 }} />
                          <span className="truncate">{item.label}</span>
                          {badge(item.href)}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      <div className="px-3 py-3 flex-shrink-0" style={{ borderTop: `1px solid ${C.border}` }}>
        {identity ? (
          <div className="flex items-center gap-3 rounded-lg px-3 py-2">
            <div className="h-9 w-9 rounded-full flex items-center justify-center text-[13px] font-semibold flex-shrink-0"
              style={{ background: C.accentSoft, color: C.accent }}>
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold truncate" style={{ color: C.ink }}>
                {identity.mode === "super" ? "Administrator" : identity.employeeName ?? "Signed in"}
              </div>
              <div className="text-[12px] truncate" style={{ color: C.muted }}>
                {identity.mode === "super" ? "Master passcode" : "Deccan Dental"}
              </div>
            </div>
            <button onClick={logOff} title="Log out" aria-label="Log out"
              className="h-8 w-8 rounded-md flex items-center justify-center transition-colors flex-shrink-0"
              style={{ color: C.muted }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = C.hover; (e.currentTarget as HTMLElement).style.color = C.ink; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = C.muted; }}>
              <NavIcon name="logout" size={18} />
            </button>
          </div>
        ) : (
          <Link href="/staff-dashboard" onClick={onNavigate}
            className="flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-[14px] font-semibold text-white"
            style={{ background: C.accent }}>
            Log in
          </Link>
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
      <aside className="hidden lg:flex fixed left-0 top-0 z-50 h-screen w-64 flex-col"
        style={{ background: C.surface, borderRight: `1px solid ${C.border}`, fontFamily: "'DM Sans', sans-serif" }}>
        <NavContent pathname={pathname} />
      </aside>

      {/* ── Mobile top bar (< lg) ── */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50"
        style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, fontFamily: "'DM Sans', sans-serif" }}>
        <div className="flex items-center justify-between px-4 h-11">
          <div style={{ fontWeight: 700, color: C.ink, fontSize: 16, fontFamily: "'Poppins', sans-serif" }}>
            deccan<span style={{ color: C.accent }}>|</span>dental
          </div>
        </div>
        <div className="flex items-stretch" style={{ borderTop: `1px solid ${C.border}` }}>
          {MOBILE_QUICK_TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link key={tab.href} href={tab.href} className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5"
                style={{ color: active ? C.accent : C.muted, boxShadow: active ? `inset 0 -2px 0 ${C.accent}` : "none" }}>
                <NavIcon name={tab.icon} size={20} />
                <span style={{ fontSize: 11, fontWeight: active ? 600 : 500 }}>{tab.label}</span>
              </Link>
            );
          })}
          <button onClick={() => setOpen(true)} className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5" style={{ color: C.muted }}>
            <NavIcon name="menu" size={20} />
            <span style={{ fontSize: 11, fontWeight: 500 }}>Menu</span>
          </button>
        </div>
      </div>

      {/* ── Mobile drawer ── */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0" style={{ background: "rgba(15,17,26,0.45)" }} onClick={() => setOpen(false)} />
          <aside className="relative flex flex-col w-72 max-w-[85vw] h-full shadow-xl"
            style={{ background: C.surface, fontFamily: "'DM Sans', sans-serif" }}>
            <button onClick={() => setOpen(false)} aria-label="Close menu"
              className="absolute top-4 right-3 h-8 w-8 rounded-md flex items-center justify-center" style={{ color: C.muted }}>
              <NavIcon name="close" size={18} />
            </button>
            <NavContent pathname={pathname} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
