"use client";

import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "@/components/Sidebar";
import { supabase } from "@/lib/supabase";
import { getSessionToken, storeSessionToken, clearSessionToken, hasSessionToken } from "@/lib/secureData";
import { loadRecurringBills, loadBillPayments, buildOccurrences, addDays, RecurringBill, BillPayment } from "@/lib/cashflow";

/**
 * Monthly statements: a checklist of every account, card and loan against every month, with the PDF
 * filed right where it's ticked off. Finance users upload and mark; the CPA (own passcode) can only
 * view and download. Files live in a private bucket and are only ever reached through short-lived links.
 */

type Role = "finance" | "cpa";
interface Account { kind: "bank" | "card" | "loan" | "vendor"; id: string; name: string; category?: string; startMonth?: string; active?: boolean }
interface CheckRow { id: string; check_number: string; account_id: string | null; account_name: string; check_date: string; payee: string; amount: number | null; memo: string; invoice_id: string | null; status: "outstanding" | "cleared" | "void"; cleared_date: string | null; created_by: string }
interface FileRow { paid_method?: string | null; paid_check_number?: string; paid_from_name?: string; paid_note?: string; category?: string; paid?: boolean; paid_date?: string | null; matched_bill_id?: string | null; matched_due_date?: string | null; dup_ignored?: boolean; doc_type?: string; invoice_date?: string | null; invoice_number?: string; amount?: number | null; id: string; account_kind: string; account_id: string; account_name: string; month: string; file_name: string | null; size_bytes: number | null; no_statement: boolean; note: string; uploaded_by: string; uploaded_at: string }

