"use client";

import { useState, useEffect, ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Employee } from "@/types/employee";
import { loadStaff } from "@/lib/staffStore";
import { SUPER_PASSCODE } from "@/lib/passcodes";

export interface AppIdentity {
  mode: "super" | "staff";
  employeeId?: number;
  employeeName?: string;
  employeeEmail?: string;
  canAdmin: boolean;
  canManageLeave: boolean;
  canManageEvents: boolean;
  canManageCerts: boolean;
  canManagePayroll: boolean;
}

export const IDENTITY_SESSION_KEY = "dd_identity";

interface Props {
  children: (identity: AppIdentity, logout: () => void) => ReactNode;
}

export default function AppIdentityGate({ children }: Props) {
  const [checked, setChecked] = useState(false);
  const [identity, setIdentity] = useState<AppIdentity | null>(null);
  const [staff, setStaff] = useState<Employee[]>([]);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    loadStaff().then((s) => { setStaff(s); setStaffLoaded(true); });
    try {
      const saved = sessionStorage.getItem(IDENTITY_SESSION_KEY);
      if (saved) setIdentity(JSON.parse(saved));
    } catch {
      // sessionStorage unavailable — fall back to re-prompting
    }
    setChecked(true);
  }, []);

  function persist(id: AppIdentity) {
    setIdentity(id);
    try { sessionStorage.setItem(IDENTITY_SESSION_KEY, JSON.stringify(id)); } catch {}
  }

  function handleLogin() {
    if (code === SUPER_PASSCODE) {
      persist({
        mode: "super",
        canAdmin: true, canManageLeave: true, canManageEvents: true, canManageCerts: true, canManagePayroll: true,
      });
      return;
    }
    const match = staff.find((e) => e.pin && e.pin === code && !e.archived);
    if (match) {
      persist({
        mode: "staff",
        employeeId: match.id, employeeName: match.name, employeeEmail: match.email ?? "",
        canAdmin: !!match.canAdmin, canManageLeave: !!match.canManageLeave, canManageEvents: !!match.canManageEvents,
        canManageCerts: !!match.canManageCerts, canManagePayroll: !!match.canManagePayroll,
      });
    } else {
      setError(true);
      setCode("");
    }
  }

  function logout() {
    setIdentity(null);
    try { sessionStorage.removeItem(IDENTITY_SESSION_KEY); } catch {}
  }

  // Avoid a flash of the lock screen while we check sessionStorage/staff on mount
  if (!checked || !staffLoaded) return null;

  if (!identity) {
    return (
      <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
        <Sidebar />
        <div className="pt-16 lg:pt-0 lg:ml-64 flex items-center justify-center min-h-screen px-4">
          <div className="rounded-2xl bg-white p-6 sm:p-10 shadow-lg w-full max-w-sm text-center">
            <div className="text-5xl mb-4">🔐</div>
            <h1 className="text-2xl font-bold mb-1" style={{ color: "#5a5a5a" }}>Who's this?</h1>
            <p className="text-gray-400 text-sm mb-8">Enter your personal PIN, or the manager passcode. One login works everywhere in the app.</p>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder="Enter PIN or passcode"
              maxLength={6}
              className={`w-full rounded-xl border px-4 py-3 text-center text-xl tracking-widest font-bold focus:outline-none mb-3 ${
                error ? "border-red-300 bg-red-50" : "border-gray-200"
              }`}
              style={{ fontSize: 24 }}
            />
            {error && <p className="text-red-500 text-sm mb-3">Not recognized.</p>}
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
