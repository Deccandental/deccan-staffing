"use client";

import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "@/components/Sidebar";
import { supabase } from "@/lib/supabase";
import { getSessionToken, storeSessionToken, clearSessionToken, hasSessionToken } from "@/lib/secureData";

/**
 * Monthly statements: a checklist of every account, card and loan against every month, with the PDF
 * filed right where it's ticked off. Finance users upload and mark; the CPA (own passcode) can only
 * view and download. Files live in a private bucket and are only ever reached through short-lived links.
 */

type Role = "finance" | "cpa";
interface Account { kind: "bank" | "card" | "loan" | "vendor"; id: string; name: string; category?: string; startMonth?: string; active?: boolean }
interface FileRow { dup_ignored?: boolean; doc_type?: string; invoice_date?: string | null; invoice_number?: string; amount?: number | null; id: string; account_kind: string; account_id: string; account_name: string; month: string; file_name: string | null; size_bytes: number | null; no_statement: boolean; note: string; uploaded_by: string; uploaded_at: string }

const ROLE_KEY = "dd_statements_role";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KIND_LABEL: Record<string, string> = { bank: "Bank accounts", card: "Credit cards", loan: "Loans" };
const VENDOR_LABEL: Record<string, string> = { Lab: "Labs", Supplier: "Suppliers", Insurance: "Insurance", Other: "Other vendors" };
const acctKey = (kind: string, id: string) => `${kind}:${id}`;
const mkey = (year: number, m: number) => `${year}-${String(m).padStart(2, "0")}`;

async function api(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; json: any }> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "x-session-token": getSessionToken() }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  } catch (e: any) {
    return { ok: false, status: 0, json: { error: e?.message ?? "Network error." } };
  }
}