const ROLE_KEY = "dd_statements_role";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KIND_LABEL: Record<string, string> = { bank: "Bank accounts", card: "Credit cards", loan: "Loans" };
const DEFAULT_CATEGORIES = ["CAM", "Rent", "Supplies", "Lab", "Utilities", "Insurance", "Equipment & repairs", "Marketing", "Professional fees", "Other"];
// A vendor's type suggests a starting category for its invoices.
const VENDOR_TYPE_CATEGORY: Record<string, string> = { Lab: "Lab", Supplier: "Supplies", Insurance: "Insurance" };
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
  // "Mark paid" dialog: the invoice, the date, the account it was paid from, and a note
  const [payFor, setPayFor] = useState<FileRow | null>(null);
  const [payDate, setPayDate] = useState("");
  const [payFrom, setPayFrom] = useState("");
  const [payNote, setPayNote] = useState("");
  const [payMethod, setPayMethod] = useState<"check" | "ach" | "card" | "other">("check");
  const [payCheckNo, setPayCheckNo] = useState("");
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
  const [pending, setPending] = useState<FileRow[]>([]);   // every unpaid invoice, across all months
  // Vendor directory
  const [vendorsAll, setVendorsAll] = useState<{ id: string; name: string; category: string; active: boolean; expectsStatement: boolean }[]>([]);
  const [usedNames, setUsedNames] = useState<string[]>([]);
  const [showVendors, setShowVendors] = useState(false);
  const [iSave, setISave] = useState(true);       // save a newly typed vendor to the list
  const [iType, setIType] = useState("Other");    // its type
  const [vExpects, setVExpects] = useState(true); // new vendor on the Monthly statements tab: sends a statement?
  const [usedCategories, setUsedCategories] = useState<string[]>([]);
  const [catFilter, setCatFilter] = useState("");
  // A possible duplicate found before filing: the person can file it anyway or cancel.
  const [dup, setDup] = useState<{ matches: (FileRow & { reason?: string })[]; note?: string; proceed: () => void } | null>(null);
  // Invoices (a separate list from the monthly statements)
  const [tab, setTab] = useState<"statements" | "invoices" | "checks">("statements");
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
    setSAmount(v != null ? String(v) : "");
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
    if (sAmount.trim() === "" || isNaN(Number(sAmount))) { setMsg("Enter the statement amount first, then choose the PDF."); return; }
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
    setSAmount(""); setMsg(`Filed ${file.name}.${rec.json.synced ? " Saved as this month's statement balance in Cash Flow." : ""}`); load();
  }

  async function markNone(a: Account, month: string) {
    const note = window.prompt("Why is there no statement? (optional, e.g. account had no activity)") ?? "";
    setBusy(true);
    const r = await api("/api/statements/manage", { action: "markNone", accountKind: a.kind, accountId: a.id, accountName: a.name, month, note });
    setBusy(false);
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't save."); return; }
    load();
  }

  const loadChecks = useCallback(async () => {
    if (!role) return;
    const r = await api("/api/statements/checks", { action: "list" });
    if (r.status === 401) { logout(); return; }
    if (!r.ok) { setLoadError(r.json.error ?? "Couldn't load the check register."); return; }
    setChecks(r.json.checks ?? []);
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadChecks(); }, [loadChecks]);

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

  async function addInvoice(file: File, ignoreDup = false) {
    setMsg(""); setDup(null);
    let vendor = invVendors.find((v) => v.id === iVendor);
    const typed = iOther.trim();
    // A typed name that matches a saved vendor is that vendor, so one company never ends up listed twice.
    if (!vendor && typed) vendor = invVendors.find((v) => v.name.trim().toLowerCase() === typed.toLowerCase());
    const name = vendor ? vendor.name : typed;
    if (!name) { setMsg("Choose a vendor or type a name."); return; }
    if (!iDate) { setMsg("Enter the invoice date."); return; }
    if (!iNumber.trim()) { setMsg("Enter the invoice number."); return; }
    if (iAmount.trim() === "" || isNaN(Number(iAmount))) { setMsg("Enter the invoice amount."); return; }
    if (!/\.pdf$/i.test(file.name)) { setMsg("Only PDF files can be uploaded."); return; }
    setBusy(true);
    let kind = vendor ? "vendor" : "other";
    if (!ignoreDup) {
      const chk = await api("/api/statements/manage", { action: "checkDuplicate", docType: "invoice", accountKind: kind, accountId: vendor?.id ?? "", accountName: name, invoiceDate: iDate, invoiceNumber: iNumber, amount: iAmount });
      if (chk.ok && (chk.json.matches ?? []).length > 0) { setBusy(false); setDup({ matches: chk.json.matches, proceed: () => addInvoice(file, true) }); return; }
    }
    // Only now, once the invoice is really going ahead, save a new vendor to the list (invoice-only: no monthly statement expected).
    if (!vendor && iSave) {
      const saved = await api("/api/statements/manage", { action: "addSource", name, category: iType, startMonth: new Date().toISOString().slice(0, 7), expectsStatement: false });
      if (saved.ok && saved.json.data?.id) { vendor = { id: String(saved.json.data.id), name, category: iType }; kind = "vendor"; setInvVendors((v) => [...v, vendor!]); }
    }
    const slot = await api("/api/statements/upload-url", { docType: "invoice", accountKind: kind, accountName: name, month: iDate.slice(0, 7), fileName: file.name, size: file.size });
    if (!slot.ok) { setBusy(false); setMsg(slot.json.error ?? "Couldn't start the upload."); return; }
    const up = await supabase.storage.from("statements").uploadToSignedUrl(slot.json.path, slot.json.token, file, { contentType: "application/pdf" });
    if (up.error) { setBusy(false); setMsg(`Upload failed: ${up.error.message}`); return; }
    const rec = await api("/api/statements/manage", { action: "confirm", docType: "invoice", path: slot.json.path, accountKind: kind, accountId: vendor?.id ?? "", accountName: name, invoiceDate: iDate, invoiceNumber: iNumber, amount: iAmount, fileName: file.name, size: file.size, dupIgnored: ignoreDup, matchedBillId: iMatch?.billId, matchedDueDate: iMatch?.dueDate, category: iCategory });
    setBusy(false);
    if (!rec.ok) { setMsg(rec.json.error ?? "Couldn't record the invoice."); return; }
    setMsg(`Filed invoice ${iNumber.trim()} from ${name}.`); setINumber(""); setIAmount(""); setIMatch(null);
    if (iDate.slice(0, 7) !== invMonth) setInvMonth(iDate.slice(0, 7)); else loadInvoices();
  }

  // Marking paid opens a small dialog (date, which account, note). Undo needs no questions.
  function openPay(f: FileRow) {
    const first = accounts.find((a) => a.kind === "bank");
    const from = payFrom || (first ? `bank:${first.id}` : "other");
    setPayFor(f); setPayDate(new Date().toISOString().slice(0, 10)); setPayNote(""); setPayFrom(from);
    setPayMethod(payFrom.startsWith("card:") ? "card" : "check");
    setPayCheckNo(from.startsWith("bank:") ? nextCheckFor(from.slice(5)) : "");
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
  const invVendorName = (invVendors.find((v) => v.id === iVendor)?.name ?? iOther).trim();
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
      <button onClick={() => { setTab("invoices"); setUnpaidOnly(true); }} className="underline font-semibold">Review unpaid</button>
    </div>
  );

  async function addCheck(allowDuplicate = false) {
    const acct = accounts.find((a) => a.kind === "bank" && a.id === cAccount);
    if (!cNumber.trim() || !cDate) { setMsg("Enter the check number and date."); return; }
    setBusy(true); setMsg("");
    const r = await api("/api/statements/checks", { action: "add", checkNumber: cNumber, checkDate: cDate, accountId: acct?.id ?? "", accountName: acct?.name ?? "", payee: cPayee, amount: cAmount, memo: cMemo, allowDuplicate });
    setBusy(false);
    if (r.status === 409 && r.json.duplicate) {
      const d = r.json.duplicate;
      if (window.confirm(`Check #${cNumber.trim()} on ${acct?.name ?? "this account"} is already on the register (${d.payee || "no payee"}, ${d.check_date}). Add it again anyway?`)) addCheck(true);
      return;
    }
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't add the check."); return; }
    setCNumber(/^\d+$/.test(cNumber.trim()) ? String(Number(cNumber.trim()) + 1) : ""); setCPayee(""); setCAmount(""); setCMemo("");
    setMsg(`Check #${r.json.data?.check_number ?? ""} added.`); loadChecks();
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
    const lines = [["Check #", "Date", "Account", "Payee", "Amount", "Memo", "Status", "Cleared date"].map(esc).join(",")]
      .concat(rows.map((c) => [c.check_number, c.check_date, c.account_name, c.payee, c.amount ?? "", c.memo, c.status, c.cleared_date ?? ""].map(esc).join(",")));
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
        <h3 className="font-bold text-slate-800">Mark invoice paid</h3>
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
          <button onClick={() => confirmPay()} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: "#0f766e" }}>{busy ? "Saving…" : "Mark paid"}</button>
          <button onClick={() => setPayFor(null)} className="text-sm text-slate-400 hover:underline">Cancel</button>
        </div>
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
        {(["statements", "invoices", "checks"] as const).map((t) => (
          <button key={t} onClick={() => { setTab(t); setMsg(""); }} className="px-4 py-2 text-sm font-semibold rounded-lg border-2 transition"
            style={tab === t ? { backgroundColor: "#e8622a", color: "white", borderColor: "#e8622a" } : { backgroundColor: "white", color: "#475569", borderColor: "#cbd5e1" }}>
            {t === "statements" ? "Monthly statements" : t === "invoices" ? "Invoices" : "Check register"}
          </button>
        ))}
      </div>

      {payDialog}
      {pendingBanner}

      {tab === "invoices" ? (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-semibold text-slate-600">Month</label>
          <input type="month" value={invMonth} onChange={(e) => e.target.value && setInvMonth(e.target.value)} disabled={unpaidOnly} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none disabled:opacity-40" />
          {unpaidOnly && <span className="text-xs text-slate-500">Showing unpaid invoices from every month</span>}
          <input value={invSearch} onChange={(e) => setInvSearch(e.target.value)} placeholder="Search vendor or invoice #…" className="w-full sm:w-72 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none" />
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none">
            <option value="">All categories</option>
            {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {finance && <button onClick={() => setShowVendors((v) => !v)} className="text-sm font-semibold text-orange-500 hover:underline">{showVendors ? "Hide vendors" : "Vendors"}</button>}
          <label className="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" checked={unpaidOnly} onChange={(e) => setUnpaidOnly(e.target.checked)} /> Unpaid only</label>
        </div>
        {loadError && <p className="text-sm text-red-600 font-semibold">⚠️ {loadError}</p>}

        {finance && showVendors && (
          <div className="rounded-2xl bg-white shadow px-5 py-3 space-y-1">
            <h3 className="font-bold text-sm text-slate-700">Vendors</h3>
            <p className="text-xs text-slate-500">Everyone you've saved. Tick "Monthly statement" only for vendors that send one each month, since those appear on the monthly checklist and in the Friday reminder.</p>
            {vendorsAll.length === 0 && <p className="text-xs text-slate-400 pt-1">No vendors saved yet. File an invoice and tick "Save to my vendor list".</p>}
            {vendorsAll.map((v) => (
              <div key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm border-t border-slate-100 pt-1.5" style={{ opacity: v.active ? 1 : 0.5 }}>
                <span className="font-medium text-slate-700 w-48 truncate">{v.name}{!v.active && <span className="ml-1 text-xs font-normal text-slate-400">retired</span>}</span>
                <select value={v.category} onChange={(e) => updateVendor(v.id, { category: e.target.value })} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-xs focus:outline-none">
                  <option>Lab</option><option>Supplier</option><option>Insurance</option><option>Other</option>
                </select>
                <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={v.expectsStatement} onChange={(e) => updateVendor(v.id, { expectsStatement: e.target.checked })} /> Monthly statement</label>
                <button onClick={() => renameDirVendor(v)} className="text-xs text-slate-400 hover:text-slate-600" title="Rename">✎ Rename</button>
                <button onClick={() => updateVendor(v.id, { active: !v.active })} className="text-xs text-slate-400 hover:text-slate-600">{v.active ? "Retire" : "Restore"}</button>
              </div>
            ))}
          </div>
        )}

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
                    <>
                      <div style={{ flex: "1 1 180px" }}>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Vendor name</label>
                        <input value={iOther} onChange={(e) => setIOther(e.target.value)} list="usedVendorNames" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
                        <datalist id="usedVendorNames">{usedNames.map((n) => <option key={n} value={n} />)}</datalist>
                      </div>
                      {iOther.trim() && !invVendors.some((v) => v.name.trim().toLowerCase() === iOther.trim().toLowerCase()) && (
                        <>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">Type</label>
                            <select value={iType} onChange={(e) => setIType(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none">
                              <option>Lab</option><option>Supplier</option><option>Insurance</option><option>Other</option>
                            </select>
                          </div>
                          <label className="flex items-center gap-1.5 text-sm text-slate-600 pb-2"><input type="checkbox" checked={iSave} onChange={(e) => setISave(e.target.checked)} /> Save to my vendor list</label>
                        </>
                      )}
                    </>
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
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Category</label>
                    <select value={iCategory} onChange={async (e) => { if (e.target.value === "__new") { const c = await newCategory(); if (c) setICategory(c); } else setICategory(e.target.value); }}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none" style={{ minWidth: 150 }}>
                      <option value="">None</option>
                      {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                      <option value="__new">+ New category…</option>
                    </select>
                  </div>
                </div>
                {iMatch ? (
                  <div className="rounded-lg px-3 py-2 text-sm" style={{ background: "#dbeafe", color: "#1e4e8c" }}>
                    Linked to scheduled bill <strong>{iMatch.billName}</strong> (${iMatch.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}, due {new Date(iMatch.dueDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}). It won't be counted twice in Need to collect.
                    <button onClick={() => setIMatch(null)} className="ml-2 underline font-semibold">Unlink</button>
                  </div>
                ) : suggestions.length > 0 && (
                  <div className="rounded-lg px-3 py-2 text-sm space-y-1" style={{ background: "#eef6ff", color: "#1e4e8c" }}>
                    <p className="font-semibold">This may be a bill you've already scheduled:</p>
                    {suggestions.map((sg) => (
                      <p key={sg.bill.id}>
                        {sg.bill.name} — ${sg.bill.estimatedAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}, due {new Date(sg.dueDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        {sg.diff != null && sg.diff <= 0.25 ? " (amount is close)" : sg.diff != null ? " (amount differs)" : ""}
                        <button onClick={() => setIMatch({ billId: sg.bill.id, dueDate: sg.dueDate, billName: sg.bill.name, amount: sg.bill.estimatedAmount })} className="ml-2 underline font-semibold">Link this invoice to it</button>
                      </p>
                    ))}
                  </div>
                )}
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
          const shown = invFiles.filter((f) => (!unpaidOnly || !f.paid) && (!catFilter || (f.category ?? "") === catFilter) && (!q || f.account_name.toLowerCase().includes(q) || (f.invoice_number ?? "").toLowerCase().includes(q)));
          const total = shown.reduce((n, f) => n + (f.amount ?? 0), 0);
          const withAmount = shown.filter((f) => f.amount != null).length;
          return (
            <div className="rounded-2xl bg-white shadow overflow-x-auto">
              <table className="w-full text-sm border-collapse" style={{ minWidth: 640 }}>
                <thead>
                  <tr className="text-xs text-slate-400 border-b border-slate-100 text-left">
                    <th className="px-4 py-2 font-medium">Date</th><th className="px-2 py-2 font-medium">Vendor</th><th className="px-2 py-2 font-medium">Category</th><th className="px-2 py-2 font-medium">Invoice #</th>
                    <th className="px-2 py-2 font-medium">Amount</th><th className="px-2 py-2 font-medium">Status</th><th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-slate-400">{loading ? "Loading…" : "No invoices filed for this month."}</td></tr>}
                  {shown.map((f) => (
                    <tr key={f.id} className="border-b border-slate-50">
                      <td className="px-4 py-1.5 text-slate-600 whitespace-nowrap">{f.invoice_date ? new Date(f.invoice_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</td>
                      <td className="px-2 py-1.5 font-medium text-slate-700">{f.account_name}</td>
                      <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">
                        {finance ? (
                          <select value={f.category ?? ""} onChange={(e) => changeCategory(f, e.target.value)} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-xs focus:outline-none">
                            <option value="">—</option>
                            {[...new Set([...categoryOptions, ...(f.category ? [f.category] : [])])].map((c) => <option key={c} value={c}>{c}</option>)}
                            <option value="__new">+ New…</option>
                          </select>
                        ) : (f.category || "—")}
                      </td>
                      <td className="px-2 py-1.5 text-slate-600">{f.invoice_number || "—"}{f.dup_ignored && <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "#FAEEDA", color: "#854F0B" }} title="Filed even though the app warned it might be a duplicate">dup?</span>}</td>
                      <td className="px-2 py-1.5 text-slate-700 whitespace-nowrap">{f.amount != null ? `$${Number(f.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</td>
                      <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                        {f.paid ? <span className="rounded-full px-2 py-0.5 font-semibold" style={{ background: "#e7f6ec", color: "#166534" }} title={f.paid_note || undefined}>Paid{f.paid_date ? ` ${new Date(f.paid_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}{f.paid_from_name ? ` · ${f.paid_from_name}` : ""}{f.paid_method === "check" && f.paid_check_number ? ` · check #${f.paid_check_number}` : f.paid_method === "ach" ? " · ACH" : ""}</span>
                          : f.matched_bill_id ? <span className="rounded-full px-2 py-0.5 font-semibold" style={{ background: "#dbeafe", color: "#1e4e8c" }} title="Counted through its scheduled bill">Scheduled bill{f.matched_due_date ? ` · ${new Date(f.matched_due_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}</span>
                          : <span className="rounded-full px-2 py-0.5 font-semibold" style={{ background: "#fef3c7", color: "#92400e" }}>Unpaid</span>}
                        {finance && !f.paid && <button onClick={() => openPay(f)} disabled={busy} className="ml-2 underline text-slate-500 hover:text-slate-700">Mark paid</button>}
                        {finance && f.paid && <button onClick={() => undoPaid(f)} disabled={busy} className="ml-2 underline text-slate-400 hover:text-slate-600">Undo</button>}
                        {finance && f.matched_bill_id && !f.paid && <button onClick={() => unlinkInvoice(f)} className="ml-2 underline text-slate-400 hover:text-slate-600">Unlink</button>}
                      </td>
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
                      <td className="px-4 py-2" colSpan={4}>{shown.length} invoice{shown.length === 1 ? "" : "s"}</td>
                      <td className="px-2 py-2 whitespace-nowrap" colSpan={3}>{withAmount > 0 ? `$${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""}{withAmount > 0 && withAmount < shown.length ? ` (${withAmount} with amounts)` : ""}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
              {(() => {
                const by = shown.reduce<Record<string, number>>((m, f) => { const k = f.category || "Uncategorized"; m[k] = (m[k] ?? 0) + (f.amount ?? 0); return m; }, {});
                const entries = Object.entries(by).filter(([, v]) => v !== 0).sort((a, z) => z[1] - a[1]);
                return entries.length > 0 ? (
                  <div className="flex flex-wrap gap-x-5 gap-y-1 px-4 py-2.5 border-t border-slate-100 text-xs text-slate-500">
                    <span className="font-semibold text-slate-400">By category</span>
                    {entries.map(([k, v]) => <span key={k}><span className="font-semibold text-slate-600">{k}</span> {money(v)}</span>)}
                  </div>
                ) : null;
              })()}
            </div>
          );
        })()}
      </div>
      ) : tab === "checks" ? (
      <div className="space-y-4">
        {(() => {
          const banks = accounts.filter((a) => a.kind === "bank");
          const q = chkSearch.trim().toLowerCase();
          const shown = checks.filter((c) => (!chkAccount || c.account_id === chkAccount) && (!chkStatus || c.status === chkStatus)
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
                      <p className="text-xs text-slate-500">Checks that pay an invoice are added automatically when you mark the invoice paid. Use this for any other check.</p>
                      <div className="flex flex-wrap items-end gap-3">
                        <div><label className="block text-xs font-semibold text-slate-500 mb-1">Account</label>
                          <select value={cAccount} onChange={(e) => { setCAccount(e.target.value); setCNumber(nextCheckFor(e.target.value)); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none">
                            {banks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}<option value="">Other / not listed</option>
                          </select></div>
                        <div><label className="block text-xs font-semibold text-slate-500 mb-1">Check #</label><input value={cNumber} onChange={(e) => setCNumber(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" style={{ width: 100 }} /></div>
                        <div><label className="block text-xs font-semibold text-slate-500 mb-1">Date</label><input type="date" value={cDate} onChange={(e) => setCDate(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" /></div>
                        <div style={{ flex: "1 1 160px" }}><label className="block text-xs font-semibold text-slate-500 mb-1">Payee</label><input value={cPayee} onChange={(e) => setCPayee(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" /></div>
                        <div><label className="block text-xs font-semibold text-slate-500 mb-1">Amount</label><input type="number" step="0.01" value={cAmount} onChange={(e) => setCAmount(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" style={{ width: 110 }} /></div>
                        <div style={{ flex: "1 1 160px" }}><label className="block text-xs font-semibold text-slate-500 mb-1">Memo</label><input value={cMemo} onChange={(e) => setCMemo(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" /></div>
                        <button onClick={() => addCheck()} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: "#e8622a" }}>Add</button>
                        <button onClick={() => setChkAdding(false)} className="text-sm text-slate-400 hover:underline pb-2">Close</button>
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
                      <th className="px-2 py-2 font-medium">Payee</th><th className="px-2 py-2 font-medium">Amount</th><th className="px-2 py-2 font-medium">Memo</th>
                      <th className="px-2 py-2 font-medium">Status</th><th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-slate-400">{checks.length === 0 ? "No checks logged yet." : "No checks match."}</td></tr>}
                    {shown.map((c) => (
                      <tr key={c.id} className="border-b border-slate-50" style={{ opacity: c.status === "void" ? 0.5 : 1 }}>
                        <td className="px-4 py-1.5 font-semibold text-slate-700 whitespace-nowrap">#{c.check_number}</td>
                        <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">{new Date(c.check_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}</td>
                        <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">{c.account_name || "—"}</td>
                        <td className="px-2 py-1.5 text-slate-700">{c.payee || "—"}</td>
                        <td className="px-2 py-1.5 text-slate-700 whitespace-nowrap">{c.amount != null ? money(c.amount) : "—"}</td>
                        <td className="px-2 py-1.5 text-xs text-slate-500">{c.memo}</td>
                        <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                          {finance ? (
                            <select value={c.status} onChange={(e) => setCheckStatus(c, e.target.value)} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-xs focus:outline-none">
                              <option value="outstanding">Outstanding</option><option value="cleared">Cleared</option><option value="void">Void</option>
                            </select>
                          ) : <span className="rounded-full px-2 py-0.5 font-semibold" style={{ background: c.status === "cleared" ? "#e7f6ec" : c.status === "void" ? "#f1f5f9" : "#fef3c7", color: c.status === "cleared" ? "#166534" : c.status === "void" ? "#475569" : "#92400e" }}>{c.status === "outstanding" ? "Outstanding" : c.status === "cleared" ? "Cleared" : "Void"}</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right">{finance && <button onClick={() => deleteCheck(c)} className="text-xs text-red-400 hover:text-red-600 hover:underline">Delete</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
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
              <label className="flex items-center gap-1.5 text-sm text-slate-600 pb-2"><input type="checkbox" checked={vExpects} onChange={(e) => setVExpects(e.target.checked)} /> Sends a monthly statement</label>
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
