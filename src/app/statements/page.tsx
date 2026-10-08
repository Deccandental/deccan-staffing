"use client";

import { Fragment, useState, useEffect, useCallback } from "react";
import type { DragEvent } from "react";
import { Sidebar } from "@/components/Sidebar";
import StatementsMonth from "@/components/StatementsMonth";
import { supabase } from "@/lib/supabase";
import { loadStaff } from "@/lib/staffStore";
import { getSessionToken, storeSessionToken, clearSessionToken, hasSessionToken } from "@/lib/secureData";
import { loadRecurringBills, loadBillPayments, buildOccurrences, addDays, RecurringBill, BillPayment } from "@/lib/cashflow";

/**
 * Monthly statements: a checklist of every account, card and loan against every month, with the PDF
 * filed right where it's ticked off. Finance users upload and mark; the CPA (own passcode) can only
 * view and download. Files live in a private bucket and are only ever reached through short-lived links.
 */

type Role = "finance" | "cpa";
interface Account { kind: "bank" | "card" | "loan" | "vendor"; id: string; name: string; category?: string; startMonth?: string; active?: boolean }
interface CheckRow { category?: string; id: string; check_number: string; account_id: string | null; account_name: string; check_date: string; payee: string; amount: number | null; memo: string; invoice_id: string | null; status: "outstanding" | "cleared" | "void"; cleared_date: string | null; created_by: string }
interface CheckDoc { id: string; check_id: string; file_name: string; size_bytes: number | null; doc_kind: string; note: string; uploaded_by: string; uploaded_at: string }
interface CheckInvoice { id: string; account_name: string; invoice_number: string; amount: number | null; paid_check_number: string; paid_from_id: string | null }
interface FileRow { paid_from_kind?: string | null; paid_from_id?: string | null; paid_method?: string | null; paid_check_number?: string; paid_from_name?: string; paid_note?: string; category?: string; paid?: boolean; paid_date?: string | null; matched_bill_id?: string | null; matched_due_date?: string | null; dup_ignored?: boolean; doc_type?: string; invoice_date?: string | null; invoice_number?: string; amount?: number | null; id: string; account_kind: string; account_id: string; account_name: string; month: string; file_name: string | null; size_bytes: number | null; no_statement: boolean; note: string; uploaded_by: string; uploaded_at: string }

