"use client";

import { Fragment, useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { getSessionToken } from "@/lib/secureData";
import { loadRecurringBills, loadBillPayments, buildOccurrences, addDays, RecurringBill, BillPayment } from "@/lib/cashflow";

/**
 * Statements: ONE list for the month. Bills, invoices and statements are all "statements".
 * Grouped by category, alphabetical within each, with totals per category and for the month.
 * Vendors you've filed before show up every month as "Waiting" until their statement is filed (or skipped).
 * Unpaid statements from earlier months carry forward; a paid one sits in the month it was paid.
 * Bank, card and loan account statements (which carry balances that feed Cash Flow) sit in their own section.
 * Finance users file and mark things; the CPA can only view and download.
 */

// ---------------- Types ----------------
interface FileRow {
  id: string; account_kind: string; account_id: string; account_name: string; month: string; file_name: string | null; size_bytes: number | null;
  no_statement: boolean; note: string; uploaded_by: string; uploaded_at: string; doc_type?: string; invoice_date?: string | null; invoice_number?: string;
  amount?: number | null; dup_ignored?: boolean; paid?: boolean; paid_date?: string | null; matched_bill_id?: string | null; matched_due_date?: string | null;
  category?: string; paid_from_name?: string; paid_note?: string; paid_method?: string | null; paid_check_number?: string; paid_from_kind?: string | null;
  paid_from_id?: string | null; due_date?: string | null; paid_amount?: number | null; overpaid_credit?: number | null; autopay?: boolean; paid_auto?: boolean; credit_applied?: number;
}
interface Source { id: string; name: string; category: string; active: boolean; startMonth: string; expects: boolean }
interface Pref { key: string; category: string; autopay: boolean; autopayFromKind: string; autopayFromId: string; autopayFromName: string; expect: string }
interface Acct { kind: "bank" | "card" | "loan"; id: string; name: string }
interface PayAcct { kind: "bank" | "card"; id: string; name: string }
interface MonthData {
  today: string; month: string; currentMonth: string; prevMonth: string; prevMissing: string[]; files: FileRow[]; datedIds: string[]; skippedIds: string[];
  sources: Source[]; prefs: Pref[]; history: Record<string, { firstMonth: string; lastMonth: string; lastCategory: string }>; credits: Record<string, number>;
  accounts: Acct[]; payAccounts: PayAcct[]; cfBalances: Record<string, number>; lastCheck: Record<string, number>;
}
type Row =
  | { kind: "bill"; cat: string; vendor: string; vendorId: string; f: FileRow }
  | { kind: "doc"; cat: string; vendor: string; vendorId: string; f: FileRow }
  | { kind: "waiting"; cat: string; vendor: string; vendorId: string }
  | { kind: "skipped"; cat: string; vendor: string; vendorId: string; f: FileRow };
type Filter = "all" | "unpaid" | "autopay" | "waiting" | "paid" | "skipped";

// ---------------- Helpers ----------------
const INK = "#232634", LINE = "#E9E1CF", BAND = "#F6F0E1", ORANGE = "#EF843F", DEEP = "#B84E0B";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DEFAULT_CATS = ["Loan", "Rent", "Labs", "Supplies", "Maintenance", "Payroll", "Utilities", "Insurance", "Marketing", "Professional fees", "Other"];
const CAT_DOT: Record<string, string> = { Loan: "#5B6C9D", Rent: "#8A6BB1", Labs: "#2F8F83", Supplies: "#C98216", Maintenance: "#6F8A2E", Payroll: "#B25D7A", Utilities: "#3F7CAC", Insurance: "#7A6A3A", Other: "#7a7a7a" };
const SOURCE_TO_CAT: Record<string, string> = { Lab: "Labs", Supplier: "Supplies", Insurance: "Insurance" };
const CAT_TO_SOURCE: Record<string, string> = { Labs: "Lab", Supplies: "Supplier", Insurance: "Insurance" };

function normCat(s?: string | null): string {
  const t = (s ?? "").trim(); if (!t) return "";
  const k = t.toLowerCase();
  if (["lab", "labs"].includes(k)) return "Labs";
  if (["supplier", "suppliers", "supplies", "supply"].includes(k)) return "Supplies";
  if (["rent", "cam", "rent & cam", "rent and cam"].includes(k)) return "Rent";
  if (["loan", "loans", "note", "notes", "loans & notes", "loans/notes", "loan/notes"].includes(k)) return "Loan";
  if (["equipment & repairs", "equipment and repairs", "maintenance", "repairs"].includes(k)) return "Maintenance";
  if (["utilities", "utility"].includes(k)) return "Utilities";
  if (k === "insurance") return "Insurance";
  if (k === "payroll") return "Payroll";
  return t;
}
const money = (n: number | null | undefined) => (n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dlabel = (iso?: string | null) => (iso ? `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}` : "—");
const mlabel = (m: string) => `${FULL[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const shiftMonth = (m: string, d: number) => { const dt = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)) - 1 + d, 1)); return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`; };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
const num = (s: string) => Number(String(s).replace(/[$,\s]/g, ""));
const isNum = (s: string) => s.trim() !== "" && !isNaN(num(s));

async function api(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; json: any }> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "x-session-token": getSessionToken() }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  } catch (e: any) {
    return { ok: false, status: 0, json: { error: e?.message ?? "Network error." } };
  }
}

