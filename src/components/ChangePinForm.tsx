"use client";

import { useState } from "react";
import { getSessionToken } from "@/lib/secureData";

interface Props {
  // When the person has just logged in, we already know their current PIN,
  // so they only need to type the new one.
  knownCurrentPin?: string;
  intro?: string;
  onDone: () => void;
  onSkip?: () => void;
}

export default function ChangePinForm({ knownCurrentPin, intro, onDone, onSkip }: Props) {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setError("");
    if (!/^\d{6}$/.test(newPin)) { setError("Your new PIN must be exactly 6 digits."); return; }
    if (newPin !== confirmPin) { setError("The two new PINs don't match."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/auth/change-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-session-token": getSessionToken() },
        body: JSON.stringify({ currentPin: knownCurrentPin ?? currentPin, newPin }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "Couldn't change your PIN. Please try again."); return; }
      setSaved(true);
    } catch {
      setError("Couldn't reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);
  const inputClass = "w-full rounded-xl border border-gray-200 px-4 py-3 text-center text-xl tracking-widest font-bold focus:outline-none";

  if (saved) {
    return (
      <div className="text-center">
        <div className="text-4xl mb-3">✅</div>
        <p className="text-gray-600 mb-6">Your PIN has been changed. Use your new 6-digit PIN next time you log in.</p>
        <button onClick={onDone} className="w-full rounded-xl py-3 font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>Continue</button>
      </div>
    );
  }

  return (
    <div className="text-center">
      {intro && <p className="text-gray-500 text-sm mb-6">{intro}</p>}
      {knownCurrentPin == null && (
        <input type="password" inputMode="numeric" autoComplete="current-password" value={currentPin}
          onChange={(e) => setCurrentPin(digits(e.target.value))} placeholder="Current PIN" maxLength={6} className={`${inputClass} mb-3`} />
      )}
      <input type="password" inputMode="numeric" autoComplete="new-password" value={newPin}
        onChange={(e) => setNewPin(digits(e.target.value))} placeholder="New 6-digit PIN" maxLength={6} className={`${inputClass} mb-3`} />
      <input type="password" inputMode="numeric" autoComplete="new-password" value={confirmPin}
        onChange={(e) => setConfirmPin(digits(e.target.value))} onKeyDown={(e) => e.key === "Enter" && save()}
        placeholder="Type it again" maxLength={6} className={`${inputClass} mb-3`} />
      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
      <button onClick={save} disabled={saving} className="w-full rounded-xl py-3 font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: "#e8622a" }}>
        {saving ? "Saving…" : "Save new PIN"}
      </button>
      {onSkip && (
        <button onClick={onSkip} className="w-full mt-3 text-sm text-gray-400 hover:text-gray-600">Remind me next time</button>
      )}
    </div>
  );
}
