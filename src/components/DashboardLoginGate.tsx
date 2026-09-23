"use client";

import { useState, useEffect, ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Employee } from "@/types/employee";
import { loadStaff } from "@/lib/staffStore";
import { storeSessionToken, clearSessionToken, hasSessionToken } from "@/lib/secureData";

export type DashboardIdentity =
  | { mode: "staff"; employeeId: number; employeeName: string }
  | { mode: "manager" };

const SESSION_KEY = "dd_dashboard_identity";

interface Props {
  children: (identity: DashboardIdentity, logout: () => void) => ReactNode;
}

export default function DashboardLoginGate({ children }: Props) {
  const [checked, setChecked] = useState(false);
  const [identity, setIdentity] = useState<DashboardIdentity | null>(null);
  const [staff, setStaff] = useState<Employee[]>([]);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    loadStaff().then((s) => { setStaff(s); setStaffLoaded(true); });
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      // Only trust a stored session if its token is still present —
      // otherwise the UI would look logged in while every data request
      // silently failed for lack of a token.
      if (saved && hasSessionToken()) setIdentity(JSON.parse(saved));
      else if (saved) sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // sessionStorage unavailable — fall back to re-prompting
    }
    setChecked(true);
  }, []);

  function persist(id: DashboardIdentity) {
    setIdentity(id);
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(id)); } catch {}
  }

  async function handleLogin() {
    let res: Response;
    try {
      res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    } catch {
      setError(true);
      setCode("");
      return;
    }
    const result = await res.json();
    if (result.token) storeSessionToken(result.token);
    if (result.isSuper) {
      persist({ mode: "manager" });
      return;
    }
    if (result.ok && result.employee) {
      const match = result.employee;
      if (match.canAdmin) {
        persist({ mode: "manager" });
        return;
      }
      persist({ mode: "staff", employeeId: match.id, employeeName: match.name });
    } else {
      setError(true);
      setCode("");
    }
  }

  function logout() {
    setIdentity(null);
    clearSessionToken();
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  }

  // Avoid a flash of the lock screen while we check sessionStorage on mount
  if (!checked || !staffLoaded) return null;

  if (!identity) {
    return (
      <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
        <Sidebar />
        <div className="pt-16 lg:pt-0 lg:ml-64 flex items-center justify-center min-h-screen px-4">
          <div className="rounded-2xl bg-white p-6 sm:p-10 shadow-lg w-full max-w-sm text-center">
            <div className="text-5xl mb-4">🔐</div>
            <h1 className="text-2xl font-bold mb-1" style={{ color: "#5a5a5a" }}>Who's this?</h1>
            <p className="text-gray-400 text-sm mb-8">Enter your personal PIN to see your own dashboard. Managers can enter their passcode instead.</p>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder="Enter your PIN"
              maxLength={6}
              className={`w-full rounded-xl border px-4 py-3 text-center text-xl tracking-widest font-bold focus:outline-none mb-3 ${
                error ? "border-red-300 bg-red-50" : "border-gray-200"
              }`}
              style={{ fontSize: 24 }}
            />
            {error && <p className="text-red-500 text-sm mb-3">PIN not recognized.</p>}
            <button
              onClick={handleLogin}
              className="w-full rounded-xl py-3 font-semibold text-white hover:opacity-90"
              style={{ backgroundColor: "#e8622a" }}
            >
              Continue
            </button>
          </div>
        </div>
      </main>
    );
  }

  return <>{children(identity, logout)}</>;
}
