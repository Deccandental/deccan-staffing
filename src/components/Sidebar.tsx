"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "Dashboard", href: "/", icon: "🏠" },
  { label: "Physicians", href: "/physicians", icon: "🩺" },
  { label: "Labs & Appliances", href: "/labs", icon: "🦷" },
  { label: "How to Use", href: "/guide", icon: "📖" },
  { label: "Settings", href: "/settings", icon: "⚙️" },
];

async function lockApp() {
  await fetch("/api/auth", { method: "DELETE" });
  window.location.href = "/lock";
}

function NavContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      <div className="px-5 py-5 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="rounded-xl px-3 py-2.5 flex items-center justify-center" style={{ background: "white" }}>
          <img src="/logo.svg" alt="Deccan Dental Sleep Center" style={{ width: 160, height: 55, objectFit: "contain" }} />
        </div>
        <div className="mt-3 text-xs font-semibold tracking-widest uppercase text-center" style={{ color: "rgba(255,255,255,0.3)" }}>
          Sleep Medicine
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 py-5 space-y-1.5">
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className="flex items-center gap-3 rounded-xl px-3.5 py-3 text-[0.9375rem] font-medium transition-all duration-150"
              style={active
                ? { background: "#e8622a", color: "white", boxShadow: "0 4px 14px rgba(232, 98, 42, 0.35)", display: "flex" }
                : { color: "rgba(255,255,255,0.6)", display: "flex" }
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
              <span style={{ fontSize: "1.25rem", lineHeight: 1, width: "1.5rem", textAlign: "center", flexShrink: 0 }}>{item.icon}</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {active && <span style={{ height: "0.375rem", width: "0.375rem", borderRadius: "50%", flexShrink: 0, background: "rgba(255,255,255,0.85)" }} />}
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 flex-shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div style={{ height: "2rem", width: "2rem", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: "0.75rem", fontWeight: "bold", flexShrink: 0, background: "#e8622a" }}>D</div>
          <div style={{ flex: 1 }}>
            <div className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.75)" }}>Deccan Dental</div>
            <div className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Sleep Medicine</div>
          </div>
          <button onClick={lockApp} title="Lock this session"
            style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "0.5rem", padding: "0.375rem 0.5rem", cursor: "pointer", fontSize: "0.875rem", lineHeight: 1, flexShrink: 0 }}>
            🔒
          </button>
        </div>
      </div>
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const sidebarStyle: React.CSSProperties = {
    background: "linear-gradient(180deg, #2d3148 0%, #353a56 100%)",
    borderRight: "1px solid rgba(255,255,255,0.08)",
  };

  return (
    <>
      {/* Desktop sidebar */}
      {isDesktop && (
        <aside style={{ ...sidebarStyle, position: "fixed", left: 0, top: 0, zIndex: 50, height: "100vh", width: "16rem", display: "flex", flexDirection: "column" }}>
          <NavContent pathname={pathname} />
        </aside>
      )}

      {/* Mobile top bar */}
      {!isDesktop && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1rem", background: "white", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
          <div>
            <div style={{ fontWeight: 700, color: "#5a5a5a", fontSize: 16 }}>deccan<span style={{ color: "#e8622a" }}>|</span>dental</div>
            <div style={{ fontSize: 10, color: "#9a9a9a", letterSpacing: "0.1em" }}>SLEEP MEDICINE</div>
          </div>
          <button onClick={() => setOpen(true)} style={{ fontSize: 24, color: "#5a5a5a", lineHeight: 1, background: "none", border: "none", cursor: "pointer" }}>☰</button>
        </div>
      )}

      {/* Mobile drawer */}
      {!isDesktop && open && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex" }}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => setOpen(false)} />
          <aside style={{ ...sidebarStyle, position: "relative", display: "flex", flexDirection: "column", width: "18rem", height: "100%" }}>
            <button onClick={() => setOpen(false)} style={{ position: "absolute", top: "1rem", right: "1rem", color: "white", fontSize: "1.25rem", opacity: 0.6, background: "none", border: "none", cursor: "pointer" }}>✕</button>
            <NavContent pathname={pathname} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
