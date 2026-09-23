"use client";

// TEMPORARY SELF-TEST PAGE — delete once the data-loading issue is fixed.
// Tests each layer separately: the raw API, the secureData client wrapper,
// and finally the real library functions the pages call. Whichever layer
// first returns nothing is where the bug is.
import { useState } from "react";
import { secureData } from "@/lib/secureData";
import { loadAllPvBonusQuarters, loadPvBonusPayrollEntries, loadPvBonusPayments, computePvQuarterCalcs } from "@/lib/pvBonus";
import { loadStaff } from "@/lib/staffStore";

export default function SelfTestPage() {
  const [log, setLog] = useState<string[]>([]);

  async function run() {
    const lines: string[] = [];
    const add = (s: string) => lines.push(s);

    // Layer 1: secureData client wrapper
    try {
      const { data, error } = await secureData
        .from("pv_bonus_quarters").select("*").eq("employee_id", 3).order("year");
      add(`1. secureData wrapper: error=${error ? error.message : "none"}, rows=${Array.isArray(data) ? data.length : typeof data}`);
      if (Array.isArray(data) && data[0]) add(`   first row total_income: ${data[0].total_income}`);
    } catch (e: any) {
      add(`1. secureData threw: ${e?.message}`);
    }

    // Layer 2: the real library functions
    try {
      const quarters = await loadAllPvBonusQuarters(3);
      add(`2. loadAllPvBonusQuarters(3): ${quarters.length} quarters`);
      if (quarters[0]) add(`   q1 totalIncome: ${quarters[0].totalIncome}`);

      const entries = await loadPvBonusPayrollEntries(3);
      add(`   loadPvBonusPayrollEntries(3): ${entries.length} entries`);

      const payments = await loadPvBonusPayments(3);
      add(`   loadPvBonusPayments(3): ${payments.length} payments`);

      const calcs = computePvQuarterCalcs(quarters, entries, payments, 30);
      const q1 = calcs.find((c) => c.year === 2026 && c.quarter === 1);
      add(`3. computed Q1 2026: income=${q1?.totalIncome}, 30%=${q1?.thirtyPercent}, gusto=${q1?.gustoPayroll}, bonus=${q1?.bonus}, paid=${q1?.bonusPaid}, balance=${q1?.balance}`);
    } catch (e: any) {
      add(`2. library threw: ${e?.message}`);
    }

    // Layer 3: which employee does the page actually pick?
    try {
      const staff = await loadStaff();
      const eligible = staff.filter((e) => e.pvBonusEligible);
      add(`4. pvBonusEligible staff: ${eligible.map((e) => `${e.name}(id=${e.id})`).join(", ") || "NONE FOUND"}`);
      add(`   total staff loaded: ${staff.length}`);
    } catch (e: any) {
      add(`4. loadStaff threw: ${e?.message}`);
    }

    setLog(lines);
  }

  return (
    <main style={{ padding: 24, fontFamily: "monospace", fontSize: 13 }}>
      <h1 style={{ fontSize: 18, fontWeight: "bold", marginBottom: 12 }}>Self test</h1>
      <p style={{ marginBottom: 12 }}>Log in first, then press Run.</p>
      <button onClick={run} style={{ background: "#e8622a", color: "white", padding: "8px 16px", borderRadius: 8, fontWeight: "bold", border: 0, marginBottom: 16 }}>
        Run test
      </button>
      <pre style={{ whiteSpace: "pre-wrap", background: "#f5f5f5", padding: 12, borderRadius: 8 }}>{log.join("\n")}</pre>
    </main>
  );
}