const ROLE_KEY = "dd_statements_role";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KIND_LABEL: Record<string, string> = { bank: "Bank accounts", card: "Credit cards", loan: "Loans" };
const DEFAULT_CATEGORIES = ["CAM", "Rent", "Supplies", "Lab", "Utilities", "Insurance", "Equipment & repairs", "Marketing", "Professional fees", "Other"];
// A vendor's type suggests a starting category for its invoices.
const VENDOR_TYPE_CATEGORY: Record<string, string> = { Lab: "Lab", Supplier: "Supplies", Insurance: "Insurance" };
const CHECK_TYPES = ["Vendor invoice", "Patient refund", "Payroll", "Rent / lease", "Tax / government", "Insurance", "Other"];
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
  const [cfBalances, setCfBalances] = useState<Record<string, number>>({});
  // Invoice matching: scheduled bills to compare against, the match chosen, and the unpaid-only filter
  const [bills, setBills] = useState<RecurringBill[]>([]);
  const [billPayments, setBillPayments] = useState<BillPayment[]>([]);
  const [iMatch, setIMatch] = useState<{ billId: string; dueDate: string; billName: string; amount: number } | null>(null);
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [iCategory, setICategory] = useState("");
  // Drag-and-drop: the file waiting in each form, and which area is being dragged over
  const [iFile, setIFile] = useState<File | null>(null);
  const [sFile, setSFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // "Mark paid" dialog: the invoice, the date, the account it was paid from, and a note
  const [payFor, setPayFor] = useState<FileRow | null>(null);
  const [payDate, setPayDate] = useState("");
  const [payFrom, setPayFrom] = useState("");
  const [payNote, setPayNote] = useState("");
  // Month-end package for the CPA
  const [pkgMonth, setPkgMonth] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const [pkgPreview, setPkgPreview] = useState<any>(null);
  const [pkgList, setPkgList] = useState<any[]>([]);
  const [cpaEmail, setCpaEmail] = useState("");
  const [pkgBusy, setPkgBusy] = useState("");
  const [pkgMsg, setPkgMsg] = useState("");
  const [payMethod, setPayMethod] = useState<"check" | "ach" | "card" | "other">("check");
  const [payCheckNo, setPayCheckNo] = useState("");
  const [payEditing, setPayEditing] = useState(false);
  // Edit an invoice itself (vendor, date, number, amount)
  const [editInv, setEditInv] = useState<FileRow | null>(null);
  const [eVendor, setEVendor] = useState("");
  const [eDate, setEDate] = useState("");
  const [eNumber, setENumber] = useState("");
  const [eAmount, setEAmount] = useState("");
  const [eError, setEError] = useState("");
  // Check register
  const [checks, setChecks] = useState<CheckRow[]>([]);
  const [chkAccount, setChkAccount] = useState("");
  const [chkStatus, setChkStatus] = useState("");
  const [chkSearch, setChkSearch] = useState("");
  const [chkAdding, setChkAdding] = useState(false);
  const [cNumber, setCNumber] = useState("");
  const [cDate, setCDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cAccount, setCAccount] = useState("");
  const [cPayee, setCPayee] = useState("");
  const [cAmount, setCAmount] = useState("");
  const [cMemo, setCMemo] = useState("");
  const [cType, setCType] = useState("Patient refund");
  const [cEditId, setCEditId] = useState<string | null>(null);   // a hand-entered check being edited
  const [chkType, setChkType] = useState("");
  const [checkDocs, setCheckDocs] = useState<CheckDoc[]>([]);
  const [checkInvoices, setCheckInvoices] = useState<CheckInvoice[]>([]);
  const [openCheck, setOpenCheck] = useState<string | null>(null);   // the check whose files panel is open
  const [attKind, setAttKind] = useState("invoice");
  const [attNote, setAttNote] = useState("");
  const [linkInvId, setLinkInvId] = useState("");
  const [staffNames, setStaffNames] = useState<string[]>([]);
  const [cPayeeOther, setCPayeeOther] = useState(false);
  const [pending, setPending] = useState<FileRow[]>([]);   // every unpaid invoice, across all months
  // Vendor directory
  const [vendorsAll, setVendorsAll] = useState<{ id: string; name: string; category: string; active: boolean; expectsStatement: boolean }[]>([]);
  const [usedNames, setUsedNames] = useState<string[]>([]);
  const [showVendors, setShowVendors] = useState(false);
  const [nvName, setNvName] = useState("");        // a new vendor being added from the invoice form
  const [nvType, setNvType] = useState("Other");
  const [vExpects, setVExpects] = useState(true); // new vendor on the Monthly statements tab: sends a statement?
  const [usedCategories, setUsedCategories] = useState<string[]>([]);
  const [catFilter, setCatFilter] = useState("");
  // A possible duplicate found before filing: the person can file it anyway or cancel.
  const [dup, setDup] = useState<{ matches: (FileRow & { reason?: string })[]; note?: string; proceed: () => void } | null>(null);
  // Invoices (a separate list from the monthly statements)
  const [tab, setTab] = useState<"statements" | "invoices" | "checks" | "package">("statements");
  const [invMonth, setInvMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [invFiles, setInvFiles] = useState<FileRow[]>([]);
  const [invVendors, setInvVendors] = useState<{ id: string; name: string; category: string }[]>([]);
  const [invSearch, setInvSearch] = useState("");
  const [invAdding, setInvAdding] = useState(true);
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
      else if (hasSessionToken()) {
        // Already signed in elsewhere in the app (the Payroll or Cash Flow login, or the app-wide login)? Then
        // don't ask again. This only picks which screen to show: the server still checks the same login on every
        // request, and anyone without access is sent back to the login box.
        const payrollUnlock = sessionStorage.getItem("dd_payroll_unlocked");
        let identityOk = false;
        try { const id = JSON.parse(sessionStorage.getItem("dd_identity") ?? "null"); identityOk = !!id && (id.mode === "super" || id.canManagePayroll === true); } catch {}
        if (payrollUnlock === "super" || payrollUnlock === "staff" || identityOk) { sessionStorage.setItem(ROLE_KEY, "finance"); setRole("finance"); }
      }
    } catch {}
    setChecked(true);
  }, []);

  function droppedPdf(e: DragEvent<HTMLElement>): File | null {
    e.preventDefault(); setDragOver(null);
    const f = e.dataTransfer.files?.[0];
    if (!f) return null;
    if (!/\.pdf$/i.test(f.name)) { setMsg("Only PDF files can be dropped here."); return null; }
    return f;
  }
  const dropProps = (zone: string, onFile: (f: File) => void) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => { e.preventDefault(); setDragOver(zone); },
    onDragLeave: (e: DragEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(null); },
    onDrop: (e: DragEvent<HTMLElement>) => { const f = droppedPdf(e); if (f) onFile(f); },
  });
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    window.addEventListener("dragover", stop); window.addEventListener("drop", stop);
    return () => { window.removeEventListener("dragover", stop); window.removeEventListener("drop", stop); };
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
    setAccounts(r.json.accounts ?? []); setFiles(r.json.files ?? []); setCfBalances(r.json.cfBalances ?? {});
  }, [role, year]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  // Picking a month fills in the statement balance Cash Flow already holds for it, if there is one.
  useEffect(() => {
    setDup(null);
    const a = sel ? accounts.find((x) => acctKey(x.kind, x.id) === sel.key) : null;
    const v = a && sel ? cfBalances[`${a.kind}:${a.id}:${sel.month}`] : undefined;
    setSAmount(v != null ? String(v) : ""); setSFile(null);
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  // Choosing a vendor suggests a category from its type (a lab -> Lab); it can still be changed.
  useEffect(() => {
    const v = invVendors.find((x) => x.id === iVendor);
    if (v && VENDOR_TYPE_CATEGORY[v.category]) setICategory(VENDOR_TYPE_CATEGORY[v.category]);
  }, [iVendor, invVendors]);
  // Scheduled bills, for matching invoices to what is already expected (finance only).
  useEffect(() => {
    if (role !== "finance" || !invAdding || tab !== "invoices") return;
    const t = new Date(); const from = addDays(t.toISOString().slice(0, 10), -75); const to = addDays(t.toISOString().slice(0, 10), 150);
    loadRecurringBills().then(setBills); loadBillPayments(from, to).then(setBillPayments);
  }, [role, invAdding, tab]);

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
    if (sAmount.trim() === "" || isNaN(Number(sAmount))) { setMsg("Enter the statement amount first."); return; }
    setBusy(true);
    if (!ignoreDup) {
      const chk = await api("/api/statements/manage", { action: "checkDuplicate", docType: "statement", accountKind: a.kind, accountId: a.id, accountName: a.name, month, amount: sAmount });
      const cf: number | null | undefined = chk.json.cfBalance;
      const cfDiffers = cf != null && Math.abs(cf - Number(sAmount)) > 0.004;
      if (chk.ok && ((chk.json.matches ?? []).length > 0 || cfDiffers)) {
        setBusy(false);
        setDup({ matches: chk.json.matches ?? [], note: cfDiffers ? `Cash Flow already has $${Number(cf).toLocaleString("en-US", { minimumFractionDigits: 2 })} as this month's statement balance. Filing this will replace it with $${Number(sAmount).toLocaleString("en-US", { minimumFractionDigits: 2 })}.` : undefined, proceed: () => upload(a, month, file, true) });
        return;
      }
    }
    const slot = await api("/api/statements/upload-url", { accountKind: a.kind, accountName: a.name, month, fileName: file.name, size: file.size });
    if (!slot.ok) { setBusy(false); setMsg(slot.json.error ?? "Couldn't start the upload."); return; }
    const up = await supabase.storage.from("statements").uploadToSignedUrl(slot.json.path, slot.json.token, file, { contentType: "application/pdf" });
    if (up.error) { setBusy(false); setMsg(`Upload failed: ${up.error.message}`); return; }
    const rec = await api("/api/statements/manage", { action: "confirm", path: slot.json.path, accountKind: a.kind, accountId: a.id, accountName: a.name, month, fileName: file.name, size: file.size, amount: sAmount, dupIgnored: ignoreDup });
    setBusy(false);
    if (!rec.ok) { setMsg(rec.json.error ?? "Couldn't record the upload."); return; }
    setSAmount(""); setSFile(null); setMsg(`Filed ${file.name}.${rec.json.synced ? " Saved as this month's statement balance in Cash Flow." : ""}`); load();
  }

  async function markNone(a: Account, month: string) {
    const note = window.prompt("Why is there no statement? (optional, e.g. account had no activity)") ?? "";
    setBusy(true);
    const r = await api("/api/statements/manage", { action: "markNone", accountKind: a.kind, accountId: a.id, accountName: a.name, month, note });
    setBusy(false);
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't save."); return; }
    load();
  }

  const loadPackageTab = useCallback(async () => {
    if (role !== "finance") return;
    const [pre, list, set] = await Promise.all([
      api("/api/statements/package", { action: "preview", month: pkgMonth }),
      api("/api/statements/package", { action: "list" }),
      api("/api/statements/package", { action: "settings" }),
    ]);
    if (pre.ok) setPkgPreview(pre.json); else setPkgPreview(null);
    if (list.ok) setPkgList(list.json.packages ?? []); else if (!list.ok && list.json.error) setPkgMsg(list.json.error);
    if (set.ok) setCpaEmail(set.json.cpaEmail ?? "");
  }, [role, pkgMonth]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === "package") loadPackageTab(); }, [tab, loadPackageTab]);

  async function saveCpaEmail() {
    const r = await api("/api/statements/package", { action: "setCpaEmail", email: cpaEmail });
    setPkgMsg(r.ok ? "CPA email saved." : (r.json.error ?? "Couldn't save."));
  }
  async function createPackage() {
    setPkgBusy("create"); setPkgMsg("Building the package. A busy month can take up to a minute…");
    const r = await api("/api/statements/package", { action: "create", month: pkgMonth });
    setPkgBusy("");
    if (!r.ok) { setPkgMsg(r.json.error ?? "Couldn't build the package."); return; }
    setPkgMsg(`Package ready: ${r.json.package?.stats ?? ""}.${(r.json.missingFiles ?? []).length ? ` ${(r.json.missingFiles ?? []).length} file(s) couldn't be read and are listed in Missing-files.txt.` : ""}`);
    loadPackageTab();
  }
  async function downloadPackage(id: string) {
    setPkgBusy(`dl:${id}`);
    const r = await api("/api/statements/package", { action: "download", id });
    setPkgBusy("");
    if (!r.ok) { setPkgMsg(r.json.error ?? "Couldn't create the download link."); return; }
    const a = document.createElement("a"); a.href = r.json.url; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
  }
  async function emailPackage(pk: any) {
    if (!cpaEmail.trim()) { setPkgMsg("Save the CPA's email address first."); return; }
    if (!window.confirm(`Email a download link for ${pk.month} to ${cpaEmail.trim()}? The link works for 7 days.`)) return;
    setPkgBusy(`em:${pk.id}`);
    const r = await api("/api/statements/package", { action: "email", id: pk.id, to: cpaEmail.trim() });
    setPkgBusy("");
    if (!r.ok) { setPkgMsg(r.json.error ?? "The email couldn't be sent."); return; }
    setPkgMsg(`Link emailed to ${r.json.to}. It works until ${r.json.expires}.`); loadPackageTab();
  }
  async function deletePackage(pk: any) {
    if (!window.confirm(`Delete the ${pk.month} package? Any link already emailed will stop working.`)) return;
    const r = await api("/api/statements/package", { action: "delete", id: pk.id });
    if (!r.ok) { setPkgMsg(r.json.error ?? "Couldn't delete."); return; }
    loadPackageTab();
  }

  const loadChecks = useCallback(async () => {
    if (!role) return;
    const r = await api("/api/statements/checks", { action: "list" });
    if (r.status === 401) { logout(); return; }
    if (!r.ok) { setLoadError(r.json.error ?? "Couldn't load the check register."); return; }
    setChecks(r.json.checks ?? []); setCheckDocs(r.json.docs ?? []); setCheckInvoices(r.json.invoices ?? []);
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadChecks(); }, [loadChecks]);

  useEffect(() => {
    if (role !== "finance" || tab !== "checks") return;
    loadStaff().then((list) => setStaffNames(list.filter((e) => !e.archived).map((e) => e.name).sort())).catch(() => {});
  }, [role, tab]);

  const loadPending = useCallback(async () => {
    if (role !== "finance") return;
    const r = await api("/api/statements/list", { docType: "invoice", unpaid: true });
    if (r.ok) setPending((r.json.files ?? []).filter((f: FileRow) => !f.paid));
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadPending(); }, [loadPending]);

  const loadInvoices = useCallback(async () => {
    if (!role) return;
    setLoading(true); setLoadError("");
    const r = await api("/api/statements/list", { docType: "invoice", month: invMonth, unpaid: unpaidOnly });
    setLoading(false);
    if (r.status === 401) { logout(); return; }
    if (!r.ok) { setLoadError(r.json.error ?? "Couldn't load invoices."); return; }
    setInvFiles(r.json.files ?? []); setInvVendors(r.json.vendors ?? []); setUsedCategories(r.json.categories ?? []); setVendorsAll(r.json.vendorsAll ?? []); setUsedNames(r.json.usedNames ?? []);
  }, [role, invMonth, unpaidOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === "invoices") loadInvoices(); }, [tab, loadInvoices]);
  // Anything that changes an invoice also refreshes the warning.
  useEffect(() => { if (role === "finance") loadPending(); }, [invFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // A vendor added here only sends invoices, so it never appears on the monthly statement checklist.
  async function createVendor(): Promise<{ id: string; name: string; category: string } | null> {
    const name = nvName.trim();
    if (!name) { setMsg("Enter the vendor's name."); return null; }
    const existing = invVendors.find((v) => v.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) { setIVendor(existing.id); setNvName(""); return existing; }
    const r = await api("/api/statements/manage", { action: "addSource", name, category: nvType, startMonth: new Date().toISOString().slice(0, 7), expectsStatement: false });
    if (!r.ok || !r.json.data?.id) { setMsg(r.json.error ?? "Couldn't add the vendor."); return null; }
    const made = { id: String(r.json.data.id), name, category: nvType };
    setInvVendors((v) => [...v, made]);
    setIVendor(made.id); setNvName("");
    return made;
  }
  async function addVendorHere() {
    setBusy(true); setMsg("");
    const v = await createVendor();
    setBusy(false);
    if (v) { setMsg(`${v.name} is saved and selected.`); loadInvoices(); }
  }

  async function addInvoice(file: File, ignoreDup = false) {
    setMsg(""); setDup(null);
    let vendor = invVendors.find((v) => v.id === iVendor);
    // A new vendor name typed in but not yet added is added now, so filing the invoice never silently fails.
    if (!vendor && iVendor === "__new" && nvName.trim()) {
      setBusy(true);
      const made = await createVendor();
      setBusy(false);
      if (!made) return;
      vendor = made;
    }
    if (!vendor) { setMsg("Choose a vendor, or add a new one."); return; }
    const name = vendor.name;
    if (!iDate) { setMsg("Enter the invoice date."); return; }
    if (!iNumber.trim()) { setMsg("Enter the invoice number."); return; }
    if (iAmount.trim() === "" || isNaN(Number(iAmount))) { setMsg("Enter the invoice amount."); return; }
    if (!/\.pdf$/i.test(file.name)) { setMsg("Only PDF files can be uploaded."); return; }
    setBusy(true);
    const kind = "vendor";
    if (!ignoreDup) {
      const chk = await api("/api/statements/manage", { action: "checkDuplicate", docType: "invoice", accountKind: kind, accountId: vendor.id, accountName: name, invoiceDate: iDate, invoiceNumber: iNumber, amount: iAmount });
      if (chk.ok && (chk.json.matches ?? []).length > 0) { setBusy(false); setDup({ matches: chk.json.matches, proceed: () => addInvoice(file, true) }); return; }
    }
    const slot = await api("/api/statements/upload-url", { docType: "invoice", accountKind: kind, accountName: name, month: iDate.slice(0, 7), fileName: file.name, size: file.size });
    if (!slot.ok) { setBusy(false); setMsg(slot.json.error ?? "Couldn't start the upload."); return; }
    const up = await supabase.storage.from("statements").uploadToSignedUrl(slot.json.path, slot.json.token, file, { contentType: "application/pdf" });
    if (up.error) { setBusy(false); setMsg(`Upload failed: ${up.error.message}`); return; }
    const rec = await api("/api/statements/manage", { action: "confirm", docType: "invoice", path: slot.json.path, accountKind: kind, accountId: vendor?.id ?? "", accountName: name, invoiceDate: iDate, invoiceNumber: iNumber, amount: iAmount, fileName: file.name, size: file.size, dupIgnored: ignoreDup, matchedBillId: iMatch?.billId, matchedDueDate: iMatch?.dueDate, category: iCategory });
    setBusy(false);
    if (!rec.ok) { setMsg(rec.json.error ?? "Couldn't record the invoice."); return; }
    setMsg(`Filed invoice ${iNumber.trim()} from ${name}.`);
    const filedMonth = iDate.slice(0, 7);
    // Clear the whole form so the next invoice starts fresh.
    setIVendor(""); setIDate(new Date().toISOString().slice(0, 10)); setINumber(""); setIAmount(""); setICategory(""); setIMatch(null); setNvName(""); setIFile(null);
    if (!unpaidOnly && filedMonth !== invMonth) setInvMonth(filedMonth); else loadInvoices();
  }

  // Marking paid opens a small dialog (date, which account, note). Undo needs no questions.
  function openPay(f: FileRow) {
    const first = accounts.find((a) => a.kind === "bank");
    const from = payFrom || (first ? `bank:${first.id}` : "other");
    setPayEditing(false);
    setPayFor(f); setPayDate(new Date().toISOString().slice(0, 10)); setPayNote(""); setPayFrom(from);
    setPayMethod(payFrom.startsWith("card:") ? "card" : "check");
    setPayCheckNo(from.startsWith("bank:") ? nextCheckFor(from.slice(5)) : "");
  }
  // Changing a payment that's already marked paid: the same box, filled in with what was recorded.
  function openEditPay(f: FileRow) {
    setPayEditing(true); setPayFor(f);
    setPayDate(f.paid_date ?? new Date().toISOString().slice(0, 10));
    setPayFrom(f.paid_from_kind && f.paid_from_kind !== "other" && f.paid_from_id ? `${f.paid_from_kind}:${f.paid_from_id}` : "other");
    setPayMethod((f.paid_method as typeof payMethod) ?? (f.paid_from_kind === "card" ? "card" : "other"));
    setPayCheckNo(f.paid_check_number ?? ""); setPayNote(f.paid_note ?? "");
  }
  async function confirmPay(allowDuplicateCheck = false) {
    if (!payFor) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) { setMsg("Enter the date paid."); return; }
    const acct = accounts.find((a) => `${a.kind}:${a.id}` === payFrom);
    if (payMethod === "check") {
      if (!payCheckNo.trim()) { setMsg("Enter the check number."); return; }
      if (!acct || acct.kind !== "bank") { setMsg("Choose the bank account the check is drawn on."); return; }
    }
    setBusy(true);
    const r = await api("/api/statements/manage", {
      action: "markInvoicePaid", id: payFor.id, paid: true, paidDate: payDate, method: payMethod, checkNumber: payCheckNo, allowDuplicateCheck,
      paidFromKind: acct ? acct.kind : "other", paidFromId: acct?.id ?? "", paidFromName: acct ? acct.name : "Other", paidNote: payNote,
    });
    setBusy(false);
    if (r.status === 409 && r.json.duplicate) {
      const d = r.json.duplicate;
      if (window.confirm(`Check #${payCheckNo.trim()} on ${acct?.name ?? "this account"} is already on the register (${d.payee || "no payee"}, ${money(d.amount)}, ${d.check_date}). Use this number anyway?`)) confirmPay(true);
      return;
    }
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't update."); return; }
    setPayFor(null); loadInvoices(); loadChecks();
  }
  async function undoPaid(f: FileRow) {
    setBusy(true);
    const r = await api("/api/statements/manage", { action: "markInvoicePaid", id: f.id, paid: false });
    setBusy(false);
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't update."); return; }
    loadInvoices(); loadChecks();
  }

  function openEditInvoice(f: FileRow) {
    setEError("");
    setEVendor(f.account_id); setEDate(f.invoice_date ?? ""); setENumber(f.invoice_number ?? ""); setEAmount(f.amount != null ? String(f.amount) : "");
    setEditInv(f);
  }
  async function saveEditInvoice(ignoreDup = false) {
    if (!editInv) return;
    if (!eDate) { setEError("Enter the invoice date."); return; }
    if (!eNumber.trim()) { setEError("Enter the invoice number."); return; }
    if (eAmount.trim() === "" || isNaN(Number(eAmount))) { setEError("Enter the invoice amount."); return; }
    setBusy(true); setEError("");
    const r = await api("/api/statements/manage", { action: "editInvoice", id: editInv.id, accountId: eVendor, invoiceDate: eDate, invoiceNumber: eNumber, amount: eAmount, ignoreDup });
    setBusy(false);
    if (r.status === 409 && r.json.error === "duplicate") {
      const m = (r.json.matches ?? [])[0];
      if (window.confirm(`This looks like a duplicate of ${m?.account_name ?? "another invoice"} #${m?.invoice_number || "(no number)"} (${m?.reason ?? "same details"}). Save it anyway?`)) saveEditInvoice(true);
      return;
    }
    if (!r.ok) { setEError(r.json.error ?? "Couldn't save the changes."); return; }
    const newMonth = eDate.slice(0, 7);
    setEditInv(null);
    setMsg(`Invoice ${eNumber.trim()} updated.`);
    // If the date moved it into another month, show that month so it doesn't seem to vanish.
    if (!unpaidOnly && newMonth !== invMonth) setInvMonth(newMonth); else loadInvoices();
    loadPending(); loadChecks();
  }

  async function newCategory(): Promise<string> {
    const c = (window.prompt("New category name:") ?? "").trim().slice(0, 40);
    if (c) setUsedCategories((u) => (u.includes(c) ? u : [...u, c]));
    return c;
  }
  async function changeCategory(f: FileRow, value: string) {
    let category = value;
    if (value === "__new") { category = await newCategory(); if (!category) return; }
    setInvFiles((list) => list.map((x) => (x.id === f.id ? { ...x, category } : x)));
    const r = await api("/api/statements/manage", { action: "setInvoiceCategory", id: f.id, category });
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't save the category."); loadInvoices(); }
  }

  async function updateVendor(id: string, patch: Record<string, unknown>) {
    const r = await api("/api/statements/manage", { action: "updateSource", id, ...patch });
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't update the vendor."); return; }
    loadInvoices();
  }
  async function mergeVendor(from: { id: string; name: string }, intoId: string) {
    const into = vendorsAll.find((v) => v.id === intoId);
    if (!into) return;
    if (!window.confirm(`Merge "${from.name}" into "${into.name}"?\n\nEvery invoice and statement filed under "${from.name}" moves to "${into.name}", and "${from.name}" is removed from your list. This can't be undone.`)) return;
    setBusy(true);
    const r = await api("/api/statements/manage", { action: "mergeSource", fromId: from.id, intoId });
    setBusy(false);
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't merge."); return; }
    setMsg(`Merged "${r.json.from}" into "${r.json.into}" (${r.json.moved} item${r.json.moved === 1 ? "" : "s"} moved).`);
    loadInvoices(); loadPending(); load();
  }
  async function renameDirVendor(v: { id: string; name: string }) {
    const name = window.prompt("Rename:", v.name);
    if (name && name.trim() && name.trim() !== v.name) updateVendor(v.id, { name });
  }
  async function unlinkInvoice(f: FileRow) {
    const r = await api("/api/statements/manage", { action: "matchInvoice", id: f.id, billId: null });
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't update."); return; }
    loadInvoices();
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
    const r = await api("/api/statements/manage", { action: "addSource", name: vName, category: vCategory, startMonth: vStart, expectsStatement: vExpects });
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

  const categoryOptions = [...new Set([...DEFAULT_CATEGORIES, ...usedCategories])];
  const money = (n: number | null | undefined) => (n == null ? "no amount" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const dupBanner = dup && (
    <div className="rounded-xl px-4 py-3 text-sm space-y-1" style={{ background: "#FAEEDA", color: "#854F0B", border: "1px solid #f2d3a0" }}>
      <p className="font-semibold">⚠️ {dup.matches.length > 0 ? "Possible duplicate" : "Please check"}</p>
      {dup.note && <p>{dup.note}</p>}
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

  const STOP = new Set(["the", "inc", "llc", "corp", "company", "payment", "bill", "and", "for", "dental"]);
  const toks = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 3 && !STOP.has(x));
  const invVendorName = (invVendors.find((v) => v.id === iVendor)?.name ?? "").trim();
  const suggestions = (() => {
    if (!invAdding || !invVendorName || !iDate || bills.length === 0) return [];
    const vt = toks(invVendorName); if (vt.length === 0) return [];
    const amt = Number(iAmount); const target = new Date(iDate + "T00:00:00").getTime();
    const out: { bill: RecurringBill; dueDate: string; overlap: number; diff: number | null }[] = [];
    for (const b of bills) {
      if (!b.active || b.direction !== "outflow" || b.linkedCreditCardId || b.linkedDebtId) continue;
      const bt = toks(b.name); const overlap = vt.filter((t) => bt.includes(t)).length; if (!overlap) continue;
      const occ = buildOccurrences([b], billPayments, addDays(iDate, -25), addDays(iDate, 45)).filter((o) => !o.isPaid)
        .sort((x, y) => Math.abs(new Date(x.dueDate + "T00:00:00").getTime() - target) - Math.abs(new Date(y.dueDate + "T00:00:00").getTime() - target))[0];
      if (!occ) continue;
      out.push({ bill: b, dueDate: occ.dueDate, overlap, diff: amt > 0 && b.estimatedAmount > 0 ? Math.abs(amt - b.estimatedAmount) / b.estimatedAmount : null });
    }
    return out.sort((a, z) => z.overlap - a.overlap || (a.diff ?? 9) - (z.diff ?? 9)).slice(0, 3);
  })();

  const pendingCutoff = addDays(new Date().toISOString().slice(0, 10), -30);
  const pendingOld = pending.filter((f) => f.invoice_date && f.invoice_date < pendingCutoff).sort((a, z) => String(a.invoice_date).localeCompare(String(z.invoice_date)));
  const pendingTotal = pending.reduce((n, f) => n + (f.amount ?? 0), 0);
  const pendingBanner = finance && pending.length > 0 && (
    <div className="rounded-xl px-4 py-3 text-sm flex flex-wrap items-center gap-x-4 gap-y-1"
      style={{ background: pendingOld.length > 0 ? "#fee2e2" : "#FAEEDA", color: pendingOld.length > 0 ? "#991b1b" : "#854F0B", border: `1px solid ${pendingOld.length > 0 ? "#fca5a5" : "#f2d3a0"}` }}>
      <span>
        <strong>⚠️ {pending.length} unpaid invoice{pending.length === 1 ? "" : "s"}</strong> totalling {money(pendingTotal)}
        {pendingOld.length > 0 && <> — <strong>{pendingOld.length} more than 30 days old</strong> (oldest: {pendingOld[0].account_name}, {pendingOld[0].invoice_date ? new Date(pendingOld[0].invoice_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""})</>}
        . They count in Need to collect until you mark them paid.
      </span>
      <button onClick={() => setTab("statements")} className="underline font-semibold">Review unpaid</button>
    </div>
  );

  async function addCheck(allowDuplicate = false) {
    const acct = accounts.find((a) => a.kind === "bank" && a.id === cAccount);
    if (!cNumber.trim() || !cDate) { setMsg("Enter the check number and date."); return; }
    setBusy(true); setMsg("");
    const r = await api("/api/statements/checks", { action: cEditId ? "update" : "add", id: cEditId, checkNumber: cNumber, checkDate: cDate, accountId: acct?.id ?? "", accountName: acct?.name ?? "", payee: cPayee, amount: cAmount, memo: cMemo, category: cType, allowDuplicate });
    setBusy(false);
    if (r.status === 409 && r.json.duplicate) {
      const d = r.json.duplicate;
      if (window.confirm(`Check #${cNumber.trim()} on ${acct?.name ?? "this account"} is already on the register (${d.payee || "no payee"}, ${d.check_date}). Use this number anyway?`)) addCheck(true);
      return;
    }
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't save the check."); return; }
    const wasEditing = !!cEditId;
    setCEditId(null);
    setCNumber(!wasEditing && /^\d+$/.test(cNumber.trim()) ? String(Number(cNumber.trim()) + 1) : ""); setCPayee(""); setCAmount(""); setCMemo("");
    setMsg(wasEditing ? "Check updated." : `Check #${r.json.data?.check_number ?? ""} added.`); loadChecks();
  }
  function startEditCheck(c: CheckRow) {
    setCEditId(c.id); setChkAdding(true); setMsg("");
    setCAccount(c.account_id ?? ""); setCNumber(c.check_number); setCDate(c.check_date); setCPayee(c.payee); setCAmount(c.amount != null ? String(c.amount) : "");
    setCMemo(c.memo); setCType(c.category || "Other");
  }
  async function attachToCheck(c: CheckRow, file: File) {
    setMsg("");
    if (!/\.pdf$/i.test(file.name)) { setMsg("Only PDF files can be attached."); return; }
    setBusy(true);
    const slot = await api("/api/statements/upload-url", { docType: "check", checkId: c.id, fileName: file.name, size: file.size });
    if (!slot.ok) { setBusy(false); setMsg(slot.json.error ?? "Couldn't start the upload."); return; }
    const up = await supabase.storage.from("statements").uploadToSignedUrl(slot.json.path, slot.json.token, file, { contentType: "application/pdf" });
    if (up.error) { setBusy(false); setMsg(`Upload failed: ${up.error.message}`); return; }
    const rec = await api("/api/statements/checks", { action: "attachDoc", checkId: c.id, path: slot.json.path, fileName: file.name, size: file.size, kind: attKind, note: attNote });
    setBusy(false);
    if (!rec.ok) { setMsg(rec.json.error ?? "Couldn't attach the file."); return; }
    setAttNote(""); setMsg(`Attached ${file.name} to check #${c.check_number}.`); loadChecks();
  }
  async function removeCheckDoc(d: CheckDoc) {
    if (!window.confirm(`Remove ${d.file_name} from this check? This can't be undone.`)) return;
    const r = await api("/api/statements/checks", { action: "removeDoc", id: d.id });
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't remove."); return; }
    loadChecks();
  }
  async function downloadCheckDoc(d: CheckDoc) {
    const r = await api("/api/statements/download-url", { id: d.id, source: "check" });
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't create the download link."); return; }
    const a = document.createElement("a"); a.href = r.json.url; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
  }
  async function linkInvoiceToCheck(c: CheckRow) {
    if (!linkInvId) { setMsg("Choose an invoice to link."); return; }
    const inv = pending.find((x) => x.id === linkInvId);
    if (inv && c.amount != null && inv.amount != null && Math.abs(Number(inv.amount) - Number(c.amount)) > 0.004
        && !window.confirm(`The invoice is ${money(inv.amount)} but the check is ${money(c.amount)}. Link them anyway?`)) return;
    setBusy(true);
    const r = await api("/api/statements/checks", { action: "linkInvoice", checkId: c.id, invoiceId: linkInvId });
    setBusy(false);
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't link the invoice."); return; }
    setLinkInvId(""); setMsg("Invoice linked and marked paid by this check."); loadChecks(); loadPending(); loadInvoices();
  }

  // The files panel under a check: its attachments, the invoices it paid, and (for finance) attach / link.
  function renderCheckPanel(c: CheckRow) {
    const docs = checkDocs.filter((d) => d.check_id === c.id);
    const paidInv = checkInvoices.filter((i) => i.paid_from_id === c.account_id && i.paid_check_number === c.check_number);
    const kindLabel: Record<string, string> = { invoice: "Invoice", statement: "Statement", other: "Other" };
    return (
      <tr key={`${c.id}-panel`} className="border-b border-slate-100">
        <td colSpan={10} className="px-4 py-3" {...(finance && c.status !== "void" ? dropProps(`check-${c.id}`, (f) => attachToCheck(c, f)) : {})}
          style={{ background: dragOver === `check-${c.id}` ? "#fff7ed" : "#f8fafc", outline: dragOver === `check-${c.id}` ? "2px dashed #e8622a" : "none", outlineOffset: -4 }}>
          <div className="space-y-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Attached files</p>
              {docs.length === 0 && <p className="text-xs text-slate-400">Nothing attached.</p>}
              {docs.map((d) => (
                <div key={d.id} className="flex items-center gap-3 text-sm py-0.5">
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "#e2e8f0", color: "#475569" }}>{kindLabel[d.doc_kind] ?? "Other"}</span>
                  <span className="flex-1 min-w-0 truncate text-slate-700">{d.file_name}{d.note ? <span className="text-xs text-slate-400"> · {d.note}</span> : null}</span>
                  <button onClick={() => downloadCheckDoc(d)} className="rounded px-2.5 py-0.5 text-xs font-semibold text-white" style={{ backgroundColor: "#0f766e" }}>Download</button>
                  {finance && <button onClick={() => removeCheckDoc(d)} className="text-xs text-red-400 hover:text-red-600 hover:underline">Remove</button>}
                </div>
              ))}
            </div>
            {paidInv.length > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Invoices paid by this check</p>
                {paidInv.map((i) => <p key={i.id} className="text-sm text-slate-700">{i.account_name} · #{i.invoice_number} · {money(i.amount)}</p>)}
              </div>
            )}
            {finance && c.status !== "void" && (
              <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Attach a PDF <span className="normal-case font-normal">· or drag it anywhere on this panel</span></p>
                  <div className="flex items-center gap-2">
                    <select value={attKind} onChange={(e) => setAttKind(e.target.value)} className="rounded border border-slate-200 bg-white px-1.5 py-1.5 text-xs focus:outline-none">
                      <option value="invoice">Invoice copy</option><option value="statement">Statement</option><option value="other">Other (refund approval, check scan…)</option>
                    </select>
                    <input value={attNote} onChange={(e) => setAttNote(e.target.value)} placeholder="Note (optional)" className="rounded border border-slate-200 px-2 py-1.5 text-xs focus:outline-none" style={{ width: 150 }} />
                    <label className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white cursor-pointer hover:opacity-90" style={{ backgroundColor: "#e8622a", opacity: busy ? 0.5 : 1 }}>
                      {busy ? "Working…" : "Choose PDF"}
                      <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) attachToCheck(c, f); }} />
                    </label>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Link an invoice already filed</p>
                  <div className="flex items-center gap-2">
                    <select value={linkInvId} onChange={(e) => setLinkInvId(e.target.value)} className="rounded border border-slate-200 bg-white px-1.5 py-1.5 text-xs focus:outline-none" style={{ maxWidth: 300 }}>
                      <option value="">Choose an unpaid invoice…</option>
                      {pending.map((i) => <option key={i.id} value={i.id}>{i.account_name} · #{i.invoice_number} · {money(i.amount)}</option>)}
                    </select>
                    <button onClick={() => linkInvoiceToCheck(c)} disabled={busy || !linkInvId} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40" style={{ backgroundColor: "#0f766e" }}>Link and mark paid</button>
                  </div>
                  {!c.account_id && <p className="text-[11px] text-amber-700 mt-1">Edit this check and choose its bank account first.</p>}
                </div>
              </div>
            )}
          </div>
        </td>
      </tr>
    );
  }

  async function setCheckStatus(c: CheckRow, status: string) {
    setChecks((list) => list.map((x) => (x.id === c.id ? { ...x, status: status as CheckRow["status"] } : x)));
    const r = await api("/api/statements/checks", { action: "setStatus", id: c.id, status });
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't update."); loadChecks(); }
  }
  async function deleteCheck(c: CheckRow) {
    if (!window.confirm(`Delete check #${c.check_number}? Voiding it keeps the number on the register, so use Void unless it was entered by mistake.`)) return;
    const r = await api("/api/statements/checks", { action: "delete", id: c.id });
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't delete."); return; }
    loadChecks();
  }
  function downloadChecksCsv(rows: CheckRow[]) {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Check #", "Date", "Account", "Payee", "Type", "Amount", "Memo", "Status", "Cleared date"].map(esc).join(",")]
      .concat(rows.map((c) => [c.check_number, c.check_date, c.account_name, c.payee, c.category ?? "", c.amount ?? "", c.memo, c.status, c.cleared_date ?? ""].map(esc).join(",")));
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `check-register-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  const nextCheckFor = (accountId: string): string => {
    const nums = checks.filter((c) => c.account_id === accountId && /^\d+$/.test(c.check_number)).map((c) => Number(c.check_number));
    return nums.length ? String(Math.max(...nums) + 1) : "";
  };
  const payOptions = accounts.filter((a) => a.kind === "bank" || a.kind === "card");
  const payDialog = payFor && (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(15,23,42,0.35)" }}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl space-y-3">
        <h3 className="font-bold text-slate-800">{payEditing ? "Edit payment" : "Mark invoice paid"}</h3>
        <p className="text-sm text-slate-500">{payFor.account_name}{payFor.invoice_number ? ` · #${payFor.invoice_number}` : ""} · {money(payFor.amount)}</p>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Date paid</label>
          <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">How was it paid?</label>
          <select value={payMethod} onChange={(e) => { const m = e.target.value as typeof payMethod; setPayMethod(m); if (m === "check" && payFrom.startsWith("bank:") && !payCheckNo) setPayCheckNo(nextCheckFor(payFrom.slice(5))); }} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none">
            <option value="check">Check</option><option value="ach">ACH / bank transfer</option><option value="card">Credit card</option><option value="other">Cash / other</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Paid from</label>
          <select value={payFrom} onChange={(e) => { const v = e.target.value; setPayFrom(v); if (payMethod === "check" && v.startsWith("bank:")) setPayCheckNo(nextCheckFor(v.slice(5))); }} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none">
            <optgroup label="Bank accounts">{payOptions.filter((a) => a.kind === "bank").map((a) => <option key={a.id} value={`bank:${a.id}`}>{a.name}</option>)}</optgroup>
            <optgroup label="Credit cards">{payOptions.filter((a) => a.kind === "card").map((a) => <option key={a.id} value={`card:${a.id}`}>{a.name}</option>)}</optgroup>
            <option value="other">Other (cash, owner, etc.)</option>
          </select>
        </div>
        {payMethod === "check" && (
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Check number (required)</label>
            <input value={payCheckNo} onChange={(e) => setPayCheckNo(e.target.value)} placeholder="e.g. 1043" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
            <p className="text-xs text-slate-400 mt-1">It's added to the check register. The next number after your last check on this account is filled in for you.</p>
          </div>
        )}
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Note (optional)</label>
          <input value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="Check number, ACH, etc." className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
        </div>
        <p className="text-xs text-slate-400">This records where it was paid from. It doesn't change any balance, so update that account's balance as usual.</p>
        <div className="flex items-center gap-3 pt-1">
          <button onClick={() => confirmPay()} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: "#0f766e" }}>{busy ? "Saving…" : payEditing ? "Save changes" : "Mark paid"}</button>
          <button onClick={() => setPayFor(null)} className="text-sm text-slate-400 hover:underline">Cancel</button>
        </div>
      </div>
    </div>
  );

  const editInvDialog = editInv && (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(15,23,42,0.35)" }}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl space-y-3">
        <h3 className="font-bold text-slate-800">Edit invoice</h3>
        <p className="text-xs text-slate-400">The PDF stays as filed.{editInv.paid ? " If it was paid by check, that check on the register is updated too (unless it has already cleared)." : ""}</p>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Vendor</label>
          <select value={eVendor} onChange={(e) => setEVendor(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none">
            {!invVendors.some((v) => v.id === eVendor) && <option value={eVendor}>{editInv.account_name}</option>}
            {invVendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Invoice date</label>
            <input type="date" value={eDate} onChange={(e) => setEDate(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Invoice #</label>
            <input value={eNumber} onChange={(e) => setENumber(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Amount</label>
          <input type="number" step="0.01" value={eAmount} onChange={(e) => setEAmount(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
        </div>
        {eError && <p className="text-sm font-semibold text-red-600">{eError}</p>}
        <div className="flex items-center gap-3 pt-1">
          <button onClick={() => saveEditInvoice()} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: "#0f766e" }}>{busy ? "Saving…" : "Save changes"}</button>
          <button onClick={() => setEditInv(null)} className="text-sm text-slate-400 hover:underline">Cancel</button>
        </div>
      </div>
    </div>
  );

  const selAccount = sel ? accounts.find((a) => acctKey(a.kind, a.id) === sel.key) : null;
  const selFiles = selAccount && sel ? filesFor(selAccount.kind, selAccount.id, sel.month) : [];
  const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

  const content = (
    <div className="max-w-6xl space-y-4">
      {(tab !== "statements" || !finance) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {tab !== "statements" ? (
            <div>
              <h1 className="text-2xl font-bold">Statements</h1>
              <p className="text-sm text-slate-500">{finance ? "The check register and the month-end package for your CPA. The CPA can view and download anything filed." : "View and download any statement. This page is read-only."}</p>
            </div>
          ) : <span />}
          {!finance && <button onClick={logout} className="text-sm text-slate-500 hover:underline">Log out</button>}
        </div>
      )}

      <div className="flex gap-2">
        {(["statements", "checks", "package"] as const).filter((t) => finance || t !== "package").map((t) => (
          <button key={t} onClick={() => { setTab(t); setMsg(""); }} className="px-4 py-2 text-sm font-semibold rounded-lg border-2 transition"
            style={tab === t ? { backgroundColor: "#e8622a", color: "white", borderColor: "#e8622a" } : { backgroundColor: "white", color: "#475569", borderColor: "#cbd5e1" }}>
            {t === "statements" ? "Statements" : t === "checks" ? "Check register" : "CPA package"}
          </button>
        ))}
      </div>

      {payDialog}
      {editInvDialog}
      {tab !== "statements" && pendingBanner}

      {tab === "statements" ? (
      <StatementsMonth finance={finance} onAuthLost={logout} onChanged={loadPending} />
      ) : tab === "checks" ? (
      <div className="space-y-4">
        {(() => {
          const banks = accounts.filter((a) => a.kind === "bank");
          const q = chkSearch.trim().toLowerCase();
          const shown = checks.filter((c) => (!chkAccount || c.account_id === chkAccount) && (!chkStatus || c.status === chkStatus) && (!chkType || (c.category ?? "") === chkType)
            && (!q || c.check_number.toLowerCase().includes(q) || c.payee.toLowerCase().includes(q) || c.memo.toLowerCase().includes(q)));
          const outstanding = checks.filter((c) => c.status === "outstanding");
          const outTotal = outstanding.reduce((n, c) => n + (c.amount ?? 0), 0);
          // Numbers skipped in the sequence for each account (small gaps only), so a check that was written but never logged stands out.
          const gaps: string[] = [];
          for (const a of banks) {
            const nums = [...new Set(checks.filter((c) => c.account_id === a.id && /^\d+$/.test(c.check_number)).map((c) => Number(c.check_number)))].sort((x, y) => x - y).slice(-100);
            const missing: number[] = [];
            for (let i = 1; i < nums.length; i++) { const d = nums[i] - nums[i - 1] - 1; if (d > 0 && d <= 15) for (let n = nums[i - 1] + 1; n < nums[i]; n++) missing.push(n); }
            if (missing.length > 0) gaps.push(`${a.name}: ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? "…" : ""}`);
          }
          return (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <select value={chkAccount} onChange={(e) => setChkAccount(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none">
                  <option value="">All accounts</option>
                  {banks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <select value={chkStatus} onChange={(e) => setChkStatus(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none">
                  <option value="">Any status</option><option value="outstanding">Outstanding</option><option value="cleared">Cleared</option><option value="void">Void</option>
                </select>
                <select value={chkType} onChange={(e) => setChkType(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none">
                  <option value="">Any type</option>
                  {CHECK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input value={chkSearch} onChange={(e) => setChkSearch(e.target.value)} placeholder="Search number, payee or memo…" className="w-full sm:w-72 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none" />
                <button onClick={() => downloadChecksCsv(shown)} className="text-sm font-semibold text-orange-500 hover:underline">Download CSV</button>
              </div>

              {outstanding.length > 0 && (
                <div className="rounded-xl px-4 py-2.5 text-sm" style={{ background: "#FAEEDA", color: "#854F0B" }}>
                  <strong>{outstanding.length} outstanding check{outstanding.length === 1 ? "" : "s"}</strong> totalling {money(outTotal)}. They haven't cleared yet, so the bank balance doesn't reflect them.
                </div>
              )}
              {gaps.length > 0 && (
                <div className="rounded-xl px-4 py-2.5 text-xs" style={{ background: "#eef6ff", color: "#1e4e8c" }}>
                  <strong>Check numbers not on the register:</strong> {gaps.join(" · ")}. If these were written, add them; if they were voided or never used, ignore this.
                </div>
              )}

              {finance && (
                <div className="rounded-2xl bg-white shadow px-5 py-3">
                  {!chkAdding ? (
                    <button onClick={() => { setChkAdding(true); const a = banks[0]; if (a && !cAccount) { setCAccount(a.id); setCNumber(nextCheckFor(a.id)); } }} className="text-sm font-semibold text-orange-500 hover:underline">+ Add a check</button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-slate-500">{cEditId ? "Editing a check." : "Checks that pay an invoice are added automatically when you mark the invoice paid. Use this for any other check: a patient refund, a payroll check, rent, and so on."}</p>
                      <div className="flex flex-wrap items-end gap-3">
                        <div><label className="block text-xs font-semibold text-slate-500 mb-1">Account</label>
                          <select value={cAccount} onChange={(e) => { setCAccount(e.target.value); setCNumber(nextCheckFor(e.target.value)); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none">
                            {banks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}<option value="">Other / not listed</option>
                          </select></div>
                        <div><label className="block text-xs font-semibold text-slate-500 mb-1">Check #</label><input value={cNumber} onChange={(e) => setCNumber(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" style={{ width: 100 }} /></div>
                        <div><label className="block text-xs font-semibold text-slate-500 mb-1">Date</label><input type="date" value={cDate} onChange={(e) => setCDate(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" /></div>
                        <div><label className="block text-xs font-semibold text-slate-500 mb-1">Type</label>
                          <select value={cType} onChange={(e) => setCType(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none">
                            {CHECK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select></div>
                        <div style={{ flex: "1 1 180px" }}>
                          <label className="block text-xs font-semibold text-slate-500 mb-1">{cType === "Payroll" ? "Employee" : "Payee"}</label>
                          {cType === "Payroll" && staffNames.length > 0 ? (
                            <>
                              <select value={cPayeeOther ? "__other" : (staffNames.includes(cPayee) ? cPayee : "")} onChange={(e) => { if (e.target.value === "__other") { setCPayeeOther(true); setCPayee(""); } else { setCPayeeOther(false); setCPayee(e.target.value); } }} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none">
                                <option value="">Choose an employee…</option>
                                {staffNames.map((n) => <option key={n} value={n}>{n}</option>)}
                                <option value="__other">Someone else (type a name)…</option>
                              </select>
                              {cPayeeOther && <input value={cPayee} onChange={(e) => setCPayee(e.target.value)} placeholder="Name" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />}
                            </>
                          ) : (
                            <input value={cPayee} onChange={(e) => setCPayee(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
                          )}
                        </div>
                        <div><label className="block text-xs font-semibold text-slate-500 mb-1">Amount</label><input type="number" step="0.01" value={cAmount} onChange={(e) => setCAmount(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" style={{ width: 110 }} /></div>
                        <div style={{ flex: "1 1 160px" }}><label className="block text-xs font-semibold text-slate-500 mb-1">Memo</label><input value={cMemo} onChange={(e) => setCMemo(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" /></div>
                        <button onClick={() => addCheck()} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: "#e8622a" }}>{cEditId ? "Save changes" : "Add"}</button>
                        <button onClick={() => { setChkAdding(false); setCEditId(null); }} className="text-sm text-slate-400 hover:underline pb-2">{cEditId ? "Cancel" : "Close"}</button>
                      </div>
                    </div>
                  )}
                  {msg && <p className="text-sm font-semibold text-slate-600 mt-2">{msg}</p>}
                </div>
              )}

              <div className="rounded-2xl bg-white shadow overflow-x-auto">
                <table className="w-full text-sm border-collapse" style={{ minWidth: 760 }}>
                  <thead>
                    <tr className="text-xs text-slate-400 border-b border-slate-100 text-left">
                      <th className="px-4 py-2 font-medium">Check #</th><th className="px-2 py-2 font-medium">Date</th><th className="px-2 py-2 font-medium">Account</th>
                      <th className="px-2 py-2 font-medium">Payee</th><th className="px-2 py-2 font-medium">Type</th><th className="px-2 py-2 font-medium">Amount</th><th className="px-2 py-2 font-medium">Memo</th><th className="px-2 py-2 font-medium">Files</th>
                      <th className="px-2 py-2 font-medium">Status</th><th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.length === 0 && <tr><td colSpan={10} className="px-4 py-6 text-slate-400">{checks.length === 0 ? "No checks logged yet." : "No checks match."}</td></tr>}
                    {shown.map((c) => (
                      <Fragment key={c.id}>
                      <tr className="border-b border-slate-50" style={{ opacity: c.status === "void" ? 0.5 : 1 }}>
                        <td className="px-4 py-1.5 font-semibold text-slate-700 whitespace-nowrap">#{c.check_number}</td>
                        <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">{new Date(c.check_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}</td>
                        <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">{c.account_name || "—"}</td>
                        <td className="px-2 py-1.5 text-slate-700">{c.payee || "—"}</td>
                        <td className="px-2 py-1.5 text-xs text-slate-500 whitespace-nowrap">{c.category || "—"}</td>
                        <td className="px-2 py-1.5 text-slate-700 whitespace-nowrap">{c.amount != null ? money(c.amount) : "—"}</td>
                        <td className="px-2 py-1.5 text-xs text-slate-500">{c.memo}</td>
                        <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                          {(() => { const n = checkDocs.filter((d) => d.check_id === c.id).length; return (
                            <button onClick={() => setOpenCheck(openCheck === c.id ? null : c.id)} disabled={!finance && n === 0 && !checkInvoices.some((i) => i.paid_from_id === c.account_id && i.paid_check_number === c.check_number)} className="font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-30">📎 {n > 0 ? n : finance ? "Attach" : "—"}</button>
                          ); })()}
                        </td>
                        <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                          {finance ? (
                            <select value={c.status} onChange={(e) => setCheckStatus(c, e.target.value)} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-xs focus:outline-none">
                              <option value="outstanding">Outstanding</option><option value="cleared">Cleared</option><option value="void">Void</option>
                            </select>
                          ) : <span className="rounded-full px-2 py-0.5 font-semibold" style={{ background: c.status === "cleared" ? "#e7f6ec" : c.status === "void" ? "#f1f5f9" : "#fef3c7", color: c.status === "cleared" ? "#166534" : c.status === "void" ? "#475569" : "#92400e" }}>{c.status === "outstanding" ? "Outstanding" : c.status === "cleared" ? "Cleared" : "Void"}</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          {finance && !c.invoice_id && <button onClick={() => startEditCheck(c)} className="text-xs text-slate-500 hover:text-slate-700 hover:underline mr-3">Edit</button>}
                          {finance && <button onClick={() => deleteCheck(c)} className="text-xs text-red-400 hover:text-red-600 hover:underline">Delete</button>}
                        </td>
                      </tr>
                      {openCheck === c.id && renderCheckPanel(c)}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                {(() => {
                  const by = shown.filter((c) => c.status !== "void").reduce<Record<string, number>>((m, c) => { const k = c.category || "Uncategorized"; m[k] = (m[k] ?? 0) + (c.amount ?? 0); return m; }, {});
                  const entries = Object.entries(by).filter(([, v]) => v !== 0).sort((a, z) => z[1] - a[1]);
                  return entries.length > 0 ? (
                    <div className="flex flex-wrap gap-x-5 gap-y-1 px-4 py-2.5 border-t border-slate-100 text-xs text-slate-500">
                      <span className="font-semibold text-slate-400">By type</span>
                      {entries.map(([k, v]) => <span key={k}><span className="font-semibold text-slate-600">{k}</span> {money(v)}</span>)}
                    </div>
                  ) : null;
                })()}
              </div>
            </>
          );
        })()}
      </div>
      ) : tab === "package" ? (
      <div className="space-y-4 max-w-4xl">
        <div className="rounded-2xl bg-white shadow px-5 py-4 space-y-3">
          <h2 className="font-bold text-slate-800">Month-end package for your CPA</h2>
          <p className="text-sm text-slate-500">One download with the check register, the invoices paid, and the statement and invoice PDFs. Statements are the ones covering the month; invoices are the ones paid in the month.</p>
          <div className="flex flex-wrap items-end gap-3">
            <div><label className="block text-xs font-semibold text-slate-500 mb-1">Month</label>
              <input type="month" value={pkgMonth} onChange={(e) => e.target.value && setPkgMonth(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" /></div>
            <div style={{ flex: "1 1 240px" }}><label className="block text-xs font-semibold text-slate-500 mb-1">CPA's email address</label>
              <input type="email" value={cpaEmail} onChange={(e) => setCpaEmail(e.target.value)} placeholder="cpa@firm.com" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" /></div>
            <button onClick={saveCpaEmail} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Save email</button>
          </div>

          {pkgPreview && (
            <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm space-y-1">
              <p className="font-semibold text-slate-700">{pkgPreview.statements} statement{pkgPreview.statements === 1 ? "" : "s"} · {pkgPreview.invoices} invoice{pkgPreview.invoices === 1 ? "" : "s"} paid ({money(pkgPreview.invoiceTotal)}) · {pkgPreview.checks} check{pkgPreview.checks === 1 ? "" : "s"}</p>
              {pkgPreview.missing?.length > 0 && <p style={{ color: "#854F0B" }}>⚠️ No statement filed yet for: {pkgPreview.missing.join(", ")}.</p>}
              {pkgPreview.invoices > pkgPreview.invoicePdfs && <p style={{ color: "#854F0B" }}>⚠️ {pkgPreview.invoices - pkgPreview.invoicePdfs} paid invoice(s) have no PDF attached.</p>}
              {pkgPreview.unpaidInvoices > 0 && <p className="text-slate-500">{pkgPreview.unpaidInvoices} invoice(s) are still unpaid. They aren't in this package; they'll be in the month they're paid.</p>}
              {pkgPreview.outstanding > 0 && <p className="text-slate-500">{pkgPreview.outstanding} check(s) are still outstanding. The summary page mentions them.</p>}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={createPackage} disabled={!!pkgBusy} className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: "#e8622a" }}>
              {pkgBusy === "create" ? "Building…" : `Create package for ${monthLabel(pkgMonth)}`}
            </button>
          </div>
          {pkgMsg && <p className="text-sm font-semibold text-slate-600">{pkgMsg}</p>}
        </div>

        <div className="rounded-2xl bg-white shadow overflow-x-auto">
          <table className="w-full text-sm border-collapse" style={{ minWidth: 640 }}>
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-100 text-left">
                <th className="px-4 py-2 font-medium">Month</th><th className="px-2 py-2 font-medium">Contents</th><th className="px-2 py-2 font-medium">Built</th>
                <th className="px-2 py-2 font-medium">Emailed</th><th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {pkgList.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-slate-400">No packages built yet.</td></tr>}
              {pkgList.map((pk) => (
                <tr key={pk.id} className="border-b border-slate-50">
                  <td className="px-4 py-2 font-semibold text-slate-700 whitespace-nowrap">{monthLabel(pk.month)}</td>
                  <td className="px-2 py-2 text-xs text-slate-500">{pk.stats}{pk.file_size ? ` · ${(pk.file_size / 1024 / 1024).toFixed(1)} MB` : ""}</td>
                  <td className="px-2 py-2 text-xs text-slate-500 whitespace-nowrap">{new Date(pk.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                  <td className="px-2 py-2 text-xs text-slate-500">{pk.emailed_at ? `${pk.emailed_to} · ${new Date(pk.emailed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Not yet"}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <button onClick={() => emailPackage(pk)} disabled={!!pkgBusy} className="rounded-lg px-3 py-1 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "#e8622a" }}>{pkgBusy === `em:${pk.id}` ? "Sending…" : pk.emailed_at ? "Email new link" : "Email link to CPA"}</button>
                    <button onClick={() => downloadPackage(pk.id)} disabled={!!pkgBusy} className="ml-2 rounded-lg px-3 py-1 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "#0f766e" }}>Download</button>
                    <button onClick={() => deletePackage(pk)} className="ml-3 text-xs text-red-400 hover:text-red-600 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400">The emailed link works for 7 days and the file stays in your private storage. Delete a package once your CPA has it. "Email new link" sends a fresh 7-day link, and links already sent keep working until they expire.</p>
      </div>
      ) : null}
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
