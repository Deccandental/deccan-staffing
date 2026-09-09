import { supabase } from "./supabase";

export type BillFrequency = "weekly" | "biweekly" | "monthly";
export type BillCategory = "bill" | "payroll";

export interface RecurringBill {
  id: string;
  name: string;
  estimatedAmount: number;
  frequency: BillFrequency;
  anchorDate: string; // YYYY-MM-DD — first/reference due date
  category: BillCategory;
  categoryLabel?: string; // free-text label, e.g. "Rent", "Lab", "Loan Pymt"
  active: boolean;
}

export interface BillPayment {
  id: string;
  recurringBillId: string;
  dueDate: string;
  actualAmount: number;
}

export interface BalanceCheck {
  id: string;
  balance: number;
  checkedAt: string;
}

export interface Occurrence {
  billId: string;
  billName: string;
  category: BillCategory;
  categoryLabel?: string;
  dueDate: string;
  amount: number;
  isPaid: boolean;
  paymentId?: string;
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

function parseLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(dateStr: string, days: number): string {
  const d = parseLocal(dateStr);
  d.setDate(d.getDate() + days);
  return toStr(d);
}

export function addMonthsToDate(dateStr: string, months: number): string {
  const d = parseLocal(dateStr);
  d.setMonth(d.getMonth() + months);
  return toStr(d);
}

// ---------------- CRUD: recurring bills ----------------

function fromBillRow(row: any): RecurringBill {
  return {
    id: row.id, name: row.name, estimatedAmount: row.estimated_amount,
    frequency: row.frequency, anchorDate: row.anchor_date, category: row.category ?? "bill",
    categoryLabel: row.category_label ?? undefined, active: row.active ?? true,
  };
}

export async function loadRecurringBills(): Promise<RecurringBill[]> {
  const { data, error } = await supabase.from("recurring_bills").select("*").order("name");
  if (error) { console.error("loadRecurringBills error:", error); return []; }
  return (data ?? []).map(fromBillRow);
}

export async function addRecurringBill(bill: Omit<RecurringBill, "id">): Promise<RecurringBill | null> {
  const { data, error } = await supabase.from("recurring_bills").insert({
    name: bill.name, estimated_amount: bill.estimatedAmount, frequency: bill.frequency,
    anchor_date: bill.anchorDate, category: bill.category, category_label: bill.categoryLabel ?? null, active: bill.active,
  }).select().single();
  if (error) { console.error("addRecurringBill error:", error); return null; }
  return fromBillRow(data);
}

export async function updateRecurringBill(id: string, updates: Partial<Omit<RecurringBill, "id">>): Promise<void> {
  const payload: any = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.estimatedAmount !== undefined) payload.estimated_amount = updates.estimatedAmount;
  if (updates.frequency !== undefined) payload.frequency = updates.frequency;
  if (updates.anchorDate !== undefined) payload.anchor_date = updates.anchorDate;
  if (updates.category !== undefined) payload.category = updates.category;
  if (updates.categoryLabel !== undefined) payload.category_label = updates.categoryLabel;
  if (updates.active !== undefined) payload.active = updates.active;
  const { error } = await supabase.from("recurring_bills").update(payload).eq("id", id);
  if (error) console.error("updateRecurringBill error:", error);
}

export async function deleteRecurringBill(id: string): Promise<void> {
  const { error } = await supabase.from("recurring_bills").delete().eq("id", id);
  if (error) console.error("deleteRecurringBill error:", error);
}

// ---------------- CRUD: bill payments (actuals) ----------------

function fromPaymentRow(row: any): BillPayment {
  return { id: row.id, recurringBillId: row.recurring_bill_id, dueDate: row.due_date, actualAmount: row.actual_amount };
}

export async function loadBillPayments(startDate: string, endDate: string): Promise<BillPayment[]> {
  const { data, error } = await supabase.from("bill_payments").select("*")
    .gte("due_date", startDate).lte("due_date", endDate);
  if (error) { console.error("loadBillPayments error:", error); return []; }
  return (data ?? []).map(fromPaymentRow);
}

export async function saveBillPayment(recurringBillId: string, dueDate: string, actualAmount: number): Promise<void> {
  const { error } = await supabase.from("bill_payments").upsert({
    recurring_bill_id: recurringBillId, due_date: dueDate, actual_amount: actualAmount,
  }, { onConflict: "recurring_bill_id,due_date" });
  if (error) console.error("saveBillPayment error:", error);
}

export async function deleteBillPayment(recurringBillId: string, dueDate: string): Promise<void> {
  const { error } = await supabase.from("bill_payments").delete()
    .eq("recurring_bill_id", recurringBillId).eq("due_date", dueDate);
  if (error) console.error("deleteBillPayment error:", error);
}

// ---------------- CRUD: balance check-ins ----------------

function fromBalanceRow(row: any): BalanceCheck {
  return { id: row.id, balance: row.balance, checkedAt: row.checked_at };
}

export async function loadLatestBalance(): Promise<BalanceCheck | null> {
  const { data, error } = await supabase.from("balance_checks").select("*").order("checked_at", { ascending: false }).limit(1).maybeSingle();
  if (error) { console.error("loadLatestBalance error:", error); return null; }
  return data ? fromBalanceRow(data) : null;
}

export async function loadBalanceHistory(limit: number = 20): Promise<BalanceCheck[]> {
  const { data, error } = await supabase.from("balance_checks").select("*").order("checked_at", { ascending: false }).limit(limit);
  if (error) { console.error("loadBalanceHistory error:", error); return []; }
  return (data ?? []).map(fromBalanceRow);
}