export default function StatementsPage() {
  const thisYear = new Date().getFullYear();
  const [checked, setChecked] = useState(false);
  const [role, setRole] = useState<Role | null>(null);
  const [code, setCode] = useState("");
  const [loginError, setLoginError] = useState("");
  const [year, setYear] = useState(thisYear);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [sel, setSel] = useState<{ key: string; month: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [sAmount, setSAmount] = useState("");
  // A possible duplicate found before filing: the person can file it anyway or cancel.
  const [dup, setDup] = useState<{ matches: (FileRow & { reason?: string })[]; proceed: () => void } | null>(null);
  // Invoices (a separate list from the monthly statements)
  const [tab, setTab] = useState<"statements" | "invoices">("statements");
  const [invMonth, setInvMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [invFiles, setInvFiles] = useState<FileRow[]>([]);
  const [invVendors, setInvVendors] = useState<{ id: string; name: string; category: string }[]>([]);
  const [invSearch, setInvSearch] = useState("");
  const [invAdding, setInvAdding] = useState(false);
  const [iVendor, setIVendor] = useState("");
  const [iOther, setIOther] = useState("");
  const [iDate, setIDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [iNumber, setINumber] = useState("");
  const [iAmount, setIAmount] = useState("");
  const [vName, setVName] = useState("");
  const [vCategory, setVCategory] = useState("Lab");
  const [vStart, setVStart] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(ROLE_KEY);
      if ((stored === "finance" || stored === "cpa") && hasSessionToken()) setRole(stored);
      else if (stored) sessionStorage.removeItem(ROLE_KEY);
    } catch {}
    setChecked(true);
  }, []);

  function logout() {
    setRole(null); clearSessionToken();
    try { sessionStorage.removeItem(ROLE_KEY); } catch {}
  }

  async function handleLogin() {
    setLoginError("");
    let res: Response;
    try { res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }); }
    catch { setLoginError("Couldn't reach the server."); return; }
    const r = await res.json().catch(() => ({}));
    const next: Role | null = r.cpa ? "cpa" : (r.isSuper || r.employee?.canManagePayroll) ? "finance" : null;
    if (!r.token || !next) { setLoginError(r.ok && !next ? "That login doesn't have access to statements." : "Not recognized."); setCode(""); return; }
    storeSessionToken(r.token);
    try { sessionStorage.setItem(ROLE_KEY, next); } catch {}
    setRole(next); setCode("");
  }

  const load = useCallback(async () => {
    if (!role) return;
    setLoading(true); setLoadError("");
    const r = await api("/api/statements/list", { year });
    setLoading(false);
    if (r.status === 401) { logout(); return; }
    if (!r.ok) { setLoadError(r.json.error ?? "Couldn't load statements."); return; }
    setAccounts(r.json.accounts ?? []); setFiles(r.json.files ?? []);
  }, [role, year]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSAmount(""); setDup(null); }, [sel]);

  // The last month whose statement should be out: last month this year, all of a past year, none of a future one.
  const now = new Date();
  const lastDue = year < thisYear ? 12 : year > thisYear ? 0 : now.getMonth(); // getMonth() is 0-based, so it equals last month's number
  const filesFor = (kind: string, id: string, month: string) => files.filter((f) => f.account_kind === kind && f.account_id === id && f.month === month);
  const status = (a: Account, m: number): "have" | "none" | "missing" | "future" => {
    const fs = filesFor(a.kind, a.id, mkey(year, m));
    if (fs.some((f) => !f.no_statement)) return "have";
    if (fs.some((f) => f.no_statement)) return "none";
    // A vendor is only expected from its first month on, and not at all once it is retired.
    if (a.kind === "vendor" && ((a.startMonth && mkey(year, m) < a.startMonth) || a.active === false)) return "future";
    return m <= lastDue ? "missing" : "future";
  };

  const finance = role === "finance";
  const visible = accounts.filter((a) => a.name.toLowerCase().includes(search.trim().toLowerCase()));
  const missingLast = lastDue >= 1 ? accounts.filter((a) => status(a, lastDue) === "missing") : [];
  const totalMissing = accounts.reduce((n, a) => { let c = 0; for (let m = 1; m <= lastDue; m++) if (status(a, m) === "missing") c++; return n + c; }, 0);

  async function download(f: FileRow) {
    setMsg("");
    const r = await api("/api/statements/download-url", { id: f.id });
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't create the download link."); return; }
    const a = document.createElement("a"); a.href = r.json.url; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
  }

  async function upload(a: Account, month: string, file: File, ignoreDup = false) {
    setMsg(""); setDup(null);
    if (!/\.pdf$/i.test(file.name)) { setMsg("Only PDF files can be uploaded."); return; }
    if (sAmount.trim() === "" || isNaN(Number(sAmount))) { setMsg("Enter the statement amount first, then choose the PDF."); return; }
    setBusy(true);
    if (!ignoreDup) {
      const chk = await api("/api/statements/manage", { action: "checkDuplicate", docType: "statement", accountKind: a.kind, accountId: a.id, accountName: a.name, month, amount: sAmount });
      if (chk.ok && (chk.json.matches ?? []).length > 0) { setBusy(false); setDup({ matches: chk.json.matches, proceed: () => upload(a, month, file, true) }); return; }
    }
    const slot = await api("/api/statements/upload-url", { accountKind: a.kind, accountName: a.name, month, fileName: file.name, size: file.size });
    if (!slot.ok) { setBusy(false); setMsg(slot.json.error ?? "Couldn't start the upload."); return; }
    const up = await supabase.storage.from("statements").uploadToSignedUrl(slot.json.path, slot.json.token, file, { contentType: "application/pdf" });
    if (up.error) { setBusy(false); setMsg(`Upload failed: ${up.error.message}`); return; }
    const rec = await api("/api/statements/manage", { action: "confirm", path: slot.json.path, accountKind: a.kind, accountId: a.id, accountName: a.name, month, fileName: file.name, size: file.size, amount: sAmount, dupIgnored: ignoreDup });
    setBusy(false);
    if (!rec.ok) { setMsg(rec.json.error ?? "Couldn't record the upload."); return; }
    setSAmount(""); setMsg(`Filed ${file.name}.`); load();
  }

  async function markNone(a: Account, month: string) {
    const note = window.prompt("Why is there no statement? (optional, e.g. account had no activity)") ?? "";
    setBusy(true);
    const r = await api("/api/statements/manage", { action: "markNone", accountKind: a.kind, accountId: a.id, accountName: a.name, month, note });
    setBusy(false);
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't save."); return; }
    load();
  }

  const loadInvoices = useCallback(async () => {
    if (!role) return;
    setLoading(true); setLoadError("");
    const r = await api("/api/statements/list", { docType: "invoice", month: invMonth });
    setLoading(false);
    if (r.status === 401) { logout(); return; }
    if (!r.ok) { setLoadError(r.json.error ?? "Couldn't load invoices."); return; }
    setInvFiles(r.json.files ?? []); setInvVendors(r.json.vendors ?? []);
  }, [role, invMonth]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === "invoices") loadInvoices(); }, [tab, loadInvoices]);

  async function addInvoice(file: File, ignoreDup = false) {
    setMsg(""); setDup(null);
    const vendor = invVendors.find((v) => v.id === iVendor);
    const name = vendor ? vendor.name : iOther.trim();
    if (!name) { setMsg("Choose a vendor or type a name."); return; }
    if (!iDate) { setMsg("Enter the invoice date."); return; }
    if (!iNumber.trim()) { setMsg("Enter the invoice number."); return; }
    if (iAmount.trim() === "" || isNaN(Number(iAmount))) { setMsg("Enter the invoice amount."); return; }
    if (!/\.pdf$/i.test(file.name)) { setMsg("Only PDF files can be uploaded."); return; }
    const kind = vendor ? "vendor" : "other";
    setBusy(true);
    if (!ignoreDup) {
      const chk = await api("/api/statements/manage", { action: "checkDuplicate", docType: "invoice", accountKind: kind, accountId: vendor?.id ?? "", accountName: name, invoiceDate: iDate, invoiceNumber: iNumber, amount: iAmount });
      if (chk.ok && (chk.json.matches ?? []).length > 0) { setBusy(false); setDup({ matches: chk.json.matches, proceed: () => addInvoice(file, true) }); return; }
    }
    const slot = await api("/api/statements/upload-url", { docType: "invoice", accountKind: kind, accountName: name, month: iDate.slice(0, 7), fileName: file.name, size: file.size });
    if (!slot.ok) { setBusy(false); setMsg(slot.json.error ?? "Couldn't start the upload."); return; }
    const up = await supabase.storage.from("statements").uploadToSignedUrl(slot.json.path, slot.json.token, file, { contentType: "application/pdf" });
    if (up.error) { setBusy(false); setMsg(`Upload failed: ${up.error.message}`); return; }
    const rec = await api("/api/statements/manage", { action: "confirm", docType: "invoice", path: slot.json.path, accountKind: kind, accountId: vendor?.id ?? "", accountName: name, invoiceDate: iDate, invoiceNumber: iNumber, amount: iAmount, fileName: file.name, size: file.size, dupIgnored: ignoreDup });
    setBusy(false);
    if (!rec.ok) { setMsg(rec.json.error ?? "Couldn't record the invoice."); return; }
    setMsg(`Filed invoice ${iNumber.trim()} from ${name}.`); setINumber(""); setIAmount("");
    if (iDate.slice(0, 7) !== invMonth) setInvMonth(iDate.slice(0, 7)); else loadInvoices();
  }

  async function removeInvoice(f: FileRow) {
    if (!window.confirm(`Delete this invoice (${f.account_name}${f.invoice_number ? ` #${f.invoice_number}` : ""})? This can't be undone.`)) return;
    setBusy(true);
    const r = await api("/api/statements/manage", { action: "remove", id: f.id });
    setBusy(false);
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't remove."); return; }
    loadInvoices();
  }

  async function addVendor() {
    if (!vName.trim()) { setMsg("Enter a name."); return; }
    setBusy(true);
    const r = await api("/api/statements/manage", { action: "addSource", name: vName, category: vCategory, startMonth: vStart });
    setBusy(false);
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't add it."); return; }
    setVName(""); setAdding(false); setMsg(`Added ${vName.trim()}.`); load();
  }
  async function renameVendor(a: Account) {
    const name = window.prompt("Rename:", a.name);
    if (!name || !name.trim() || name.trim() === a.name) return;
    const r = await api("/api/statements/manage", { action: "updateSource", id: a.id, name });
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't rename."); return; }
    load();
  }
  async function toggleVendor(a: Account) {
    const retiring = a.active !== false;
    if (retiring && !window.confirm(`Stop expecting statements from ${a.name}? Files already filed stay available.`)) return;
    const r = await api("/api/statements/manage", { action: "updateSource", id: a.id, active: !retiring });
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't update."); return; }
    load();
  }

  async function remove(f: FileRow) {
    if (!window.confirm(f.no_statement ? "Remove this mark?" : `Delete ${f.file_name ?? "this statement"}? This can't be undone.`)) return;
    setBusy(true);
    const r = await api("/api/statements/manage", { action: "remove", id: f.id });
    setBusy(false);
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't remove."); return; }
    load();
  }

  if (!checked) return null;

  // ---------------- Login ----------------
  if (!role) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4" style={{ background: "#f5f5f5" }}>
        <div className="rounded-2xl bg-white p-6 sm:p-10 shadow-lg w-full max-w-sm text-center">
          <h1 className="text-2xl font-bold mb-1" style={{ color: "#5a5a5a" }}>Statements</h1>
          <p className="text-gray-400 text-sm mb-6">Enter your PIN or passcode.</p>
          <input type="password" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="PIN or passcode" maxLength={64}
            className={`w-full rounded-xl border px-4 py-3 text-center text-lg font-bold focus:outline-none mb-3 ${loginError ? "border-red-300 bg-red-50" : "border-gray-200"}`} />
          {loginError && <p className="text-red-500 text-sm mb-3">{loginError}</p>}
          <button onClick={handleLogin} className="w-full rounded-xl py-3 font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>Continue</button>
        </div>
      </main>
    );
  }

  const money = (n: number | null | undefined) => (n == null ? "no amount" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const dupBanner = dup && (
    <div className="rounded-xl px-4 py-3 text-sm space-y-1" style={{ background: "#FAEEDA", color: "#854F0B", border: "1px solid #f2d3a0" }}>
      <p className="font-semibold">⚠️ Possible duplicate</p>
      {dup.matches.map((m) => (
        <p key={m.id}>
          {m.account_name}{m.doc_type === "invoice" ? ` · invoice ${m.invoice_number || "(no number)"} · ${m.invoice_date ?? ""}` : ` · ${m.month}`} · {money(m.amount)} · filed {new Date(m.uploaded_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} by {m.uploaded_by}
          <span className="opacity-80"> — {(m as any).reason}</span>
        </p>
      ))}
      <div className="flex items-center gap-3 pt-1">
        <button onClick={() => { const go = dup.proceed; setDup(null); go(); }} className="rounded-lg px-4 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: "#e8622a" }}>File it anyway</button>
        <button onClick={() => setDup(null)} className="text-xs font-semibold underline">Cancel</button>
      </div>
    </div>
  );

  const selAccount = sel ? accounts.find((a) => acctKey(a.kind, a.id) === sel.key) : null;
  const selFiles = selAccount && sel ? filesFor(selAccount.kind, selAccount.id, sel.month) : [];
  const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

  const content = (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Statements</h1>
          <p className="text-sm text-slate-500">{finance ? "Upload each month's statements and tick them off. The CPA can view and download anything filed here." : "View and download any statement. This page is read-only."}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-2" style={{ visibility: tab === "statements" ? "visible" : "hidden" }}>
            <button onClick={() => setYear((y) => y - 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm">←</button>
            <span className="font-bold text-slate-700 w-14 text-center">{year}</span>
            <button onClick={() => setYear((y) => y + 1)} disabled={year >= thisYear} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm disabled:opacity-40">→</button>
          </span>
          {!finance && <button onClick={logout} className="ml-2 text-sm text-slate-500 hover:underline">Log out</button>}
        </div>
      </div>

      <div className="flex gap-2">
        {(["statements", "invoices"] as const).map((t) => (
          <button key={t} onClick={() => { setTab(t); setMsg(""); }} className="px-4 py-2 text-sm font-semibold rounded-lg border-2 transition"
            style={tab === t ? { backgroundColor: "#e8622a", color: "white", borderColor: "#e8622a" } : { backgroundColor: "white", color: "#475569", borderColor: "#cbd5e1" }}>
            {t === "statements" ? "Monthly statements" : "Invoices"}
          </button>
        ))}
      </div>

      {tab === "invoices" ? (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-semibold text-slate-600">Month</label>
          <input type="month" value={invMonth} onChange={(e) => e.target.value && setInvMonth(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none" />
          <input value={invSearch} onChange={(e) => setInvSearch(e.target.value)} placeholder="Search vendor or invoice #…" className="w-full sm:w-72 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none" />
        </div>
        {loadError && <p className="text-sm text-red-600 font-semibold">⚠️ {loadError}</p>}

        {finance && (
          <div className="rounded-2xl bg-white shadow px-5 py-3">
            {!invAdding ? (
              <button onClick={() => setInvAdding(true)} className="text-sm font-semibold text-orange-500 hover:underline">+ Add an invoice</button>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Vendor</label>
                    <select value={iVendor} onChange={(e) => setIVendor(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none" style={{ minWidth: 200 }}>
                      <option value="">Other (type a name)…</option>
                      {invVendors.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.category})</option>)}
                    </select>
                  </div>
                  {!iVendor && (
                    <div style={{ flex: "1 1 180px" }}>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Vendor name</label>
                      <input value={iOther} onChange={(e) => setIOther(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Invoice date</label>
                    <input type="date" value={iDate} onChange={(e) => setIDate(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Invoice # (required)</label>
                    <input value={iNumber} onChange={(e) => setINumber(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" style={{ width: 130 }} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Amount (required)</label>
                    <input type="number" step="0.01" value={iAmount} onChange={(e) => setIAmount(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" style={{ width: 120 }} />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="rounded-lg px-4 py-2 text-sm font-semibold text-white cursor-pointer hover:opacity-90" style={{ backgroundColor: "#e8622a", opacity: busy ? 0.5 : 1 }}>
                    {busy ? "Working…" : "Choose PDF and file it"}
                    <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={busy}
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) addInvoice(f); }} />
                  </label>
                  <button onClick={() => setInvAdding(false)} className="text-sm text-slate-400 hover:underline">Close</button>
                </div>
              </div>
            )}
            {dupBanner && <div className="mt-3">{dupBanner}</div>}
            {msg && <p className="text-sm font-semibold text-slate-600 mt-2">{msg}</p>}
          </div>
        )}

        {(() => {
          const q = invSearch.trim().toLowerCase();
          const shown = invFiles.filter((f) => !q || f.account_name.toLowerCase().includes(q) || (f.invoice_number ?? "").toLowerCase().includes(q));
          const total = shown.reduce((n, f) => n + (f.amount ?? 0), 0);
          const withAmount = shown.filter((f) => f.amount != null).length;
          return (
            <div className="rounded-2xl bg-white shadow overflow-x-auto">
              <table className="w-full text-sm border-collapse" style={{ minWidth: 640 }}>
                <thead>
                  <tr className="text-xs text-slate-400 border-b border-slate-100 text-left">
                    <th className="px-4 py-2 font-medium">Date</th><th className="px-2 py-2 font-medium">Vendor</th><th className="px-2 py-2 font-medium">Invoice #</th>
                    <th className="px-2 py-2 font-medium">Amount</th><th className="px-2 py-2 font-medium">Filed by</th><th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-slate-400">{loading ? "Loading…" : "No invoices filed for this month."}</td></tr>}
                  {shown.map((f) => (
                    <tr key={f.id} className="border-b border-slate-50">
                      <td className="px-4 py-1.5 text-slate-600 whitespace-nowrap">{f.invoice_date ? new Date(f.invoice_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</td>
                      <td className="px-2 py-1.5 font-medium text-slate-700">{f.account_name}</td>
                      <td className="px-2 py-1.5 text-slate-600">{f.invoice_number || "—"}{f.dup_ignored && <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "#FAEEDA", color: "#854F0B" }} title="Filed even though the app warned it might be a duplicate">dup?</span>}</td>
                      <td className="px-2 py-1.5 text-slate-700 whitespace-nowrap">{f.amount != null ? `$${Number(f.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</td>
                      <td className="px-2 py-1.5 text-xs text-slate-400 whitespace-nowrap">{f.uploaded_by}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        <button onClick={() => download(f)} className="rounded-lg px-3 py-1 text-xs font-semibold text-white" style={{ backgroundColor: "#0f766e" }}>Download</button>
                        {finance && <button onClick={() => removeInvoice(f)} disabled={busy} className="ml-3 text-xs text-red-500 hover:underline">Remove</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {shown.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 font-semibold text-slate-700">
                      <td className="px-4 py-2" colSpan={3}>{shown.length} invoice{shown.length === 1 ? "" : "s"}</td>
                      <td className="px-2 py-2 whitespace-nowrap" colSpan={3}>{withAmount > 0 ? `$${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""}{withAmount > 0 && withAmount < shown.length ? ` (${withAmount} with amounts)` : ""}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          );
        })()}
      </div>
      ) : (
      <>
      {finance && year === thisYear && lastDue >= 1 && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: missingLast.length ? "#FAEEDA" : "#e7f6ec", color: missingLast.length ? "#854F0B" : "#166534" }}>
          {missingLast.length === 0 ? <>All {MONTHS[lastDue - 1]} statements are filed.</> : (
            <>
              <strong>{MONTHS[lastDue - 1]} statements still missing ({missingLast.length}):</strong>{" "}
              {missingLast.map((a, i) => (
                <span key={acctKey(a.kind, a.id)}>{i > 0 && ", "}<button className="underline font-semibold" onClick={() => setSel({ key: acctKey(a.kind, a.id), month: mkey(year, lastDue) })}>{a.name}</button></span>
              ))}
            </>
          )}
          {totalMissing > missingLast.length && <span className="block text-xs mt-1 opacity-80">{totalMissing} missing across {year} in total.</span>}
        </div>
      )}

      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search accounts…" className="w-full sm:w-72 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none" />
      {loadError && <p className="text-sm text-red-600 font-semibold">⚠️ {loadError}</p>}

      <div className="rounded-2xl bg-white shadow overflow-x-auto">
        <table className="w-full text-sm border-collapse" style={{ minWidth: 760 }}>
          <thead>
            <tr className="text-xs text-slate-400 border-b border-slate-100">
              <th className="text-left font-medium px-4 py-2 sticky left-0 bg-white">Account</th>
              {MONTHS.map((m) => <th key={m} className="font-medium px-1 py-2 text-center">{m}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && accounts.length === 0 && <tr><td colSpan={13} className="px-4 py-6 text-slate-400">Loading…</td></tr>}
            {[
              ...(["bank", "card", "loan"] as const).map((kind) => ({ key: kind, label: KIND_LABEL[kind], list: visible.filter((a) => a.kind === kind) })),
              ...(["Lab", "Supplier", "Insurance", "Other"] as const).map((cat) => ({ key: `v-${cat}`, label: VENDOR_LABEL[cat], list: visible.filter((a) => a.kind === "vendor" && (a.category ?? "Other") === cat) })),
            ].map((group) => {
              const list = group.list;
              if (list.length === 0) return null;
              return (
                <FragmentRows key={group.key} label={group.label}>
                  {list.map((a) => (
                    <tr key={acctKey(a.kind, a.id)} className="border-b border-slate-50">
                      <td className="px-4 py-1.5 font-medium text-slate-700 whitespace-nowrap sticky left-0 bg-white" style={{ opacity: a.active === false ? 0.5 : 1 }}>
                        {a.name}
                        {finance && a.kind === "vendor" && (
                          <span className="ml-2 text-xs font-normal">
                            <button onClick={() => renameVendor(a)} className="text-slate-400 hover:text-slate-600" title="Rename">✎</button>
                            <button onClick={() => toggleVendor(a)} className="ml-1.5 text-slate-400 hover:text-slate-600" title={a.active === false ? "Start expecting statements again" : "Stop expecting statements"}>{a.active === false ? "↺" : "✕"}</button>
                          </span>
                        )}
                      </td>
                      {MONTHS.map((_, i) => {
                        const m = i + 1; const st = status(a, m); const k = acctKey(a.kind, a.id);
                        const isSel = sel?.key === k && sel.month === mkey(year, m);
                        const style = st === "have" ? { color: "#166534", background: "#e7f6ec" } : st === "missing" ? { color: "#92400e", background: "#fef3c7" } : st === "none" ? { color: "#475569", background: "#f1f5f9" } : { color: "#cbd5e1", background: "transparent" };
                        return (
                          <td key={m} className="px-0.5 py-1 text-center">
                            <button onClick={() => setSel({ key: k, month: mkey(year, m) })} disabled={st === "future" && !finance}
                              className="rounded-md text-[11px] font-semibold w-full py-1" style={{ ...style, outline: isSel ? "2px solid #e8622a" : "none" }}>
                              {st === "have" ? "✓" : st === "missing" ? "Missing" : st === "none" ? "None" : "·"}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </FragmentRows>
              );
            })}
            {!loading && accounts.length === 0 && !loadError && <tr><td colSpan={13} className="px-4 py-6 text-slate-400">No accounts found.</td></tr>}
          </tbody>
        </table>
      </div>

      {finance && (
        <div className="rounded-2xl bg-white shadow px-5 py-3">
          {!adding ? (
            <button onClick={() => setAdding(true)} className="text-sm font-semibold text-orange-500 hover:underline">+ Add a lab or other vendor</button>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div style={{ flex: "1 1 200px" }}>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Name</label>
                <input value={vName} onChange={(e) => setVName(e.target.value)} placeholder="e.g. Glidewell Dental Lab" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Type</label>
                <select value={vCategory} onChange={(e) => setVCategory(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none">
                  <option>Lab</option><option>Supplier</option><option>Insurance</option><option>Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">First statement month</label>
                <input type="month" value={vStart} onChange={(e) => setVStart(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
              </div>
              <button onClick={addVendor} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: "#e8622a" }}>Add</button>
              <button onClick={() => setAdding(false)} className="text-sm text-slate-400 hover:underline pb-2">Cancel</button>
            </div>
          )}
          {msg && !sel && <p className="text-sm font-semibold text-slate-600 mt-2">{msg}</p>}
        </div>
      )}

      {selAccount && sel && (
        <div className="rounded-2xl bg-white shadow px-5 py-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold text-slate-800">{selAccount.name} — {monthLabel(sel.month)}</h2>
            <button onClick={() => setSel(null)} className="text-slate-400 hover:text-slate-600">✕</button>
          </div>
          {selFiles.length === 0 && <p className="text-sm text-slate-500">Nothing filed for this month.</p>}
          {selFiles.map((f) => (
            <div key={f.id} className="flex items-center gap-3 text-sm border-t border-slate-100 pt-2">
              <span className="flex-1 min-w-0 truncate text-slate-700">
                {f.no_statement ? `No statement this month${f.note ? ` — ${f.note}` : ""}` : f.file_name}{!f.no_statement && f.amount != null && <span className="font-semibold text-slate-700"> · {money(f.amount)}</span>}{f.dup_ignored && <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "#FAEEDA", color: "#854F0B" }}>filed despite duplicate warning</span>}
                <span className="text-xs text-slate-400"> · {f.uploaded_by} · {new Date(f.uploaded_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{f.size_bytes ? ` · ${(f.size_bytes / 1024 / 1024).toFixed(1)} MB` : ""}</span>
              </span>
              {!f.no_statement && <button onClick={() => download(f)} className="rounded-lg px-3 py-1 text-xs font-semibold text-white" style={{ backgroundColor: "#0f766e" }}>Download</button>}
              {finance && <button onClick={() => remove(f)} disabled={busy} className="text-xs text-red-500 hover:underline">Remove</button>}
            </div>
          ))}
          {finance && (
            <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Statement amount (required)</label>
                <input type="number" step="0.01" value={sAmount} onChange={(e) => setSAmount(e.target.value)} placeholder="Ending balance or total" className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" style={{ width: 190 }} />
              </div>
              <label className="rounded-lg px-4 py-2 text-sm font-semibold text-white cursor-pointer hover:opacity-90" style={{ backgroundColor: "#e8622a", opacity: busy ? 0.5 : 1 }}>
                {busy ? "Working…" : "Upload PDF"}
                <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={busy}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(selAccount, sel.month, f); }} />
              </label>
              {selFiles.length === 0 && <button onClick={() => markNone(selAccount, sel.month)} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">No statement this month</button>}
            </div>
          )}
          {dupBanner}
          {msg && <p className="text-sm font-semibold text-slate-600">{msg}</p>}
        </div>
      )}
      </>
      )}
    </div>
  );

  if (role === "cpa") {
    return <main className="min-h-screen p-4 lg:p-8" style={{ background: "#f5f5f5" }}>{content}</main>;
  }
  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-24 lg:pt-0 lg:ml-64 p-4 lg:p-8">{content}</div>
    </main>
  );
}

// A section heading row followed by its rows.
function FragmentRows({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <tr><td colSpan={13} className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</td></tr>
      {children}
    </>
  );
}