function Pill({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  return <span className="inline-block rounded-full whitespace-nowrap" style={{ padding: "3px 9px", fontSize: 12, fontWeight: 700, lineHeight: "16px", background: bg, color: fg }}>{text}</span>;
}
const Icon = ({ d, size = 18, sw = 1.8 }: { d: string; size?: number; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}><path d={d} /></svg>
);
const P = { cal: "M3.5 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM8 3v4M16 3v4M3.5 10h17", down: "M6 9l6 6 6-6", print: "M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2M7 14h10v6H7z", exp: "M12 15V4M8 8l4-4 4 4M5 13v6h14v-6", sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM9 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4z", left: "M15 6l-6 6 6 6", right: "M9 6l6 6-6 6", doc: "M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1zM14 3.5V8h4", more: "M5 12h.01M12 12h.01M19 12h.01", plus: "M12 5v14M5 12h14", check: "M5 12.5l4.5 4.5L19 7.5", search: "M16 16l4.5 4.5M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z", upload: "M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19h14", clock: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2", refresh: "M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5", x: "M6 6l12 12M18 6L6 18" };

const btnBase = "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold whitespace-nowrap disabled:opacity-50";
const inputCls = "w-full rounded-lg border px-3 py-2 text-sm focus:outline-none bg-white";
const inputBorder = { borderColor: "#CFC6AF", minHeight: 44 };
const lbl = "block text-xs font-bold text-slate-600 mb-1";

// ---------------- Component ----------------
export default function StatementsMonth({ finance, onAuthLost, onChanged }: { finance: boolean; onAuthLost?: () => void; onChanged?: () => void }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const [data, setData] = useState<MonthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [showAccounts, setShowAccounts] = useState(true);
  const [catFilter, setCatFilter] = useState("");
  const [dueFilter, setDueFilter] = useState<"all" | "overdue" | "week">("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Add statement
  const [addOpen, setAddOpen] = useState(false);
  const [aFile, setAFile] = useState<File | null>(null);
  const [aVendor, setAVendor] = useState("");
  const [aCat, setACat] = useState("");
  const [aInv, setAInv] = useState("");
  const [aDate, setADate] = useState("");
  const [aDue, setADue] = useState("");
  const [aAmount, setAAmount] = useState("");
  const [aPaidNow, setAPaidNow] = useState(false);
  const [aAuto, setAAuto] = useState(false);
  const [aAutoFrom, setAAutoFrom] = useState("");
  const [aMatch, setAMatch] = useState<{ billId: string; dueDate: string; billName: string } | null>(null);
  const [aErr, setAErr] = useState("");
  const [bills, setBills] = useState<RecurringBill[]>([]);
  const [billPayments, setBillPayments] = useState<BillPayment[]>([]);

  // Mark paid
  const [payFor, setPayFor] = useState<FileRow | null>(null);
  const [pEditing, setPEditing] = useState(false);
  const [pDate, setPDate] = useState("");
  const [pMethod, setPMethod] = useState<"check" | "ach" | "card" | "other">("check");
  const [pFrom, setPFrom] = useState("");
  const [pCheck, setPCheck] = useState("");
  const [pAmount, setPAmount] = useState("");
  const [pDiff, setPDiff] = useState("");
  const [pNote, setPNote] = useState("");
  const [pUseCredit, setPUseCredit] = useState(true);
  const [pErr, setPErr] = useState("");

  // Edit invoice
  const [editInv, setEditInv] = useState<FileRow | null>(null);
  const [eVendor, setEVendor] = useState("");
  const [eDate, setEDate] = useState("");
  const [eDue, setEDue] = useState("");
  const [eNumber, setENumber] = useState("");
  const [eAmount, setEAmount] = useState("");
  const [eCat, setECat] = useState("");
  const [eErr, setEErr] = useState("");

  // Merge two vendors that are really one
  const [mergeDlg, setMergeDlg] = useState<{ fromId: string; intoId: string } | null>(null);
  const [mErr, setMErr] = useState("");

  // Account statement (bank / card / loan)
  const [acctDlg, setAcctDlg] = useState<Acct | null>(null);
  const [sAmount, setSAmount] = useState("");
  const [sFile, setSFile] = useState<File | null>(null);
  const [sErr, setSErr] = useState("");

  // ---------------- Loading ----------------
  const load = useCallback(async () => {
    setLoading(true); setLoadError("");
    const r = await api("/api/statements/month", { month });
    setLoading(false);
    if (r.status === 401) { onAuthLost?.(); return; }
    if (!r.ok) { setLoadError(r.json.error ?? "Couldn't load statements."); return; }
    setData(r.json as MonthData);
  }, [month]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  const changed = () => { load(); onChanged?.(); };

  useEffect(() => {
    if (menuFor === null) return;
    const close = () => setMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuFor]);

  // Drop a PDF anywhere on the page to start filing it.
  useEffect(() => {
    if (!finance) return;
    const over = (e: Event) => e.preventDefault();
    const drop = (e: any) => {
      e.preventDefault();
      const f: File | undefined = e.dataTransfer?.files?.[0];
      if (!f) return;
      if (!/\.pdf$/i.test(f.name)) { setMsg("Only PDF files can be dropped here."); return; }
      if (!addOpen) openAdd({ file: f }); else setAFile(f);
    };
    window.addEventListener("dragover", over); window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Scheduled bills, so a new statement can be matched to one already expected (finance only).
  useEffect(() => {
    if (!finance || !addOpen) return;
    const t = new Date().toISOString().slice(0, 10);
    loadRecurringBills().then(setBills).catch(() => {});
    loadBillPayments(addDays(t, -75), addDays(t, 150)).then(setBillPayments).catch(() => {});
  }, [finance, addOpen]);

  // ---------------- The month's rows ----------------
  const view = useMemo(() => {
    if (!data) return null;
    const prefMap: Record<string, Pref> = {}; for (const p of data.prefs) prefMap[p.key] = p;
    const srcMap: Record<string, Source> = {}; for (const s of data.sources) srcMap[s.id] = s;
    const catFor = (id: string, fileCat?: string | null) =>
      normCat(prefMap[`vendor:${id}`]?.category) || normCat(fileCat) || normCat(data.history[id]?.lastCategory) || (srcMap[id] ? SOURCE_TO_CAT[srcMap[id].category] ?? "" : "") || "Other";
    const isVendorKind = (k: string) => k === "vendor" || k === "other";

    const nameOf = (f: FileRow) => (isVendorKind(f.account_kind) ? srcMap[f.account_id]?.name : undefined) ?? f.account_name;
    const rows: Row[] = [];
    for (const f of data.files) {
      if (f.no_statement) {
        if (isVendorKind(f.account_kind)) rows.push({ kind: "skipped", cat: catFor(f.account_id, f.category), vendor: nameOf(f), vendorId: f.account_id, f });
      } else if (f.doc_type === "invoice") {
        rows.push({ kind: "bill", cat: catFor(f.account_id, f.category), vendor: nameOf(f), vendorId: f.account_id, f });
      } else if (isVendorKind(f.account_kind)) {
        rows.push({ kind: "doc", cat: catFor(f.account_id, f.category), vendor: nameOf(f), vendorId: f.account_id, f });
      }
    }
    // Vendors you've filed before (or are set to expect) wait here until this month's statement arrives or is skipped.
    const dated = new Set(data.datedIds), skipped = new Set(data.skippedIds);
    if (data.month <= data.currentMonth) {
      for (const s of data.sources) {
        const key = `vendor:${s.id}`;
        if (!s.active || prefMap[key]?.expect === "never") continue;
        const first = data.history[s.id]?.firstMonth;
        const last = data.history[s.id]?.lastMonth;
        const eligible = (s.expects && (!s.startMonth || data.month >= s.startMonth)) || (!!first && first < data.month && !!last && last >= shiftMonth(data.month, -12));
        if (!eligible || dated.has(key) || skipped.has(key)) continue;
        rows.push({ kind: "waiting", cat: catFor(s.id), vendor: s.name, vendorId: s.id });
      }
    }
    const sortKey = (r: Row) => `${r.vendor.toLowerCase()}|${r.kind === "waiting" ? "0" : "1"}|${"f" in r ? r.f.invoice_date ?? r.f.month : ""}|${"f" in r ? r.f.invoice_number ?? "" : ""}`;
    rows.sort((a, z) => sortKey(a).localeCompare(sortKey(z)));

    const matches = (r: Row, fl: Filter) => {
      if (fl === "all") return true;
      if (fl === "unpaid") return r.kind === "bill" && !r.f.paid;
      if (fl === "autopay") return r.kind === "bill" && !!r.f.autopay;
      if (fl === "waiting") return r.kind === "waiting";
      if (fl === "paid") return r.kind === "bill" && !!r.f.paid;
      return r.kind === "skipped";
    };
    const q = search.trim().toLowerCase();
    const dueOk = (r: Row) => dueFilter === "all" || (r.kind === "bill" && !r.f.paid && !!r.f.due_date && (dueFilter === "overdue" ? !r.f.autopay && r.f.due_date < data.today : r.f.due_date >= data.today && daysBetween(r.f.due_date, data.today) <= 7));
    const shown = rows.filter((r) => matches(r, filter) && (!catFilter || r.cat === catFilter) && dueOk(r) && (!q || r.vendor.toLowerCase().includes(q) || ("f" in r && (r.f.invoice_number ?? "").toLowerCase().includes(q))));
    const counts: Record<Filter, number> = { all: rows.length, unpaid: 0, autopay: 0, waiting: 0, paid: 0, skipped: 0 };
    for (const r of rows) for (const fl of ["unpaid", "autopay", "waiting", "paid", "skipped"] as Filter[]) if (matches(r, fl)) counts[fl]++;

    const cats = [...new Set(shown.map((r) => r.cat))];
    cats.sort((a, z) => {
      const ia = a === "Other" ? 998 : DEFAULT_CATS.indexOf(a), iz = z === "Other" ? 998 : DEFAULT_CATS.indexOf(z);
      const ra = ia === -1 ? 500 : ia, rz = iz === -1 ? 500 : iz;
      return ra - rz || a.localeCompare(z);
    });
    const waiting = rows.filter((r) => r.kind === "waiting");
    // Two vendors whose names are nearly the same (one just the other plus a short word) may be one vendor entered twice.
    const norm = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
    const seenV = new Map<string, string>();
    for (const r of rows) if (srcMap[r.vendorId]) seenV.set(r.vendorId, r.vendor);
    const vlist = [...seenV.entries()].map(([id, name]) => ({ id, name, n: norm(name) }));
    const dupPairs: { from: { id: string; name: string }; into: { id: string; name: string } }[] = [];
    for (let i = 0; i < vlist.length; i++) for (let j = i + 1; j < vlist.length; j++) {
      const [sh, lo] = vlist[i].n.length <= vlist[j].n.length ? [vlist[i], vlist[j]] : [vlist[j], vlist[i]];
      if (sh.n.length >= 4 && sh.n !== lo.n && lo.n.startsWith(sh.n) && lo.n.length - sh.n.length <= 10) dupPairs.push({ from: { id: sh.id, name: sh.name }, into: { id: lo.id, name: lo.name } });
    }
    return { rows, shown, counts, cats, waiting, prefMap, srcMap, catFor, dupPairs };
  }, [data, filter, search, catFilter, dueFilter]);

  const paidSum = (f: FileRow) => (f.paid ? Number(f.paid_amount ?? f.amount ?? 0) : Number(f.paid_amount ?? 0));
  const owedOf = (f: FileRow) => (f.paid ? 0 : Math.max(0, Number(f.amount ?? 0) - Number(f.paid_amount ?? 0) - Number(f.credit_applied ?? 0)));
  const totals = (rs: Row[]) => {
    let t = 0, p = 0, o = 0;
    for (const r of rs) if (r.kind === "bill") { t += Number(r.f.amount ?? 0); p += paidSum(r.f); o += owedOf(r.f); }
    return { t, p, o };
  };

  const allCats = useMemo(() => {
    const used = new Set<string>(); view?.rows.forEach((r) => used.add(r.cat));
    data?.prefs.forEach((p) => p.category && used.add(normCat(p.category)));
    return [...new Set([...DEFAULT_CATS.filter((c) => c !== "Other"), ...[...used].filter((c) => !DEFAULT_CATS.includes(c)).sort(), "Other"])];
  }, [view, data]);

  // ---------------- Actions ----------------
  async function download(f: FileRow) {
    setMsg("");
    const r = await api("/api/statements/download-url", { id: f.id });
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't create the download link."); return; }
    const a = document.createElement("a"); a.href = r.json.url; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
  }
  async function manage(body: Record<string, unknown>, fail = "Couldn't save."): Promise<boolean> {
    setBusy(true); setMsg("");
    const r = await api("/api/statements/manage", body);
    setBusy(false);
    if (!r.ok) { setMsg(r.json.error ?? fail); return false; }
    return true;
  }
  async function skipVendor(vendorId: string, vendor: string) {
    if (await manage({ action: "markNone", accountKind: "vendor", accountId: vendorId, accountName: vendor, month, note: "Skipped this month" })) changed();
  }
  async function undoSkip(f: FileRow) { if (await manage({ action: "remove", id: f.id })) changed(); }
  async function setExpect(vendorId: string, expect: "monthly" | "never") {
    if (await manage({ action: "setPrefs", key: `vendor:${vendorId}`, expect })) changed();
  }
  async function removeFile(f: FileRow) {
    if (!window.confirm(`Delete ${f.invoice_number ? `invoice ${f.invoice_number}` : f.file_name ?? "this statement"} from ${f.account_name}? This can't be undone.`)) return;
    if (await manage({ action: "remove", id: f.id })) changed();
  }
  async function undoPaid(f: FileRow) { if (await manage({ action: "markInvoicePaid", id: f.id, paid: false })) changed(); }
  async function autopayFailed(f: FileRow) {
    if (!window.confirm(`Mark ${f.account_name} unpaid? Use this when the autopay didn't go through. It won't be set to autopay again for this statement.`)) return;
    if (await manage({ action: "autopayFailed", id: f.id })) changed();
  }
  async function unlinkBill(f: FileRow) { if (await manage({ action: "matchInvoice", id: f.id, billId: null })) changed(); }

  // ---------------- Vendors: rename, merge ----------------
  async function renameVendor(id: string, current: string) {
    const name = (window.prompt("Rename this vendor:", current) ?? "").trim().slice(0, 80);
    if (!name || name === current) return;
    if (await manage({ action: "updateSource", id, name })) changed();
  }
  async function changeCategory(vendorId: string, value: string) {
    let cat = value;
    if (value === "__new") { cat = (window.prompt("New category name:") ?? "").trim().slice(0, 40); if (!cat) return; }
    if (await manage({ action: "setPrefs", key: `vendor:${vendorId}`, category: cat })) changed();
  }
  function openMerge(fromId: string, intoId = "") { setMErr(""); setMergeDlg({ fromId, intoId }); }
  async function doMerge() {
    if (!mergeDlg || !data) return;
    if (!mergeDlg.intoId) { setMErr("Choose the vendor to keep."); return; }
    const from = data.sources.find((x) => x.id === mergeDlg.fromId), into = data.sources.find((x) => x.id === mergeDlg.intoId);
    if (!from || !into) return;
    setBusy(true); setMErr("");
    const r = await api("/api/statements/manage", { action: "mergeSource", fromId: from.id, intoId: into.id });
    setBusy(false);
    if (!r.ok) { setMErr(r.json.error ?? "Couldn't merge."); return; }
    setMergeDlg(null); setMsg(`Merged ${from.name} into ${into.name}${r.json.moved ? ` (${r.json.moved} statement${r.json.moved === 1 ? "" : "s"} moved)` : ""}.`); changed();
  }

  // ---------------- Add a statement ----------------
  const vendorByName = (name: string) => data?.sources.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
  const defaultDate = () => (data && month !== data.currentMonth ? `${month}-01` : data?.today ?? new Date().toISOString().slice(0, 10));
  function applyVendor(name: string) {
    setAVendor(name);
    const s = vendorByName(name);
    if (!s || !view || !data) return;
    const p = view.prefMap[`vendor:${s.id}`];
    setACat(view.catFor(s.id));
    setAAuto(!!p?.autopay);
    setAAutoFrom(p?.autopay && p.autopayFromId ? `${p.autopayFromKind}:${p.autopayFromId}` : "");
  }
  function openAdd(opts?: { vendor?: string; file?: File }) {
    setAFile(opts?.file ?? null); setAVendor(""); setACat(""); setAInv(""); setADate(defaultDate()); setADue(""); setAAmount("");
    setAPaidNow(false); setAAuto(false); setAAutoFrom(""); setAMatch(null); setAErr(""); setAddOpen(true);
    if (opts?.vendor) setTimeout(() => applyVendor(opts.vendor!), 0);
  }
  async function fileStatement(addAnother: boolean, ignoreDup = false) {
    if (!data) return;
    setAErr("");
    const name = aVendor.trim();
    if (!aFile) { setAErr("Attach the statement PDF first."); return; }
    if (!/\.pdf$/i.test(aFile.name)) { setAErr("Only PDF files can be uploaded."); return; }
    if (!name) { setAErr("Choose a vendor, or type a new one."); return; }
    if (!aDate) { setAErr("Enter the statement date."); return; }
    if (!aInv.trim()) { setAErr("Enter the invoice number."); return; }
    if (!isNum(aAmount)) { setAErr("Enter the amount due."); return; }
    const autoAcct = aAutoFrom ? data.payAccounts.find((a) => `${a.kind}:${a.id}` === aAutoFrom) : undefined;
    if (aAuto && !aDue) { setAErr("Enter the due date. Autopay is paid on it."); return; }
    if (aAuto && !autoAcct) { setAErr("Choose the account autopay is paid from."); return; }
    setBusy(true);
    // A name that isn't on the list yet joins it now, and shows up every month after this.
    let vendor = vendorByName(name);
    if (!vendor) {
      const mapped = CAT_TO_SOURCE[normCat(aCat)] ?? "Other";
      const made = await api("/api/statements/manage", { action: "addSource", name, category: mapped, startMonth: data.currentMonth, expectsStatement: true });
      if (!made.ok || !made.json.data?.id) { setBusy(false); setAErr(made.json.error ?? "Couldn't add the vendor."); return; }
      vendor = { id: String(made.json.data.id), name, category: mapped, active: true, startMonth: data.currentMonth, expects: true };
    } else if (!ignoreDup) {
      const chk = await api("/api/statements/manage", { action: "checkDuplicate", docType: "invoice", accountKind: "vendor", accountId: vendor.id, accountName: vendor.name, invoiceDate: aDate, invoiceNumber: aInv, amount: num(aAmount) });
      const m = (chk.ok ? chk.json.matches ?? [] : []) as any[];
      if (m.length > 0) {
        setBusy(false);
        const x = m[0];
        if (window.confirm(`This may be a duplicate: ${x.account_name}${x.invoice_number ? ` invoice ${x.invoice_number}` : ""}, ${money(x.amount)}, already filed (${x.reason}). File it anyway?`)) return fileStatement(addAnother, true);
        return;
      }
    }
    const slot = await api("/api/statements/upload-url", { docType: "invoice", accountKind: "vendor", accountName: vendor.name, month: aDate.slice(0, 7), fileName: aFile.name, size: aFile.size });
    if (!slot.ok) { setBusy(false); setAErr(slot.json.error ?? "Couldn't start the upload."); return; }
    const up = await supabase.storage.from("statements").uploadToSignedUrl(slot.json.path, slot.json.token, aFile, { contentType: "application/pdf" });
    if (up.error) { setBusy(false); setAErr(`Upload failed: ${up.error.message}`); return; }
    const rec = await api("/api/statements/manage", {
      action: "confirm", docType: "invoice", path: slot.json.path, accountKind: "vendor", accountId: vendor.id, accountName: vendor.name,
      invoiceDate: aDate, invoiceNumber: aInv, amount: num(aAmount), fileName: aFile.name, size: aFile.size, dupIgnored: ignoreDup,
      matchedBillId: aMatch?.billId, matchedDueDate: aMatch?.dueDate, category: aCat, dueDate: aDue || undefined,
      autopay: aAuto, paidFromKind: autoAcct?.kind, paidFromId: autoAcct?.id, paidFromName: autoAcct?.name,
    });
    setBusy(false);
    if (!rec.ok) { setAErr(rec.json.error ?? "Couldn't record the statement."); return; }
    setMsg(`Filed invoice ${aInv.trim()} from ${vendor.name}.`);
    const filed: FileRow = rec.json.data;
    const wantPay = aPaidNow;
    const newMonth = aDate.slice(0, 7);
    if (addAnother) { setAFile(null); setAInv(""); setAAmount(""); setADue(""); setAMatch(null); setAPaidNow(false); }
    else setAddOpen(false);
    if (newMonth !== month) setMonth(newMonth); else changed();
    if (wantPay && filed) openPay(filed, false);
  }

  // Match a new statement to a scheduled bill already being tracked.
  const suggestions = useMemo(() => {
    if (!addOpen || !aVendor.trim() || !aDate || bills.length === 0) return [];
    const STOP = new Set(["the", "inc", "llc", "corp", "company", "payment", "bill", "and", "for", "dental"]);
    const toks = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 3 && !STOP.has(x));
    const vt = toks(aVendor); if (vt.length === 0) return [];
    const amt = Number(aAmount); const target = new Date(aDate + "T00:00:00").getTime();
    const out: { bill: RecurringBill; dueDate: string; overlap: number; diff: number | null }[] = [];
    for (const b of bills) {
      if (!b.active || b.direction !== "outflow" || b.linkedCreditCardId || b.linkedDebtId) continue;
      const bt = toks(b.name); const overlap = vt.filter((t) => bt.includes(t)).length; if (!overlap) continue;
      const occ = buildOccurrences([b], billPayments, addDays(aDate, -25), addDays(aDate, 45)).filter((o) => !o.isPaid)
        .sort((x, y) => Math.abs(new Date(x.dueDate + "T00:00:00").getTime() - target) - Math.abs(new Date(y.dueDate + "T00:00:00").getTime() - target))[0];
      if (!occ) continue;
      out.push({ bill: b, dueDate: occ.dueDate, overlap, diff: amt > 0 && b.estimatedAmount > 0 ? Math.abs(amt - b.estimatedAmount) / b.estimatedAmount : null });
    }
    return out.sort((a, z) => z.overlap - a.overlap || (a.diff ?? 9) - (z.diff ?? 9)).slice(0, 3);
  }, [addOpen, aVendor, aDate, aAmount, bills, billPayments]);

  // ---------------- Mark paid ----------------
  function nextCheckFor(fromKey: string): string {
    if (!data || !fromKey.startsWith("bank:")) return "";
    const n = data.lastCheck[fromKey.slice(5)];
    return n ? String(n + 1) : "";
  }
  function openPay(f: FileRow, editing: boolean) {
    if (!data) return;
    const credit = !editing && f.account_kind === "vendor" ? data.credits[f.account_id] ?? 0 : 0;
    const prior = editing ? 0 : f.paid ? 0 : Number(f.paid_amount ?? 0);
    const due0 = Math.max(0, Number(f.amount ?? 0) - Number(f.credit_applied ?? 0) - prior);
    const due = Math.max(0, due0 - Math.min(credit, due0));
    const method = (editing && (f.paid_method as any)) || "check";
    const from = editing && f.paid_from_kind && f.paid_from_id ? `${f.paid_from_kind}:${f.paid_from_id}` : f.paid_from_kind && f.paid_from_id && f.autopay ? `${f.paid_from_kind}:${f.paid_from_id}` : data.payAccounts[0] ? `${data.payAccounts[0].kind}:${data.payAccounts[0].id}` : "other";
    setPayFor(f); setPEditing(editing); setPErr(""); setPNote(editing ? f.paid_note ?? "" : "");
    setPDate(editing ? f.paid_date ?? data.today : data.today);
    setPMethod(method); setPFrom(from);
    setPCheck(editing ? f.paid_check_number ?? "" : method === "check" ? nextCheckFor(from) : "");
    setPAmount(editing ? String(f.paid_amount ?? f.amount ?? "") : due.toFixed(2));
    setPDiff(""); setPUseCredit(true);
  }
  // What's due, what's being paid, and the difference between them.
  const payCalc = (() => {
    if (!payFor || !data) return null;
    const credit = !pEditing && payFor.account_kind === "vendor" ? data.credits[payFor.account_id] ?? 0 : 0;
    const prior = pEditing ? 0 : payFor.paid ? 0 : Number(payFor.paid_amount ?? 0);
    const due0 = Math.max(0, Number(payFor.amount ?? 0) - Number(payFor.credit_applied ?? 0) - prior);
    const creditUse = pUseCredit ? Math.min(credit, due0) : 0;
    const due = Math.max(0, due0 - creditUse);
    const pay = isNum(pAmount) ? num(pAmount) : NaN;
    const delta = isNaN(pay) ? 0 : Math.round((pay - due) * 100) / 100;
    const under = delta < -0.004, over = delta > 0.004;
    const diff = under ? (pDiff === "partial" ? "partial" : "settled") : over ? (pDiff === "note" ? "note" : "credit") : "";
    return { credit, creditUse, due, pay, delta, under, over, diff, prior };
  })();
  async function confirmPay(allowDuplicateCheck = false) {
    if (!payFor || !payCalc) return;
    if (isNaN(payCalc.pay) || payCalc.pay < 0) { setPErr("Enter the amount paid."); return; }
    const acct = data?.payAccounts.find((a) => `${a.kind}:${a.id}` === pFrom);
    if (pMethod === "check") {
      if (!pCheck.trim()) { setPErr("Enter the check number."); return; }
      if (!acct || acct.kind !== "bank") { setPErr("Choose the bank account the check is drawn on."); return; }
    }
    setBusy(true); setPErr("");
    const r = await api("/api/statements/manage", {
      action: "markInvoicePaid", id: payFor.id, paid: true, editing: pEditing, paidDate: pDate, method: pMethod, checkNumber: pCheck, allowDuplicateCheck,
      paidFromKind: acct ? acct.kind : "other", paidFromId: acct?.id ?? "", paidFromName: acct ? acct.name : "Other", paidNote: pNote,
      paidAmount: payCalc.pay, diff: payCalc.diff || undefined, useCredit: pUseCredit && payCalc.creditUse > 0,
    });
    setBusy(false);
    if (r.status === 409 && r.json.duplicate) {
      const d = r.json.duplicate;
      if (window.confirm(`Check #${pCheck.trim()} on ${acct?.name ?? "this account"} is already on the register (${d.payee || "no payee"}, ${money(d.amount)}, ${d.check_date}). Use this number anyway?`)) confirmPay(true);
      return;
    }
    if (!r.ok) { setPErr(r.json.error ?? "Couldn't save the payment."); return; }
    setPayFor(null); changed();
  }

  // ---------------- Edit invoice ----------------
  function openEdit(f: FileRow) {
    setEErr(""); setEVendor(f.account_id); setEDate(f.invoice_date ?? `${f.month}-01`); setEDue(f.due_date ?? ""); setENumber(f.invoice_number ?? "");
    setEAmount(f.amount != null ? String(f.amount) : ""); setECat(view?.catFor(f.account_id, f.category) ?? ""); setEditInv(f);
  }
  async function saveEdit(ignoreDup = false) {
    if (!editInv) return;
    if (!eDate) { setEErr("Enter the statement date."); return; }
    if (!eNumber.trim()) { setEErr("Enter the invoice number."); return; }
    if (!isNum(eAmount)) { setEErr("Enter the amount."); return; }
    setBusy(true); setEErr("");
    const r = await api("/api/statements/manage", { action: "editInvoice", id: editInv.id, accountId: eVendor, invoiceDate: eDate, dueDate: eDue, invoiceNumber: eNumber, amount: num(eAmount), category: eCat, ignoreDup });
    setBusy(false);
    if (r.status === 409 && r.json.error === "duplicate") {
      const m = (r.json.matches ?? [])[0];
      if (window.confirm(`This looks like a duplicate of ${m?.account_name ?? "another statement"} #${m?.invoice_number || "(no number)"} (${m?.reason ?? "same details"}). Save it anyway?`)) saveEdit(true);
      return;
    }
    if (!r.ok) { setEErr(r.json.error ?? "Couldn't save the changes."); return; }
    const nm = eDate.slice(0, 7);
    setEditInv(null); setMsg(`Invoice ${eNumber.trim()} updated.`);
    if (nm !== month) setMonth(nm); else changed();
  }

  // ---------------- Account statements (bank / card / loan) ----------------
  function openAcct(a: Acct) { setAcctDlg(a); setSFile(null); setSErr(""); setSAmount(data?.cfBalances[`${a.kind}:${a.id}`] != null ? String(data.cfBalances[`${a.kind}:${a.id}`]) : ""); }
  async function fileAcct(ignoreDup = false) {
    if (!acctDlg || !data) return;
    if (!sFile) { setSErr("Attach the statement PDF first."); return; }
    if (!/\.pdf$/i.test(sFile.name)) { setSErr("Only PDF files can be uploaded."); return; }
    if (!isNum(sAmount)) { setSErr("Enter the statement balance."); return; }
    const a = acctDlg;
    setBusy(true); setSErr("");
    if (!ignoreDup) {
      const chk = await api("/api/statements/manage", { action: "checkDuplicate", docType: "statement", accountKind: a.kind, accountId: a.id, accountName: a.name, month, amount: num(sAmount) });
      const cf: number | null | undefined = chk.json.cfBalance;
      const cfDiffers = cf != null && Math.abs(cf - num(sAmount)) > 0.004;
      if (chk.ok && ((chk.json.matches ?? []).length > 0 || cfDiffers)) {
        setBusy(false);
        const why = (chk.json.matches ?? []).length > 0 ? "A statement is already filed for this month." : `Cash Flow already has ${money(cf)} as this month's balance, and filing this will replace it with ${money(num(sAmount))}.`;
        if (window.confirm(`${why} File it anyway?`)) return fileAcct(true);
        return;
      }
    }
    const slot = await api("/api/statements/upload-url", { accountKind: a.kind, accountName: a.name, month, fileName: sFile.name, size: sFile.size });
    if (!slot.ok) { setBusy(false); setSErr(slot.json.error ?? "Couldn't start the upload."); return; }
    const up = await supabase.storage.from("statements").uploadToSignedUrl(slot.json.path, slot.json.token, sFile, { contentType: "application/pdf" });
    if (up.error) { setBusy(false); setSErr(`Upload failed: ${up.error.message}`); return; }
    const rec = await api("/api/statements/manage", { action: "confirm", path: slot.json.path, accountKind: a.kind, accountId: a.id, accountName: a.name, month, fileName: sFile.name, size: sFile.size, amount: num(sAmount), dupIgnored: ignoreDup });
    setBusy(false);
    if (!rec.ok) { setSErr(rec.json.error ?? "Couldn't record the statement."); return; }
    setAcctDlg(null); setMsg(`Filed ${sFile.name}.${rec.json.synced ? " Saved as this month's statement balance in Cash Flow." : ""}`); changed();
  }
  async function skipAcct(a: Acct) {
    const note = window.prompt("Why is there no statement? (optional, e.g. account had no activity)") ?? "";
    if (await manage({ action: "markNone", accountKind: a.kind, accountId: a.id, accountName: a.name, month, note })) changed();
  }

  // ---------------- Render ----------------
  if (!view || !data) {
    return (
      <div className="rounded-2xl bg-white shadow px-5 py-6 text-sm text-slate-500">
        {loadError ? <p className="text-red-600 font-semibold">⚠️ {loadError}</p> : loading ? "Loading…" : null}
      </div>
    );
  }
  const today = data.today;
  const monthWord = FULL[Number(month.slice(5)) - 1];
  const grand = totals(view.shown);
  const all = totals(view.rows);
  let credits = 0, nUnpaid = 0, nAuto = 0, nAutoUnpaid = 0, autoAmt = 0, nOver = 0, overAmt = 0, nPaid = 0, nBills = 0;
  for (const r of view.rows) if (r.kind === "bill") {
    nBills++;
    if (r.f.autopay) nAuto++;
    if (r.f.paid) { nPaid++; credits += Math.max(0, Number(r.f.amount ?? 0) - paidSum(r.f)); }
    else {
      nUnpaid++;
      if (r.f.autopay) { nAutoUnpaid++; autoAmt += owedOf(r.f); }
      else if (r.f.due_date && r.f.due_date < today) { nOver++; overAmt += owedOf(r.f); }
    }
  }
  const waitNames = view.waiting.map((w) => w.vendor);
  const waitUnique = [...new Set(waitNames)].sort((x, y) => x.localeCompare(y, undefined, { sensitivity: "base" }));
  const waitText = waitUnique.length <= 6 ? waitUnique.join(", ").replace(/, ([^,]*)$/, waitUnique.length > 1 ? " and $1" : "$1") : `${waitUnique.slice(0, 6).join(", ")} and ${waitUnique.length - 6} more`;
  const notExpected = data.sources.filter((x) => x.active && view.prefMap[`vendor:${x.id}`]?.expect === "never");

  // ---- the table look: flat grid, pale blue-grey header, thin lines between columns and rows ----
  const QINK = "#393A3D", QMUTED = "#6B6C72", QBORDER = "#D4D7DC", QROW = "#E3E5E8", QHEAD = "#E6ECF3", QLINK = "#0A5EB0";
  const cell: React.CSSProperties = { height: 52, padding: "6px 12px", verticalAlign: "middle", borderTop: `1px solid ${QROW}`, borderRight: `1px solid ${QBORDER}` };
  const thS: React.CSSProperties = { padding: "14px 12px", fontSize: 15, fontWeight: 700, color: QINK, background: QHEAD, borderRight: "1px solid #fff", textAlign: "left" };
  const dash = <span style={{ color: "#8a8b90" }}>—</span>;
  const tabBtn = (fl: Filter, label: string) => (
    <button key={fl} type="button" onClick={() => setFilter(fl)} aria-pressed={filter === fl}
      style={{ height: 44, padding: "0 22px", borderRadius: 6, fontSize: 16, ...(filter === fl ? { background: "#fff", color: QINK, border: `1px solid ${QBORDER}`, boxShadow: "0 1px 2px rgba(0,0,0,0.06)", fontWeight: 600 } : { background: "transparent", color: "#4a4b50", border: "1px solid transparent" }) }}>
      {label} ({view.counts[fl]})
    </button>
  );
  const card = (fl: Filter, label: string, big: string, sub: string, badge: number, tone = QINK) => {
    const on = filter === fl;
    return (
      <button key={fl} type="button" onClick={() => setFilter(fl)} aria-pressed={on} className="text-left"
        style={{ flex: "1 1 250px", minWidth: 0, background: "#fff", border: on ? `2px solid ${DEEP}` : `1px solid ${QBORDER}`, borderRadius: 10, padding: on ? "15px 19px" : "16px 20px", display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="flex items-center justify-between" style={{ fontSize: 15, color: "#4a4b50" }}>{label}<span className="inline-flex items-center justify-center" style={{ minWidth: 26, height: 26, padding: "0 6px", borderRadius: 999, background: "#4F5258", color: "#fff", fontSize: 13, fontWeight: 700 }}>{badge}</span></span>
        <span style={{ fontSize: 26, fontWeight: 700, color: tone, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{big}</span>
        <span style={{ fontSize: 14, color: QMUTED }}>{sub}</span>
      </button>
    );
  };

  // One line per value, always: nothing wraps, long text is cut with "…" (hover shows all of it).
  const clip: React.CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  const shortAcct = (n: string) => n.replace(/\b(business|checking|savings|account)\b/gi, "").replace(/\s+/g, " ").trim();
  const menuItem = "block w-full text-left px-3 py-2 text-sm hover:bg-slate-50";

  // Statement date and due date together: "Oct 1 → Oct 15". The due date turns red when overdue, amber when due within a week.
  const datesCell = (f: FileRow) => {
    const stmt = dlabel(f.invoice_date ?? `${f.month}-01`);
    if (!f.due_date) return <div style={clip}>{stmt}</div>;
    return <div style={clip}>{stmt} <span style={{ color: QMUTED }}>→</span> <span style={{ color: f.paid || f.autopay ? QINK : f.due_date < today ? "#B3261E" : daysBetween(f.due_date, today) <= 7 ? "#9A5B00" : QINK, fontWeight: !f.paid && !f.autopay && daysBetween(f.due_date, today) <= 7 ? 700 : 400 }}>{dlabel(f.due_date)}</span></div>;
  };
  // Status: what needs doing, or when it was paid. Single line.
  const statusCell = (r: Extract<Row, { kind: "bill" }>) => {
    const f = r.f;
    if (f.paid) {
      const paid = paidSum(f), amt = Number(f.amount ?? 0), diff = paid - amt;
      return (
        <div style={clip} title={Math.abs(diff) > 0.004 ? `Paid ${money(paid)} against ${money(amt)} billed` : undefined}>
          <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: "#14532D" }}><Icon d={P.check} size={16} />{dlabel(f.paid_date)}</span>
          {f.paid_auto && <span style={{ color: "#55565b" }}> · Auto</span>}
          {Math.abs(diff) > 0.004 && <span style={{ color: QMUTED }}> · {diff < 0 ? "−" : "+"}{money(Math.abs(diff))}</span>}
        </div>
      );
    }
    if (f.autopay) return <span className="inline-flex items-center gap-1.5 rounded-full font-bold whitespace-nowrap" style={{ height: 28, padding: "0 10px", background: "#E4ECF8", color: "#1B3A6B", fontSize: 13 }}><Icon d={P.refresh} size={14} />Autopay {f.due_date ? dlabel(f.due_date) : ""}</span>;
    if (Number(f.paid_amount ?? 0) > 0) return <div style={{ ...clip, color: "#9A5B00", fontWeight: 600 }}>Partial · {money(owedOf(f)).replace(/\.00$/, "")} left</div>;
    if (f.due_date) {
      const n = daysBetween(f.due_date, today);
      if (n < 0) return <Pill text={`Overdue ${-n} days`} bg="#FADBD8" fg="#8E1F1A" />;
      if (n === 0) return <Pill text="Due today" bg="#FDEBC8" fg="#7A4208" />;
      if (n <= 7) return <Pill text={`Due in ${n} days`} bg="#FDEBC8" fg="#7A4208" />;
    }
    return <span style={{ color: QMUTED }}>Unpaid</span>;
  };
  const fromCell = (f: FileRow) => {
    const nm = shortAcct(f.paid_from_name || "");
    let t = "";
    if (f.paid) t = f.paid_auto ? `Autopay · ${nm || "account on file"}` : f.paid_method === "check" ? `Check #${f.paid_check_number} · ${nm}` : f.paid_method === "ach" ? `ACH · ${nm}` : f.paid_method === "card" ? `Card · ${nm}` : nm || "Other";
    else if (f.autopay) t = `Autopay · ${nm}`;
    return t ? <div style={{ ...clip, fontSize: 14 }} title={t}>{t}</div> : dash;
  };
  // The blue action link, then an arrow for the rest. No divider line.
  const actionCell = (key: string, label: string, onClick: () => void, items: { label: string; onClick: () => void; danger?: boolean }[] = []) => (
    <div className="flex items-center whitespace-nowrap">
      <button type="button" onClick={onClick} disabled={busy} className="font-semibold" style={{ color: QLINK, fontSize: 15, height: 40 }}>{label}</button>
      {items.length > 0 && (
        <span className="relative inline-block">
          <button type="button" aria-label="More actions" onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === key ? null : key); }} className="inline-flex items-center justify-center rounded-lg" style={{ width: 32, height: 40, color: "#4a4b50" }}><Icon d={P.down} /></button>
          {menuFor === key && (
            <div className="absolute right-0 z-30 mt-1 rounded-xl bg-white shadow-lg py-1" style={{ minWidth: 230, border: `1px solid ${LINE}` }} onClick={(e) => e.stopPropagation()}>
              {items.map((it) => <button key={it.label} type="button" className={menuItem} style={it.danger ? { color: "#b91c1c" } : undefined} onClick={() => { setMenuFor(null); it.onClick(); }}>{it.label}</button>)}
            </div>
          )}
        </span>
      )}
    </div>
  );
  // The vendor's name sits on the first row of its block only; its other statements line up underneath.
  const vendorCell = (r: Row, showName: boolean) => (
    <td style={cell}>
      {showName
        ? <div style={{ ...clip, fontWeight: 700, fontSize: 15, color: r.kind === "skipped" ? "#55565b" : QINK }} title={r.vendor}>{r.vendor}</div>
        : <span className="sr-only">{r.vendor}</span>}
    </td>
  );
  const invoiceCell = (r: Row) => {
    const f = "f" in r ? r.f : null;
    return <td style={cell}>{f?.invoice_number ? <div style={clip} title={f.invoice_number}>#{f.invoice_number}</div> : r.kind === "doc" ? <span style={{ color: QMUTED }}>Statement</span> : dash}</td>;
  };
  // Category is a setting on the vendor: pick it here and all of that vendor's statements move.
  const categoryCell = (r: Row) => (
    <td style={cell}>
      {finance && view.srcMap[r.vendorId] ? (
        <select aria-label={`Category for ${r.vendor}`} value={r.cat} onChange={(e) => changeCategory(r.vendorId, e.target.value)} className="w-full rounded cursor-pointer hover:bg-slate-50 focus:outline-none" style={{ height: 34, fontSize: 14, border: "1px solid transparent", background: "transparent", color: QINK }}>
          {[...new Set([...allCats, r.cat])].map((c) => <option key={c} value={c}>{c}</option>)}
          <option value="__new">+ New category…</option>
        </select>
      ) : <div style={clip}>{r.cat}</div>}
    </td>
  );
  const vendorItems = (vendorId: string, vendor: string) => (view.srcMap[vendorId]
    ? [{ label: "Rename vendor…", onClick: () => renameVendor(vendorId, vendor) }, { label: "Merge into another vendor…", onClick: () => openMerge(vendorId) }]
    : []);
  const renderRow = (r: Row, showName: boolean) => {
    if (r.kind === "waiting") {
      return (
        <tr key={`w:${r.vendorId}`}>
          {vendorCell(r, showName)}<td style={cell}>{dash}</td>{categoryCell(r)}
          <td style={{ ...cell, color: QMUTED, fontStyle: "italic" }} colSpan={2}><div style={clip}>{monthWord} statement hasn’t come in yet</div></td>
          <td style={cell}><Pill text="Waiting" bg="#E8EAED" fg="#3d3e42" /></td>
          <td style={cell}>{dash}</td>
          <td style={cell}>{finance && actionCell(`w:${r.vendorId}`, "Add statement", () => openAdd({ vendor: r.vendor }), [
            { label: "Skip this month", onClick: () => skipVendor(r.vendorId, r.vendor) },
            { label: "Only expect when they bill", onClick: () => setExpect(r.vendorId, "never") },
            ...vendorItems(r.vendorId, r.vendor),
          ])}</td>
        </tr>
      );
    }
    if (r.kind === "skipped") {
      return (
        <tr key={`s:${r.f.id}`} style={{ background: "#FAFAFB" }}>
          {vendorCell(r, showName)}<td style={cell}>{dash}</td>{categoryCell(r)}
          <td style={{ ...cell, color: QMUTED, fontStyle: "italic" }} colSpan={3}><div style={clip}>Skipped for {monthWord}</div></td>
          <td style={cell}>{dash}</td>
          <td style={cell}>{finance && actionCell(`s:${r.f.id}`, "Undo skip", () => undoSkip(r.f))}</td>
        </tr>
      );
    }
    const f = r.f;
    if (r.kind === "doc") {
      return (
        <tr key={f.id}>
          {vendorCell(r, showName)}{invoiceCell(r)}{categoryCell(r)}
          <td style={cell}><div style={clip}>{dlabel(f.invoice_date ?? `${f.month}-01`)}</div></td>
          <td style={{ ...cell, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(f.amount)}</td>
          <td style={cell}>{dash}</td><td style={cell}>{dash}</td>
          <td style={cell}>{f.file_name ? actionCell(`d:${f.id}`, "View PDF", () => download(f), finance ? [{ label: "Delete", onClick: () => removeFile(f), danger: true }] : []) : null}</td>
        </tr>
      );
    }
    // A bill: the main link depends on its state, the arrow holds the rest.
    const items: { label: string; onClick: () => void; danger?: boolean }[] = [];
    if (f.file_name) items.push({ label: "Open PDF", onClick: () => download(f) });
    let primary = { label: "Mark paid", onClick: () => openPay(f, false) };
    if (f.paid || f.autopay) primary = { label: "Edit", onClick: () => openEdit(f) };
    if (!f.paid && !f.autopay) items.push({ label: "Edit invoice", onClick: () => openEdit(f) });
    if (f.paid) { items.push({ label: "Edit payment", onClick: () => openPay(f, true) }); items.push({ label: "Undo paid", onClick: () => undoPaid(f) }); }
    else if (Number(f.paid_amount ?? 0) > 0) items.push({ label: "Undo partial payment", onClick: () => undoPaid(f) });
    if (f.autopay && f.paid_auto) items.push({ label: "Autopay didn’t go through", onClick: () => autopayFailed(f) });
    if (f.matched_bill_id && !f.paid) items.push({ label: "Unlink scheduled bill", onClick: () => unlinkBill(f) });
    items.push({ label: "Add another for this vendor", onClick: () => openAdd({ vendor: r.vendor }) });
    items.push(...vendorItems(r.vendorId, r.vendor));
    items.push({ label: "Delete", onClick: () => removeFile(f), danger: true });
    return (
      <tr key={f.id}>
        {vendorCell(r, showName)}{invoiceCell(r)}{categoryCell(r)}
        <td style={cell}>{datesCell(f)}</td>
        <td style={{ ...cell, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(f.amount)}</td>
        <td style={cell}>{statusCell(r)}</td>
        <td style={cell}>{fromCell(f)}</td>
        <td style={cell}>{finance ? actionCell(f.id, primary.label, primary.onClick, items) : f.file_name ? actionCell(f.id, "View PDF", () => download(f)) : null}</td>
      </tr>
    );
  };

  // ---- account statements join the list: banks, credit cards and loans, each group alphabetical (one bank's accounts sit together) ----
  const ACCT_CAT: Record<string, string> = { bank: "Bank", card: "Credit card", loan: "Loan" };
  const acctSort = (x: Acct, y: Acct) => x.name.localeCompare(y.name, undefined, { numeric: true, sensitivity: "base" });
  const acctVisible = (x: Acct) => filter === "all" && dueFilter === "all" && (!catFilter || catFilter === ACCT_CAT[x.kind]) && x.name.toLowerCase().includes(search.trim().toLowerCase());
  const bankAccts = data.accounts.filter((x) => x.kind === "bank" && acctVisible(x)).sort(acctSort);
  const cardAccts = data.accounts.filter((x) => x.kind === "card" && acctVisible(x)).sort(acctSort);
  const loanAccts = data.accounts.filter((x) => x.kind === "loan" && acctVisible(x)).sort(acctSort);
  const acctRow = (a: Acct) => {
    const fs = data.files.filter((f) => f.account_kind === a.kind && f.account_id === a.id && f.doc_type !== "invoice");
    const filed = fs.find((f) => !f.no_statement), none = fs.find((f) => f.no_statement);
    const late = month < data.currentMonth;
    const status = filed ? <Pill text="Filed" bg="#E3F3E9" fg="#14532D" /> : none ? <Pill text="No statement" bg="#E8EAED" fg="#4a4b50" /> : late ? <Pill text="Waiting" bg="#FDEBC8" fg="#7A4208" /> : <Pill text="Not out yet" bg="#E8EAED" fg="#4a4b50" />;
    let action: React.ReactNode = null;
    if (filed) action = actionCell(`a:${a.kind}:${a.id}`, "View PDF", () => download(filed), finance ? [{ label: "Remove", onClick: () => removeFile(filed), danger: true }] : []);
    else if (none) action = finance ? actionCell(`a:${a.kind}:${a.id}`, "Undo", () => undoSkip(none)) : null;
    else if (finance) action = actionCell(`a:${a.kind}:${a.id}`, "File statement", () => openAcct(a), [{ label: "No statement this month", onClick: () => skipAcct(a) }]);
    return (
      <tr key={`${a.kind}:${a.id}`}>
        <td style={cell}><div style={{ ...clip, fontWeight: 700, fontSize: 15 }} title={a.name}>{a.name}</div></td>
        <td style={cell}>{dash}</td>
        <td style={cell}><div style={clip}>{ACCT_CAT[a.kind]}</div></td>
        <td style={cell}>{filed ? <div style={clip}>{MON[Number(month.slice(5)) - 1]} {month.slice(0, 4)}</div> : dash}</td>
        <td style={{ ...cell, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{filed ? money(filed.amount) : dash}</td>
        <td style={cell}>{status}</td>
        <td style={cell}>{filed?.file_name ? <div style={{ ...clip, fontSize: 14 }} title={filed.file_name}>{filed.file_name}</div> : dash}</td>
        <td style={cell}>{action}</td>
      </tr>
    );
  };
  // Main headings only: Vendors, Banks, Credit Cards, Loans. The category is a column, not a heading.
  const mainBand = (key: string, title: string, count: string) => {
    const open = !collapsed[`main:${key}`];
    return (
      <tr key={`main:${key}`}><td colSpan={8} style={{ padding: 0, background: "#D9E3EE", borderTop: `2px solid ${QBORDER}` }}>
        <button type="button" onClick={() => setCollapsed((m) => ({ ...m, [`main:${key}`]: !m[`main:${key}`] }))} aria-expanded={open} className="w-full flex items-center gap-3 text-left" style={{ padding: "14px 14px" }}>
          <span className="inline-flex" style={{ color: "#3b4a5c", transform: open ? "none" : "rotate(-90deg)" }}><Icon d={P.down} size={20} /></span>
          <span style={{ fontWeight: 800, fontSize: 19, letterSpacing: "0.01em" }}>{title}</span>
          <span style={{ fontSize: 14, color: "#4a5868" }}>{count}</span>
        </button>
      </td></tr>
    );
  };
  const stmtCount = (rs: Row[]) => rs.filter((r) => r.kind === "bill" || r.kind === "doc").length;
  const waitCount = (rs: Row[]) => rs.filter((r) => r.kind === "waiting").length;
  const countText = (rs: Row[]) => `${stmtCount(rs)} statement${stmtCount(rs) === 1 ? "" : "s"}${waitCount(rs) ? ` · ${waitCount(rs)} waiting` : ""}`;
  const blocks = (rs: Row[]) => rs.map((r, i) => renderRow(r, i === 0 || rs[i - 1].vendor.toLowerCase() !== r.vendor.toLowerCase()));

  const modal = (children: React.ReactNode, wide = false) => (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 py-6 overflow-y-auto" style={{ background: "rgba(15,23,42,0.35)" }}>
      <div className={`w-full ${wide ? "max-w-xl" : "max-w-md"} rounded-2xl bg-white p-5 shadow-xl space-y-3`}>{children}</div>
    </div>
  );
  const closeX = (onClick: () => void) => <button type="button" aria-label="Close" onClick={onClick} className="inline-flex items-center justify-center rounded-lg" style={{ width: 44, height: 44, color: "#4a4a4a" }}><Icon d={P.x} size={20} /></button>;
  const fileBox = (file: File | null, setFile: (f: File | null) => void, id: string) => (
    <div className="rounded-xl flex items-center gap-3" style={{ border: `2px dashed #E2B48C`, background: "#FFF8F0", padding: "14px 16px" }}>
      <span className="inline-flex items-center justify-center rounded-lg" style={{ width: 44, height: 44, background: "#FDEBD8", color: DEEP }}><Icon d={file ? P.doc : P.upload} size={22} /></span>
      <div className="flex-1 min-w-0">
        {file ? <><div className="font-bold text-sm truncate">{file.name}</div><div className="text-xs" style={{ color: "#5f5f5f" }}>{(file.size / 1024 / 1024).toFixed(1)} MB · attached</div></>
          : <><div className="font-bold text-sm">Drop the statement PDF here</div><div className="text-xs" style={{ color: "#5f5f5f" }}>You can attach it now, or after filling in the details.</div></>}
      </div>
      <label htmlFor={id} className={`${btnBase} cursor-pointer`} style={{ height: 40, padding: "0 14px", fontSize: 13, background: "#fff", color: INK, border: "1px solid #CFC6AF" }}>{file ? "Replace" : "Choose a file"}</label>
      <input id={id} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setFile(f); }} />
    </div>
  );
  const matchedVendor = vendorByName(aVendor);
  const vendorCredit = matchedVendor ? data.credits[matchedVendor.id] ?? 0 : 0;

  // ---- export ----
  function exportCsv() {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Category", "Vendor", "Invoice #", "Statement date", "Amount", "Due by", "Paid", "Paid date", "Amount paid", "Paid from"].map(q).join(",")];
    for (const r of view!.shown) if (r.kind === "bill") {
      const f = r.f;
      lines.push([r.cat, r.vendor, f.invoice_number ?? "", f.invoice_date ?? f.month, f.amount ?? "", f.due_date ?? "", f.paid ? "Yes" : "No", f.paid_date ?? "", f.paid ? paidSum(f) : "", f.paid_from_name ?? ""].map(q).join(","));
    }
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `statements-${month}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  return (
    <div className="space-y-5" style={{ color: QINK }}>
      <style>{`.stm td:last-child,.stm th:last-child{border-right:none !important}.stm tr.grand td{border-right:1px solid rgba(255,255,255,0.22) !important}@media print{.no-print{display:none !important}}`}</style>

      {/* Title row */}
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <h1 className="m-0" style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: 36, lineHeight: 1.15 }}>Statements</h1>
        <div className="flex items-center gap-5">
          <button type="button" onClick={() => load()} className="inline-flex items-center gap-2 font-semibold" style={{ color: QLINK, fontSize: 17, height: 44 }}><Icon d={P.refresh} size={20} />Update</button>
          {finance && (
            <button type="button" onClick={() => openAdd()} className="rounded-lg font-bold" style={{ background: ORANGE, color: INK, fontSize: 17, height: 48, padding: "0 26px" }}>Add statement</button>
          )}
        </div>
      </div>

      {/* Month heading */}
      <div className="flex flex-wrap items-center gap-4 no-print">
        <span className="inline-flex items-center justify-center rounded-full" style={{ width: 56, height: 56, background: "#1F6FB2", color: "#fff" }}><Icon d={P.cal} size={28} /></span>
        <div className="flex items-center gap-2">
          <select aria-label="Month" value={Number(month.slice(5))} onChange={(e) => setMonth(`${month.slice(0, 4)}-${String(e.target.value).padStart(2, "0")}`)} className="bg-transparent focus:outline-none cursor-pointer" style={{ fontSize: 32, fontWeight: 500 }}>
            {FULL.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select aria-label="Year" value={month.slice(0, 4)} onChange={(e) => setMonth(`${e.target.value}-${month.slice(5)}`)} className="bg-transparent focus:outline-none cursor-pointer" style={{ fontSize: 32, fontWeight: 500 }}>
            {Array.from({ length: 8 }, (_, i) => Number(data.currentMonth.slice(0, 4)) - 6 + i).map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
        </div>
        <button type="button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} className="inline-flex items-center justify-center rounded-lg bg-white" style={{ width: 40, height: 40, border: `1px solid ${QBORDER}` }}><Icon d={P.left} /></button>
        <button type="button" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} className="inline-flex items-center justify-center rounded-lg bg-white" style={{ width: 40, height: 40, border: `1px solid ${QBORDER}` }}><Icon d={P.right} /></button>
        {month !== data.currentMonth && <button type="button" onClick={() => setMonth(data.currentMonth)} className="font-semibold" style={{ color: QLINK, fontSize: 15 }}>Go to this month</button>}
      </div>

      {loadError && <p className="text-sm text-red-600 font-semibold">⚠️ {loadError}</p>}
      {msg && <p className="text-sm font-semibold text-slate-600">{msg}</p>}

      {/* Cards: they filter the list too */}
      <div className="flex flex-wrap gap-4 no-print">
        {card("all", "All statements", money(all.t), `Paid: ${money(all.p)}${credits > 0.004 ? ` · ${money(credits)} in credits` : ""}`, nBills)}
        {card("unpaid", "Still owed", money(all.o), `${nOver} overdue (${money(overAmt)})`, nUnpaid, "#8E1F1A")}
        {card("autopay", "On autopay", money(autoAmt), `${nAutoUnpaid} scheduled · ${nAuto - nAutoUnpaid} paid so far`, nAuto)}
        {card("waiting", "Waiting on", `${waitUnique.length} vendor${waitUnique.length === 1 ? "" : "s"}`, waitUnique.length === 0 ? "Nothing outstanding" : waitUnique.length <= 2 ? waitUnique.join(", ") : `${waitUnique.slice(0, 2).join(", ")} +${waitUnique.length - 2} more`, view.counts.waiting)}
      </div>

      {/* Waiting bar */}
      {(waitNames.length > 0 || data.prevMissing.length > 0) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl no-print" style={{ background: "#FDEBC8", color: "#5E3306", padding: "8px 8px 8px 16px" }}>
          <span className="inline-flex" style={{ color: "#7A4208" }}><Icon d={P.clock} size={20} /></span>
          <div className="leading-snug" style={{ flex: "1 1 420px", fontSize: 15 }}>
            {waitUnique.length > 0 && <div><strong>Waiting on {waitUnique.length} vendor{waitUnique.length === 1 ? "" : "s"} for {monthWord}:</strong> {waitText}. Add each one when it arrives, or skip it if you don’t expect one this month.</div>}
            {data.prevMissing.length > 0 && <div className={waitUnique.length > 0 ? "mt-1" : ""}><strong>{FULL[Number(data.prevMonth.slice(5)) - 1]} account statements still missing:</strong> {[...data.prevMissing].sort((x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" })).join(", ")}.</div>}
          </div>
          <div className="flex gap-2">
            {waitUnique.length > 0 && <button type="button" onClick={() => setFilter("waiting")} className={btnBase} style={{ height: 40, padding: "0 14px", fontSize: 14, background: "#fff", color: INK, border: "1px solid #CFC6AF" }}>Show only waiting</button>}
            {data.prevMissing.length > 0 && <button type="button" onClick={() => setMonth(data.prevMonth)} className={btnBase} style={{ height: 40, padding: "0 14px", fontSize: 14, background: "#fff", color: INK, border: "1px solid #CFC6AF" }}>Go to {FULL[Number(data.prevMonth.slice(5)) - 1]}</button>}
          </div>
        </div>
      )}

      {finance && view.dupPairs.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl no-print" style={{ background: "#E4ECF8", color: "#1B3A6B", padding: "8px 8px 8px 16px" }}>
          <div className="leading-snug" style={{ flex: "1 1 420px", fontSize: 15 }}>
            <strong>These may be the same vendor:</strong> {view.dupPairs.slice(0, 3).map((d, i) => <span key={d.from.id + d.into.id}>{i > 0 && "; "}{d.from.name} / {d.into.name}</span>)}. Merge them so their statements sit under one title.
          </div>
          <button type="button" onClick={() => openMerge(view.dupPairs[0].from.id, view.dupPairs[0].into.id)} className={btnBase} style={{ height: 40, padding: "0 14px", fontSize: 14, background: "#fff", color: INK, border: "1px solid #CFC6AF" }}>Merge…</button>
        </div>
      )}

      {/* Tabs */}
      <div className="inline-flex self-start rounded-lg no-print" style={{ background: "#E9EBEF", padding: 4, gap: 2, border: `1px solid ${QBORDER}` }}>
        {tabBtn("all", "All")}{tabBtn("unpaid", "Unpaid")}{tabBtn("paid", "Paid")}{tabBtn("waiting", "Waiting")}{tabBtn("autopay", "Autopay")}{tabBtn("skipped", "Skipped")}
      </div>

      {/* Toolbar + table */}
      <div className="bg-white overflow-hidden" style={{ border: `1px solid ${QBORDER}`, borderRadius: 10 }}>
        <div className="flex flex-wrap items-center justify-between gap-3 no-print" style={{ padding: "18px 20px" }}>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center justify-between gap-2 rounded-lg" style={{ width: 280, height: 52, border: `1px solid ${QBORDER}`, padding: "0 14px", color: QMUTED }}>
              <span className="sr-only">Search vendors</span>
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="w-full bg-transparent focus:outline-none" style={{ fontSize: 17, color: QINK }} />
              <Icon d={P.search} size={22} />
            </label>
            <label className="flex items-center gap-2 rounded-lg" style={{ width: 220, height: 52, border: `1px solid ${QBORDER}`, padding: "0 12px", color: QMUTED }}>
              <span className="sr-only">Filter by due date</span>
              <select value={dueFilter} onChange={(e) => setDueFilter(e.target.value as typeof dueFilter)} className="w-full bg-transparent focus:outline-none cursor-pointer" style={{ fontSize: 17, color: QINK }}>
                <option value="all">All due dates</option><option value="overdue">Overdue</option><option value="week">Due in 7 days</option>
              </select>
              <Icon d={P.cal} size={22} />
            </label>
            <label className="flex items-center gap-2 rounded-lg" style={{ width: 260, height: 52, border: `1px solid ${QBORDER}`, padding: "0 12px" }}>
              <span className="sr-only">Filter by category</span>
              <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="w-full bg-transparent focus:outline-none cursor-pointer" style={{ fontSize: 17, color: QINK }}>
                <option value="">All categories</option>
                {[...allCats.filter((c) => c !== "Other"), "Bank", "Credit card", "Other"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-5" style={{ color: QMUTED, fontSize: 16 }}>
            <span>1-{view.shown.length} of {view.shown.length}</span>
            <span className="inline-flex items-center gap-1.5"><span style={{ color: "#B5B7BC" }}><Icon d={P.left} size={18} /></span>Page <span className="inline-block text-center rounded-md" style={{ minWidth: 44, border: `1px solid ${QBORDER}`, padding: "8px 0", color: QINK }}>1</span> of 1 <span style={{ color: "#B5B7BC" }}><Icon d={P.right} size={18} /></span></span>
            <span className="inline-flex gap-4" style={{ color: "#4a4b50" }}>
              <button type="button" aria-label="Print" onClick={() => window.print()} className="inline-flex"><Icon d={P.print} size={26} /></button>
              <button type="button" aria-label="Export to a spreadsheet file" onClick={exportCsv} className="inline-flex"><Icon d={P.exp} size={26} /></button>
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="stm w-full" style={{ minWidth: 960, borderCollapse: "collapse", tableLayout: "fixed", fontSize: 15, color: QINK }}>
            <caption className="sr-only">Statements for {mlabel(month)}, sorted by category and then by vendor</caption>
            <colgroup><col /><col style={{ width: 96 }} /><col style={{ width: 124 }} /><col style={{ width: 142 }} /><col style={{ width: 100 }} /><col style={{ width: 124 }} /><col style={{ width: 160 }} /><col style={{ width: 118 }} /></colgroup>
            <thead>
              <tr>
                <th scope="col" style={thS}>Vendor</th><th scope="col" style={thS}>Invoice #</th><th scope="col" style={thS}>Category</th><th scope="col" style={thS}>Statement / Due</th>
                <th scope="col" style={{ ...thS, textAlign: "right" }}>Amount</th><th scope="col" style={thS}>Status</th><th scope="col" style={thS}>Paid from</th><th scope="col" style={thS}>Action</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const vendorCats = view.cats.filter((c) => c !== "Loan");
                const vendorRows = view.shown.filter((r) => r.cat !== "Loan");
                const loanVendorRows = view.shown.filter((r) => r.cat === "Loan");
                // Loans: loan payments to a lender and the loan accounts' own statements, mixed alphabetically
                const entries: { name: string; nodes: React.ReactNode[] }[] = [];
                const byVendor = new Map<string, Row[]>();
                for (const r of loanVendorRows) { const k = r.vendor.toLowerCase(); byVendor.set(k, [...(byVendor.get(k) ?? []), r]); }
                for (const rs of byVendor.values()) entries.push({ name: rs[0].vendor, nodes: rs.map((r, i) => renderRow(r, i === 0)) });
                for (const x of loanAccts) entries.push({ name: x.name, nodes: [acctRow(x)] });
                entries.sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true, sensitivity: "base" }));
                const loanCount = stmtCount(loanVendorRows) + loanAccts.length;
                const nothing = vendorRows.length === 0 && bankAccts.length === 0 && cardAccts.length === 0 && entries.length === 0;
                return (
                  <>
                    {nothing && <tr><td colSpan={8} className="px-4 py-8 text-slate-500">{loading ? "Loading…" : filter === "all" && !search && !catFilter && dueFilter === "all" ? `Nothing for ${mlabel(month)} yet. Use Add statement, or drop a PDF on this page.` : "Nothing matches."}</td></tr>}
                    {vendorRows.length > 0 && (
                      <>
                        {mainBand("Vendors", "Vendors", countText(vendorRows))}
                        {!collapsed["main:Vendors"] && vendorCats.map((cat) => <Fragment key={cat}>{blocks(vendorRows.filter((r) => r.cat === cat))}</Fragment>)}
                      </>
                    )}
                    {bankAccts.length > 0 && (<>{mainBand("Banks", "Banks", `${bankAccts.length} account${bankAccts.length === 1 ? "" : "s"}`)}{!collapsed["main:Banks"] && bankAccts.map(acctRow)}</>)}
                    {cardAccts.length > 0 && (<>{mainBand("Cards", "Credit Cards", `${cardAccts.length} account${cardAccts.length === 1 ? "" : "s"}`)}{!collapsed["main:Cards"] && cardAccts.map(acctRow)}</>)}
                    {entries.length > 0 && (<>{mainBand("Loans", "Loans", `${loanCount} statement${loanCount === 1 ? "" : "s"}`)}{!collapsed["main:Loans"] && entries.map((e, i) => <Fragment key={`${e.name}:${i}`}>{e.nodes}</Fragment>)}</>)}
                    {view.shown.length > 0 && (
                      <tr className="grand" style={{ background: QINK, color: "#fff" }}>
                        <td style={{ padding: 16, fontWeight: 700, fontSize: 16 }} colSpan={3}>{monthWord} total <span style={{ fontWeight: 400, fontSize: 13, opacity: 0.8 }}>· statements with an amount due</span></td><td />
                        <td style={{ padding: "16px 12px", textAlign: "right", fontWeight: 700, fontSize: 16, fontVariantNumeric: "tabular-nums" }}>{money(grand.t)}</td>
                        <td style={{ padding: "16px 12px", fontWeight: 700 }}><div style={clip}>Paid {money(grand.p)}</div></td>
                        <td style={{ padding: "16px 12px", fontWeight: 700 }} colSpan={2}><div style={clip}>Still owed {money(grand.o)}</div></td>
                      </tr>
                    )}
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end gap-5 no-print" style={{ padding: "14px 20px", color: QMUTED, fontSize: 15, borderTop: `1px solid ${QBORDER}` }}>
          <span>1-{view.shown.length} of {view.shown.length} items</span>
          <span className="inline-flex items-center gap-2.5"><span style={{ color: "#B5B7BC" }}><Icon d={P.left} size={18} /></span><span className="inline-flex items-center justify-center rounded-md font-bold" style={{ width: 36, height: 36, background: "#DADDE1", color: QINK }}>1</span><span style={{ color: "#B5B7BC" }}><Icon d={P.right} size={18} /></span></span>
        </div>
      </div>

      {finance && notExpected.length > 0 && (
        <p className="text-sm no-print" style={{ color: QMUTED }}>
          Only expected when they bill: {notExpected.map((x, i) => (<span key={x.id}>{i > 0 && ", "}{x.name} <button type="button" className="underline font-semibold" style={{ color: DEEP }} onClick={() => setExpect(x.id, "monthly")}>expect every month</button></span>))}
        </p>
      )}
      {finance && <div className="flex items-center gap-2.5 text-sm no-print" style={{ color: QMUTED }}><Icon d={P.upload} />Drop statement PDFs anywhere on this page to file them.</div>}

      {/* ---------------- Add statement ---------------- */}
      {addOpen && modal(
        <>
          <div className="flex items-center justify-between"><h2 className="m-0" style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 22 }}>Add a statement</h2>{closeX(() => setAddOpen(false))}</div>
          {fileBox(aFile, setAFile, "add-file")}
          <div>
            <label htmlFor="add-vendor" className={lbl}>Vendor</label>
            <input id="add-vendor" list="vendor-list" value={aVendor} onChange={(e) => applyVendor(e.target.value)} placeholder="Choose a vendor or type a new one" className={inputCls} style={inputBorder} autoComplete="off" />
            <datalist id="vendor-list">{data.sources.filter((s) => s.active).map((s) => <option key={s.id} value={s.name} />)}</datalist>
            <p className="text-xs mt-1" style={{ color: "#5f5f5f" }}>{aVendor.trim() && !matchedVendor ? "New vendor. It joins the list and appears every month after this one." : "Type to search. A new name joins the list and appears every month after this one."}</p>
          </div>
          {!aVendor.trim() && view.waiting.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-xs font-bold mb-1.5" style={{ color: "#3d3d3d" }}><span style={{ color: "#7A4208" }}><Icon d={P.clock} size={16} /></span>Still waiting on this month</div>
              <div className="flex flex-wrap gap-2">{view.waiting.slice(0, 8).map((w) => <button key={w.vendorId} type="button" onClick={() => applyVendor(w.vendor)} className="rounded-full font-semibold" style={{ height: 44, padding: "0 16px", fontSize: 13, border: "1px solid #CFC6AF", background: "#fff", color: INK }}>{w.vendor}</button>)}</div>
            </div>
          )}
          <div className="flex gap-3">
            <div className="flex-1 min-w-0">
              <label htmlFor="add-cat" className={lbl}>Category</label>
              <select id="add-cat" value={aCat} onChange={(e) => { if (e.target.value === "__new") { const c = (window.prompt("New category name:") ?? "").trim().slice(0, 40); if (c) setACat(c); } else setACat(e.target.value); }} className={inputCls} style={inputBorder}>
                <option value="">{matchedVendor ? "—" : "Choose…"}</option>
                {[...new Set([...allCats, ...(aCat ? [aCat] : [])])].map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="__new">+ New category…</option>
              </select>
            </div>
            <div className="flex-1 min-w-0">
              <label htmlFor="add-inv" className={lbl}>Invoice #</label>
              <input id="add-inv" value={aInv} onChange={(e) => setAInv(e.target.value)} className={inputCls} style={inputBorder} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1 min-w-0"><label htmlFor="add-date" className={lbl}>Statement date</label><input id="add-date" type="date" value={aDate} onChange={(e) => setADate(e.target.value)} className={inputCls} style={inputBorder} /></div>
            <div className="flex-1 min-w-0"><label htmlFor="add-due" className={lbl}>Due by</label><input id="add-due" type="date" value={aDue} onChange={(e) => setADue(e.target.value)} className={inputCls} style={inputBorder} /></div>
            <div className="flex-1 min-w-0"><label htmlFor="add-amt" className={lbl}>Amount due</label><input id="add-amt" inputMode="decimal" value={aAmount} onChange={(e) => setAAmount(e.target.value)} placeholder="0.00" className={inputCls} style={{ ...inputBorder, textAlign: "right", fontWeight: 700 }} /></div>
          </div>
          {vendorCredit > 0 && <p className="text-xs rounded-lg px-3 py-2" style={{ background: "#E3F3E9", color: "#14532D" }}>You have a {money(vendorCredit)} credit with {matchedVendor?.name}. It will be offered when you mark this one paid.</p>}
          {suggestions.length > 0 && !aMatch && (
            <div className="rounded-lg px-3 py-2 text-sm space-y-1.5" style={{ background: "#FAEEDA", color: "#854F0B" }}>
              <p className="font-semibold">This may be a bill you already track in Cash Flow:</p>
              {suggestions.map((sg) => (
                <div key={`${sg.bill.id}${sg.dueDate}`} className="flex items-center gap-2 flex-wrap">
                  <span>{sg.bill.name} · due {dlabel(sg.dueDate)}{sg.bill.estimatedAmount > 0 ? ` · est. ${money(sg.bill.estimatedAmount)}` : ""}</span>
                  <button type="button" onClick={() => setAMatch({ billId: sg.bill.id, dueDate: sg.dueDate, billName: sg.bill.name })} className="underline font-semibold">Link it</button>
                </div>
              ))}
            </div>
          )}
          {aMatch && <p className="text-xs rounded-lg px-3 py-2 flex items-center gap-2" style={{ background: "#dbeafe", color: "#1e4e8c" }}>Linked to {aMatch.billName} (due {dlabel(aMatch.dueDate)}). It counts through that bill. <button type="button" onClick={() => setAMatch(null)} className="underline font-semibold">Unlink</button></p>}
          <div className="flex items-start gap-2.5">
            <input id="add-paid" type="checkbox" checked={aPaidNow} onChange={(e) => setAPaidNow(e.target.checked)} disabled={aAuto} style={{ width: 20, height: 20, marginTop: 2, accentColor: DEEP }} />
            <label htmlFor="add-paid" className="text-sm leading-snug">Already paid<br /><span className="text-xs" style={{ color: "#5f5f5f" }}>You’ll enter the date, amount paid and where from right after filing.</span></label>
          </div>
          <div className="flex items-start gap-2.5">
            <input id="add-auto" type="checkbox" checked={aAuto} onChange={(e) => { setAAuto(e.target.checked); if (e.target.checked) setAPaidNow(false); }} style={{ width: 20, height: 20, marginTop: 2, accentColor: DEEP }} />
            <label htmlFor="add-auto" className="text-sm leading-snug">On autopay<br /><span className="text-xs" style={{ color: "#5f5f5f" }}>Marked paid on the due date from the account you choose. Remembered for this vendor, so next month’s statement is already set up.</span></label>
          </div>
          {aAuto && (
            <div>
              <label htmlFor="add-autofrom" className={lbl}>Autopay is paid from</label>
              <select id="add-autofrom" value={aAutoFrom} onChange={(e) => setAAutoFrom(e.target.value)} className={inputCls} style={inputBorder}>
                <option value="">Choose an account…</option>
                <optgroup label="Bank accounts">{data.payAccounts.filter((a) => a.kind === "bank").map((a) => <option key={a.id} value={`bank:${a.id}`}>{a.name}</option>)}</optgroup>
                <optgroup label="Credit cards">{data.payAccounts.filter((a) => a.kind === "card").map((a) => <option key={a.id} value={`card:${a.id}`}>{a.name}</option>)}</optgroup>
              </select>
            </div>
          )}
          {aErr && <p className="text-sm font-semibold text-red-600">{aErr}</p>}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button type="button" onClick={() => fileStatement(false)} disabled={busy} className={btnBase} style={{ height: 44, padding: "0 18px", fontSize: 14, background: ORANGE, color: INK, border: `1px solid ${ORANGE}` }}>{busy ? "Working…" : "File statement"}</button>
            <button type="button" onClick={() => fileStatement(true)} disabled={busy} className={btnBase} style={{ height: 44, padding: "0 18px", fontSize: 14, background: "#fff", color: INK, border: "1px solid #CFC6AF" }}><Icon d={P.plus} size={16} />File &amp; add another</button>
            <button type="button" onClick={() => setAddOpen(false)} className="text-sm" style={{ color: "#4a4a4a", height: 44 }}>Cancel</button>
          </div>
        </>, true)}

      {/* ---------------- Mark paid ---------------- */}
      {payFor && payCalc && modal(
        <>
          <div className="flex items-center justify-between"><h2 className="m-0" style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 22 }}>{pEditing ? "Edit payment" : "Mark paid"}</h2>{closeX(() => setPayFor(null))}</div>
          <p className="text-sm" style={{ color: "#4a4a4a" }}><strong style={{ color: INK }}>{payFor.account_name}</strong>{payFor.invoice_number ? ` · Invoice #${payFor.invoice_number}` : ""} · billed <strong style={{ color: INK }}>{money(payFor.amount)}</strong>{payCalc.prior > 0 && ` · ${money(payCalc.prior)} already paid`}</p>
          <div className="flex gap-3">
            <div className="flex-1"><label htmlFor="pay-date" className={lbl}>Date paid</label><input id="pay-date" type="date" value={pDate} onChange={(e) => setPDate(e.target.value)} className={inputCls} style={inputBorder} /></div>
            <div className="flex-1">
              <label htmlFor="pay-how" className={lbl}>How was it paid?</label>
              <select id="pay-how" value={pMethod} onChange={(e) => { const m = e.target.value as typeof pMethod; setPMethod(m); if (m === "check" && pFrom.startsWith("bank:") && !pCheck) setPCheck(nextCheckFor(pFrom)); }} className={inputCls} style={inputBorder}>
                <option value="check">Check</option><option value="ach">ACH / bank transfer</option><option value="card">Credit card</option><option value="other">Cash / other</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="pay-from" className={lbl}>Paid from</label>
            <select id="pay-from" value={pFrom} onChange={(e) => { const v = e.target.value; setPFrom(v); if (pMethod === "check" && v.startsWith("bank:")) setPCheck(nextCheckFor(v)); }} className={inputCls} style={inputBorder}>
              <optgroup label="Bank accounts">{data.payAccounts.filter((a) => a.kind === "bank").map((a) => <option key={a.id} value={`bank:${a.id}`}>{a.name}</option>)}</optgroup>
              <optgroup label="Credit cards">{data.payAccounts.filter((a) => a.kind === "card").map((a) => <option key={a.id} value={`card:${a.id}`}>{a.name}</option>)}</optgroup>
              <option value="other">Other (cash, owner, etc.)</option>
            </select>
          </div>
          {pMethod === "check" && (
            <div>
              <label htmlFor="pay-chk" className={lbl}>Check number (required)</label>
              <input id="pay-chk" value={pCheck} onChange={(e) => setPCheck(e.target.value)} placeholder="e.g. 1043" className={inputCls} style={inputBorder} />
              <p className="text-xs mt-1" style={{ color: "#5f5f5f" }}>Goes into the check register as soon as you save. The next number after your last check on this account is filled in for you.</p>
            </div>
          )}
          {payCalc.credit > 0 && !pEditing && (
            <div className="flex items-start gap-2.5">
              <input id="pay-credit" type="checkbox" checked={pUseCredit} onChange={(e) => { setPUseCredit(e.target.checked); const d0 = Math.max(0, Number(payFor.amount ?? 0) - Number(payFor.credit_applied ?? 0) - payCalc.prior); setPAmount(Math.max(0, d0 - (e.target.checked ? Math.min(payCalc.credit, d0) : 0)).toFixed(2)); }} style={{ width: 20, height: 20, marginTop: 2, accentColor: DEEP }} />
              <label htmlFor="pay-credit" className="text-sm leading-snug">Apply the {money(payCalc.credit)} credit from an earlier overpayment<br /><span className="text-xs" style={{ color: "#5f5f5f" }}>The amount paid below is already reduced by it.</span></label>
            </div>
          )}
          <div>
            <label htmlFor="pay-amt" className={lbl}>Amount paid</label>
            <input id="pay-amt" inputMode="decimal" value={pAmount} onChange={(e) => setPAmount(e.target.value)} className={inputCls} style={{ ...inputBorder, textAlign: "right", fontWeight: 700, ...(payCalc.under || payCalc.over ? { borderColor: "#C98216", background: "#FFFBF2" } : {}) }} />
            <p className="text-xs mt-1" style={{ color: "#5f5f5f" }}>Starts as the amount due ({money(payCalc.due)}). Change it if you paid a different amount.</p>
          </div>
          {(payCalc.under || payCalc.over) && (
            <fieldset className="space-y-2">
              <legend className="text-xs font-bold mb-2" style={{ color: "#3d3d3d" }}>{payCalc.under ? `You paid ${money(-payCalc.delta)} less than billed. What should happen to the difference?` : `You paid ${money(payCalc.delta)} more than billed. What should happen to the extra?`}</legend>
              {(payCalc.under
                ? [["settled", "Settled. Nothing more is owed", `A credit or discount. The statement shows as paid, with a ${money(-payCalc.delta)} credit noted.`], ["partial", `Partial payment. Keep ${money(-payCalc.delta)} owed`, `The statement stays in the unpaid list with ${money(-payCalc.delta)} still due.`]]
                : [["credit", `Carry it as a credit with ${payFor.account_name}`, `Their next statement offers the ${money(payCalc.delta)} credit when you mark it paid.`], ["note", "Just note it on this row", `The statement shows as paid, with a ${money(payCalc.delta)} overpayment noted. Nothing carries forward.`]]
              ).map(([v, t, s]) => (
                <label key={v} className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 cursor-pointer" style={{ border: `1px solid ${payCalc.diff === v ? "#C98216" : "#E2D9C3"}`, background: payCalc.diff === v ? "#FFFBF2" : "#fff" }}>
                  <input type="radio" name="pay-diff" checked={payCalc.diff === v} onChange={() => setPDiff(v)} style={{ width: 20, height: 20, marginTop: 1, accentColor: DEEP }} />
                  <span className="text-sm leading-snug"><strong>{t}</strong><br /><span style={{ color: "#5f5f5f" }}>{s}</span></span>
                </label>
              ))}
            </fieldset>
          )}
          <div><label htmlFor="pay-note" className={lbl}>Note (optional)</label><input id="pay-note" value={pNote} onChange={(e) => setPNote(e.target.value)} className={inputCls} style={inputBorder} /></div>
          {pMethod === "check" && !isNaN(payCalc.pay) && <p className="text-sm rounded-lg px-3 py-2" style={{ background: BAND }}>The check on the register is written for <strong>{money(payCalc.pay)}</strong>, the amount paid.</p>}
          {pErr && <p className="text-sm font-semibold text-red-600">{pErr}</p>}
          <div className="flex items-center gap-3 pt-1">
            <button type="button" onClick={() => confirmPay()} disabled={busy} className={btnBase} style={{ height: 44, padding: "0 18px", fontSize: 14, background: ORANGE, color: INK, border: `1px solid ${ORANGE}` }}>{busy ? "Saving…" : pEditing ? "Save changes" : "Mark paid"}</button>
            <button type="button" onClick={() => setPayFor(null)} className="text-sm" style={{ color: "#4a4a4a", height: 44 }}>Cancel</button>
          </div>
        </>)}

      {/* ---------------- Edit invoice ---------------- */}
      {editInv && modal(
        <>
          <div className="flex items-center justify-between"><h2 className="m-0" style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 22 }}>Edit invoice</h2>{closeX(() => setEditInv(null))}</div>
          <p className="text-xs" style={{ color: "#5f5f5f" }}>The PDF stays as filed.{editInv.paid ? " If it was paid by check, that check on the register is updated too (unless it has already cleared)." : ""}</p>
          <div>
            <label htmlFor="ed-vendor" className={lbl}>Vendor</label>
            <select id="ed-vendor" value={eVendor} onChange={(e) => setEVendor(e.target.value)} className={inputCls} style={inputBorder}>
              {!data.sources.some((s) => s.id === eVendor) && <option value={eVendor}>{editInv.account_name}</option>}
              {data.sources.filter((s) => s.active || s.id === eVendor).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <div className="flex-1"><label htmlFor="ed-date" className={lbl}>Statement date</label><input id="ed-date" type="date" value={eDate} onChange={(e) => setEDate(e.target.value)} className={inputCls} style={inputBorder} /></div>
            <div className="flex-1"><label htmlFor="ed-due" className={lbl}>Due by</label><input id="ed-due" type="date" value={eDue} onChange={(e) => setEDue(e.target.value)} className={inputCls} style={inputBorder} /></div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1"><label htmlFor="ed-no" className={lbl}>Invoice #</label><input id="ed-no" value={eNumber} onChange={(e) => setENumber(e.target.value)} className={inputCls} style={inputBorder} /></div>
            <div className="flex-1"><label htmlFor="ed-amt" className={lbl}>Amount due</label><input id="ed-amt" inputMode="decimal" value={eAmount} onChange={(e) => setEAmount(e.target.value)} className={inputCls} style={{ ...inputBorder, textAlign: "right", fontWeight: 700 }} /></div>
          </div>
          <div>
            <label htmlFor="ed-cat" className={lbl}>Category</label>
            <select id="ed-cat" value={eCat} onChange={(e) => setECat(e.target.value)} className={inputCls} style={inputBorder}>
              {[...new Set([...allCats, ...(eCat ? [eCat] : [])])].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {eErr && <p className="text-sm font-semibold text-red-600">{eErr}</p>}
          <div className="flex items-center gap-3 pt-1">
            <button type="button" onClick={() => saveEdit()} disabled={busy} className={btnBase} style={{ height: 44, padding: "0 18px", fontSize: 14, background: ORANGE, color: INK, border: `1px solid ${ORANGE}` }}>{busy ? "Saving…" : "Save changes"}</button>
            <button type="button" onClick={() => setEditInv(null)} className="text-sm" style={{ color: "#4a4a4a", height: 44 }}>Cancel</button>
          </div>
        </>)}

      {/* ---------------- Merge vendors ---------------- */}
      {mergeDlg && (() => {
        const from = data.sources.find((x) => x.id === mergeDlg.fromId);
        const others = data.sources.filter((x) => x.id !== mergeDlg.fromId).sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" }));
        const into = data.sources.find((x) => x.id === mergeDlg.intoId);
        return modal(
          <>
            <div className="flex items-center justify-between"><h2 className="m-0" style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 22 }}>Merge vendors</h2>{closeX(() => setMergeDlg(null))}</div>
            <p className="text-sm" style={{ color: "#4a4a4a" }}>Everything filed under <strong style={{ color: INK }}>{from?.name}</strong> moves to the vendor you keep, and <strong style={{ color: INK }}>{from?.name}</strong> is removed from your list. Statements and PDFs aren’t deleted.</p>
            <div>
              <label htmlFor="merge-into" className={lbl}>Keep this vendor</label>
              <select id="merge-into" value={mergeDlg.intoId} onChange={(e) => setMergeDlg({ ...mergeDlg, intoId: e.target.value })} className={inputCls} style={inputBorder}>
                <option value="">Choose…</option>
                {others.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
            {into && from && <button type="button" onClick={() => setMergeDlg({ fromId: into.id, intoId: from.id })} className="text-xs underline font-semibold" style={{ color: DEEP }}>Keep {from.name} instead</button>}
            {mErr && <p className="text-sm font-semibold text-red-600">{mErr}</p>}
            <div className="flex items-center gap-3 pt-1">
              <button type="button" onClick={doMerge} disabled={busy} className={btnBase} style={{ height: 44, padding: "0 18px", fontSize: 14, background: ORANGE, color: INK, border: `1px solid ${ORANGE}` }}>{busy ? "Merging…" : "Merge"}</button>
              <button type="button" onClick={() => setMergeDlg(null)} className="text-sm" style={{ color: "#4a4a4a", height: 44 }}>Cancel</button>
            </div>
          </>);
      })()}

      {/* ---------------- Account statement ---------------- */}
      {acctDlg && modal(
        <>
          <div className="flex items-center justify-between"><h2 className="m-0" style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 22 }}>File statement</h2>{closeX(() => setAcctDlg(null))}</div>
          <p className="text-sm" style={{ color: "#4a4a4a" }}><strong style={{ color: INK }}>{acctDlg.name}</strong> · {mlabel(month)}</p>
          {fileBox(sFile, setSFile, "acct-file")}
          <div>
            <label htmlFor="acct-amt" className={lbl}>Statement balance (required)</label>
            <input id="acct-amt" inputMode="decimal" value={sAmount} onChange={(e) => setSAmount(e.target.value)} placeholder="Ending balance" className={inputCls} style={{ ...inputBorder, textAlign: "right", fontWeight: 700 }} />
            <p className="text-xs mt-1" style={{ color: "#5f5f5f" }}>It’s saved as this month’s statement balance in Cash Flow, so it’s only entered once.</p>
          </div>
          {sErr && <p className="text-sm font-semibold text-red-600">{sErr}</p>}
          <div className="flex items-center gap-3 pt-1">
            <button type="button" onClick={() => fileAcct()} disabled={busy} className={btnBase} style={{ height: 44, padding: "0 18px", fontSize: 14, background: ORANGE, color: INK, border: `1px solid ${ORANGE}` }}>{busy ? "Working…" : "File statement"}</button>
            <button type="button" onClick={() => setAcctDlg(null)} className="text-sm" style={{ color: "#4a4a4a", height: 44 }}>Cancel</button>
          </div>
        </>)}
    </div>
  );
}
