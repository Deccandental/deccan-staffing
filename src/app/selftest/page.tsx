"use client";

// TEMPORARY SELF-TEST PAGE — delete once the data-loading issue is fixed.
// Runs the exact same request path the real pages use, from inside the
// browser, and prints every step on screen. This avoids needing dev tools
// to see what's actually failing.
import { useState } from "react";

export default function SelfTestPage() {
  const [log, setLog] = useState<string[]>([]);
  const add = (line: string) => setLog((l) => [...l, line]);

  async function run() {
    setLog([]);

    // 1. What's in sessionStorage?
    let token = "";
    try {
      token = sessionStorage.getItem("dd_session_token") ?? "";
      const identity = sessionStorage.getItem("dd_identity") ?? "";
      add(`1. token in browser: ${token ? `YES (${token.length} chars)` : "NO — none stored"}`);
      add(`   identity in browser: ${identity ? "YES" : "NO"}`);
      if (identity) add(`   identity value: ${identity}`);
    } catch (e: any) {
      add(`1. sessionStorage unavailable: ${e?.message}`);
    }

    // 2. Call secure-data exactly as the app does.
    try {
      const res = await fetch("/api/secure-data", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-session-token": token },
        body: JSON.stringify({
          table: "pv_bonus_quarters",
          action: "select",
          columns: "*",
          filters: [{ column: "employee_id", op: "eq", value: 3 }],
          order: [{ column: "year", ascending: true }],
        }),
      });
      add(`2. /api/secure-data status: ${res.status}`);
      const text = await res.text();
      add(`   response: ${text.slice(0, 600)}`);
    } catch (e: any) {
      add(`2. request threw: ${e?.message}`);
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "monospace", fontSize: 13 }}>
      <h1 style={{ fontSize: 18, fontWeight: "bold", marginBottom: 12 }}>Self test</h1>
      <p style={{ marginBottom: 12 }}>
        Log in to the app normally first (so a session exists), then come back here and press Run.
      </p>
      <button
        onClick={run}
        style={{ background: "#e8622a", color: "white", padding: "8px 16px", borderRadius: 8, fontWeight: "bold", border: 0, marginBottom: 16 }}
      >
        Run test
      </button>
      <pre style={{ whiteSpace: "pre-wrap", background: "#f5f5f5", padding: 12, borderRadius: 8 }}>
        {log.join("\n")}
      </pre>
    </main>
  );
}
