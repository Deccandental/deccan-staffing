"use client";

import { useState, useEffect, ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { PasscodeGroup, PASSCODES, SESSION_KEYS } from "@/lib/passcodes";

interface Props {
  group: PasscodeGroup;
  title?: string;
  subtitle?: string;
  children: ReactNode;
}

export default function PasscodeGate({
  group,
  title = "Manager Access",
  subtitle = "Enter your passcode to continue",
  children,
}: Props) {
  const [checked, setChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [passcodeError, setPasscodeError] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_KEYS[group]) === "1") {
        setAuthenticated(true);
      }
    } catch {
      // sessionStorage unavailable (e.g. private browsing edge cases) — fall back to re-prompting
    }
    setChecked(true);
  }, [group]);

  function handlePasscode() {
    if (passcode === PASSCODES[group]) {
      setAuthenticated(true);
      setPasscodeError(false);
      try {
        sessionStorage.setItem(SESSION_KEYS[group], "1");
      } catch {}
    } else {
      setPasscodeError(true);
      setPasscode("");
    }
  }

  // Avoid a flash of the lock screen while we check sessionStorage on mount
  if (!checked) return null;

  if (!authenticated) {
    return (
      <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
        <Sidebar />
        <div className="ml-64 flex items-center justify-center min-h-screen">
          <div className="rounded-2xl bg-white p-10 shadow-lg w-full max-w-sm text-center">
            <div className="text-5xl mb-4">🔐</div>
            <h1 className="text-2xl font-bold mb-1" style={{ color: "#5a5a5a" }}>{title}</h1>
            <p className="text-gray-400 text-sm mb-8">{subtitle}</p>
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handlePasscode()}
              placeholder="Enter passcode"
              maxLength={6}
              className={`w-full rounded-xl border px-4 py-3 text-center text-xl tracking-widest font-bold focus:outline-none mb-3 ${
                passcodeError ? "border-red-300 bg-red-50" : "border-gray-200"
              }`}
            />
            {passcodeError && <p className="text-red-500 text-sm mb-3">Incorrect passcode.</p>}
            <button
              onClick={handlePasscode}
              className="w-full rounded-xl py-3 font-semibold text-white hover:opacity-90"
              style={{ backgroundColor: "#e8622a" }}
            >
              Unlock
            </button>
          </div>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