export async function addBalanceCheck(balance: number): Promise<void> {
  const { error } = await supabase.from("balance_checks").insert({ balance, checked_at: new Date().toISOString() });
  if (error) console.error("addBalanceCheck error:", error);
}

// ---------------- Settings ----------------

export async function loadMinComfortableBalance(): Promise<number> {
  const { data, error } = await supabase.from("cashflow_settings").select("*").eq("id", 1).maybeSingle();
  if (error) { console.error("loadMinComfortableBalance error:", error); return 5000; }
  return data?.min_comfortable_balance ?? 5000;
}

export async function saveMinComfortableBalance(amount: number): Promise<void> {
  const { error } = await supabase.from("cashflow_settings").upsert({ id: 1, min_comfortable_balance: amount });
  if (error) console.error("saveMinComfortableBalance error:", error);
}

// ---------------- Schedule computation ----------------

export function computeDueDatesInRange(bill: RecurringBill, startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  if (bill.frequency === "monthly") {
    let cursor = bill.anchorDate;
    let guard = 0;
    while (cursor < startDate && guard < 240) { cursor = addMonthsToDate(cursor, 1); guard++; }
    guard = 0;
    while (cursor <= endDate && guard < 240) { dates.push(cursor); cursor = addMonthsToDate(cursor, 1); guard++; }
  } else {
    const stepDays = bill.frequency === "biweekly" ? 14 : 7;
    let cursor = bill.anchorDate;
    let guard = 0;
    while (cursor < startDate && guard < 2000) { cursor = addDays(cursor, stepDays); guard++; }
    guard = 0;
    while (cursor <= endDate && guard < 2000) { dates.push(cursor); cursor = addDays(cursor, stepDays); guard++; }
  }
  return dates;
}

// Builds the full occurrence list (every due bill/payroll draw) within a
// window, using the actual paid amount wherever one's been recorded and
// falling back to the estimated amount otherwise.
export function buildOccurrences(bills: RecurringBill[], payments: BillPayment[], startDate: string, endDate: string): Occurrence[] {
  const paymentMap = new Map<string, BillPayment>();
  payments.forEach((p) => paymentMap.set(`${p.recurringBillId}|${p.dueDate}`, p));

  const occurrences: Occurrence[] = [];
  for (const bill of bills.filter((b) => b.active)) {
    for (const dueDate of computeDueDatesInRange(bill, startDate, endDate)) {
      const payment = paymentMap.get(`${bill.id}|${dueDate}`);
      occurrences.push({
        billId: bill.id, billName: bill.name, category: bill.category, categoryLabel: bill.categoryLabel, dueDate,
        amount: payment ? payment.actualAmount : bill.estimatedAmount,
        isPaid: !!payment, paymentId: payment?.id,
      });
    }
  }
  return occurrences.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

// ---------------- Projection ----------------

export interface ProjectionPoint { date: string; balance: number }

export function projectBalance(startBalance: number, startDate: string, occurrences: Occurrence[], daysAhead: number): ProjectionPoint[] {
  const points: ProjectionPoint[] = [];
  let balance = startBalance;
  const sorted = [...occurrences].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  let idx = 0;
  for (let d = 0; d <= daysAhead; d++) {
    const date = addDays(startDate, d);
    while (idx < sorted.length && sorted[idx].dueDate === date) { balance -= sorted[idx].amount; idx++; }
    points.push({ date, balance });
  }
  return points;
}

// Current balance minus everything due in the next N days — the single
// "what can I actually spend right now" number.
export function computeSafeToSpend(startBalance: number, startDate: string, occurrences: Occurrence[], daysAhead: number): number {
  const cutoff = addDays(startDate, daysAhead);
  const upcoming = occurrences.filter((o) => o.dueDate > startDate && o.dueDate <= cutoff);
  return startBalance - upcoming.reduce((sum, o) => sum + o.amount, 0);
}

export interface BillCheckResult {
  safe: boolean;
  projectedBalance: number;
  suggestedDate: string | null;
  suggestedBalance: number | null;
}

// Checks whether paying `amount` on `payDate` keeps the projected balance
// at/above the comfort threshold; if not, scans forward for the next date
// (within maxDaysAhead) where it would be.
export function checkBillPayment(
  startBalance: number, startDate: string, occurrences: Occurrence[],
  amount: number, payDate: string, minComfortable: number, maxDaysAhead: number = 60
): BillCheckResult {
  const horizon = Math.max(maxDaysAhead, Math.round((parseLocal(payDate).getTime() - parseLocal(startDate).getTime()) / 86400000) + 1);
  const points = projectBalance(startBalance, startDate, occurrences, horizon);

  function balanceOnOrBefore(date: string): number {
    let bal = startBalance;
    for (const p of points) { if (p.date <= date) bal = p.balance; else break; }
    return bal;
  }

  const projectedBalance = balanceOnOrBefore(payDate) - amount;
  if (projectedBalance >= minComfortable) {
    return { safe: true, projectedBalance, suggestedDate: null, suggestedBalance: null };
  }
  for (let d = 1; d <= maxDaysAhead; d++) {
    const candidate = addDays(payDate, d);
    const bal = balanceOnOrBefore(candidate) - amount;
    if (bal >= minComfortable) {
      return { safe: false, projectedBalance, suggestedDate: candidate, suggestedBalance: bal };
    }
  }
  return { safe: false, projectedBalance, suggestedDate: null, suggestedBalance: null };
}
