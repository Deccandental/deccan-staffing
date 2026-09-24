import { supabase } from "./supabase";

export type BillFrequency = "weekly" | "biweekly" | "monthly" | "once";
export type BillCategory = "bill" | "payroll";
export type BillDirection = "outflow" | "inflow";

export interface RecurringBill {
  id: string;
  name: string;
  estimatedAmount: number;
  frequency: BillFrequency;
  anchorDate: string;
  category: BillCategory;
  categoryLabel?: string;
  active: boolean;
  cashAccountId: string | null;
  direction: BillDirection;
  essential: boolean; // essential (rent, payroll, loans, card minimums) vs discretionary
  linkedCreditCardId?: string | null; // set when this bill IS a card payment
}

export interface BillPayment {
  id: string;
  recurringBillId: string;
  dueDate: string;
  actualAmount: number;
}

export interface BalanceCheck {
  id: string;
  accountName: string;
  balance: number;
  checkedAt: string;
}

// ---------------- Cash accounts (Fifth Third, Chase) ----------------

export interface CashAccount {
  id: string;
  name: string;
  cushionTarget: number;
  sortOrder: number;
  statementBalance: number;
  statementBalanceUpdatedAt: string | null;
}

function fromCashAccountRow(row: any): CashAccount {
  return {
    id: row.id, name: row.name, cushionTarget: row.cushion_target, sortOrder: row.sort_order ?? 0,
    statementBalance: row.statement_balance ?? 0, statementBalanceUpdatedAt: row.statement_balance_updated_at ?? null,
  };
}

export async function loadCashAccounts(): Promise<CashAccount[]> {
  const { data, error } = await supabase.from("cash_accounts").select("*").order("sort_order");
  if (error) { console.error("loadCashAccounts error:", error); return []; }
  const accounts: CashAccount[] = (data ?? []).map(fromCashAccountRow);
  const { data: latestEntries, error: entriesError } = await supabase
    .from("bank_statement_entries").select("*").order("month", { ascending: false });
  if (entriesError) { console.error("loadCashAccounts (statement entries) error:", entriesError); return accounts; }
  const latestByAccount = new Map<string, any>();
  for (const row of latestEntries ?? []) {
    if (!latestByAccount.has(row.cash_account_id)) latestByAccount.set(row.cash_account_id, row);
  }
  return accounts.map((a) => {
    const latest = latestByAccount.get(a.id);
    if (!latest) return a;
    return { ...a, statementBalance: latest.balance, statementBalanceUpdatedAt: latest.entered_at };
  });
}

export async function updateCashAccountCushion(id: string, cushionTarget: number): Promise<void> {
  const { error } = await supabase.from("cash_accounts").update({ cushion_target: cushionTarget }).eq("id", id);
  if (error) console.error("updateCashAccountCushion error:", error);
}

export interface BankStatementEntry {
  id: string;
  cashAccountId: string;
  month: string; // YYYY-MM
  balance: number;
  enteredAt: string;
}

function fromBankStatementEntryRow(row: any): BankStatementEntry {
  return { id: row.id, cashAccountId: row.cash_account_id, month: row.month, balance: row.balance, enteredAt: row.entered_at };
}

// Updates a bank account's "current" statement balance snapshot and also
// records it into the monthly history log — mirroring how credit card
// statement balances work. Defaults to the current calendar month unless
// backfilling a specific past one.
export async function updateBankStatementBalance(cashAccountId: string, balance: number, month?: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("cash_accounts").update({ statement_balance: balance, statement_balance_updated_at: new Date().toISOString() }).eq("id", cashAccountId);
  if (error) { console.error("updateBankStatementBalance error:", error); return { ok: false, error: error.message }; }
  const targetMonth = month ?? new Date().toISOString().slice(0, 7);
  const { error: histError } = await supabase.from("bank_statement_entries").upsert({
    cash_account_id: cashAccountId, month: targetMonth, balance, entered_at: new Date().toISOString(),
  }, { onConflict: "cash_account_id,month" });
  if (histError) { console.error("updateBankStatementBalance (history) error:", histError); return { ok: false, error: histError.message }; }
  return { ok: true };
}

export async function loadStatementHistoryForAccount(cashAccountId: string): Promise<BankStatementEntry[]> {
  const { data, error } = await supabase.from("bank_statement_entries").select("*").eq("cash_account_id", cashAccountId).order("month", { ascending: false });
  if (error) { console.error("loadStatementHistoryForAccount error:", error); return []; }
  return (data ?? []).map(fromBankStatementEntryRow);
}

// Backfills or corrects a specific past month's bank statement balance
// without touching the account's "current" snapshot fields.
export async function backfillBankStatementMonth(cashAccountId: string, month: string, balance: number): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("bank_statement_entries").upsert({
    cash_account_id: cashAccountId, month, balance, entered_at: new Date().toISOString(),
  }, { onConflict: "cash_account_id,month" });
  if (error) { console.error("backfillBankStatementMonth error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

export async function deleteBankStatementEntry(id: string): Promise<void> {
  const { error } = await supabase.from("bank_statement_entries").delete().eq("id", id);
  if (error) console.error("deleteBankStatementEntry error:", error);
}

// ---------------- Credit cards ----------------

export interface CreditCard {
  id: string;
  name: string;
  creditLimit: number;
  linkedCashAccountId: string | null; // which bank account this card's payment drafts from
  approxClosingDay: number; // best-guess day-of-month the statement closes
  dueDay: number; // day-of-month payment is due
  minimumPayment: number;
  autopayAmount: number; // currently-scheduled autopay/billpayer amount
  statementBalance: number;
  statementBalanceUpdatedAt: string | null;
  sortOrder: number;
}

function fromCreditCardRow(row: any): CreditCard {
  return {
    id: row.id, name: row.name, creditLimit: row.credit_limit, linkedCashAccountId: row.linked_cash_account_id ?? null,
    approxClosingDay: row.approx_closing_day, dueDay: row.due_day, minimumPayment: row.minimum_payment,
    autopayAmount: row.autopay_amount ?? 0, statementBalance: row.statement_balance ?? 0,
    statementBalanceUpdatedAt: row.statement_balance_updated_at, sortOrder: row.sort_order ?? 0,
  };
}

export async function loadCreditCards(): Promise<CreditCard[]> {
  const { data, error } = await supabase.from("credit_cards").select("*").order("sort_order");
  if (error) { console.error("loadCreditCards error:", error); return []; }
  const cards: CreditCard[] = (data ?? []).map(fromCreditCardRow);
  // Derive "current" statement balance from the most recent entry in the
  // history table, rather than trusting a separately-maintained field —
  // this is the only way to guarantee it can never drift out of sync with
  // what Trends shows.
  const { data: latestEntries, error: entriesError } = await supabase
    .from("card_statement_entries").select("*").order("month", { ascending: false });
  if (entriesError) { console.error("loadCreditCards (statement entries) error:", entriesError); return cards; }
  const latestByCard = new Map<string, any>();
  for (const row of latestEntries ?? []) {
    if (!latestByCard.has(row.credit_card_id)) latestByCard.set(row.credit_card_id, row);
  }
  return cards.map((c) => {
    const latest = latestByCard.get(c.id);
    if (!latest) return c;
    return { ...c, statementBalance: latest.balance, statementBalanceUpdatedAt: latest.entered_at };
  });
}

export async function updateCreditCard(id: string, updates: Partial<{ creditLimit: number; approxClosingDay: number; dueDay: number; minimumPayment: number; autopayAmount: number }>): Promise<void> {
  const payload: any = {};
  if (updates.creditLimit !== undefined) payload.credit_limit = updates.creditLimit;
  if (updates.approxClosingDay !== undefined) payload.approx_closing_day = updates.approxClosingDay;
  if (updates.dueDay !== undefined) payload.due_day = updates.dueDay;
  if (updates.minimumPayment !== undefined) payload.minimum_payment = updates.minimumPayment;
  if (updates.autopayAmount !== undefined) payload.autopay_amount = updates.autopayAmount;
  const { error } = await supabase.from("credit_cards").update(payload).eq("id", id);
  if (error) console.error("updateCreditCard error:", error);
}

export async function updateStatementBalance(id: string, balance: number, month?: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("credit_cards").update({ statement_balance: balance, statement_balance_updated_at: new Date().toISOString() }).eq("id", id);
  if (error) { console.error("updateStatementBalance error:", error); return { ok: false, error: error.message }; }
  // Also record this into the monthly history log, defaulting to the
  // current calendar month unless backfilling a specific past one.
  const targetMonth = month ?? new Date().toISOString().slice(0, 7);
  const { error: histError } = await supabase.from("card_statement_entries").upsert({
    credit_card_id: id, month: targetMonth, balance, entered_at: new Date().toISOString(),
  }, { onConflict: "credit_card_id,month" });
  if (histError) { console.error("updateStatementBalance (history) error:", histError); return { ok: false, error: histError.message }; }
  return { ok: true };
}

export interface CardStatementEntry {
  id: string;
  creditCardId: string;
  month: string; // YYYY-MM
  balance: number;
  enteredAt: string;
}

function fromStatementEntryRow(row: any): CardStatementEntry {
  return { id: row.id, creditCardId: row.credit_card_id, month: row.month, balance: row.balance, enteredAt: row.entered_at };
}

export async function loadStatementHistoryForCard(creditCardId: string): Promise<CardStatementEntry[]> {
  const { data, error } = await supabase.from("card_statement_entries").select("*").eq("credit_card_id", creditCardId).order("month", { ascending: false });
  if (error) { console.error("loadStatementHistoryForCard error:", error); return []; }
  return (data ?? []).map(fromStatementEntryRow);
}

// Backfills or corrects a specific past month's statement balance without
// touching the card's "current" snapshot fields.
export async function backfillStatementMonth(creditCardId: string, month: string, balance: number): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("card_statement_entries").upsert({
    credit_card_id: creditCardId, month, balance, entered_at: new Date().toISOString(),
  }, { onConflict: "credit_card_id,month" });
  if (error) { console.error("backfillStatementMonth error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

export async function deleteStatementEntry(id: string): Promise<void> {
  const { error } = await supabase.from("card_statement_entries").delete().eq("id", id);
  if (error) console.error("deleteStatementEntry error:", error);
}

// ---------------- Card charges (itemized recurring vendor activity — informational only) ----------------

export interface CardCharge {
  id: string;
  creditCardId: string;
  vendor: string;
  typicalAmount: number;
  approxDayOfMonth: number;
  notes?: string;
  active: boolean;
}

function fromCardChargeRow(row: any): CardCharge {
  return {
    id: row.id, creditCardId: row.credit_card_id, vendor: row.vendor, typicalAmount: row.typical_amount,
    approxDayOfMonth: row.approx_day_of_month, notes: row.notes ?? undefined, active: row.active ?? true,
  };
}

export async function loadCardCharges(): Promise<CardCharge[]> {
  const { data, error } = await supabase.from("card_charges").select("*").order("approx_day_of_month");
  if (error) { console.error("loadCardCharges error:", error); return []; }
  return (data ?? []).map(fromCardChargeRow);
}

export async function addCardCharge(charge: Omit<CardCharge, "id">): Promise<void> {
  const { error } = await supabase.from("card_charges").insert({
    credit_card_id: charge.creditCardId, vendor: charge.vendor, typical_amount: charge.typicalAmount,
    approx_day_of_month: charge.approxDayOfMonth, notes: charge.notes ?? null, active: charge.active,
  });
  if (error) console.error("addCardCharge error:", error);
}

export async function updateCardCharge(id: string, updates: Partial<Omit<CardCharge, "id" | "creditCardId">>): Promise<void> {
  const payload: any = {};
  if (updates.vendor !== undefined) payload.vendor = updates.vendor;
  if (updates.typicalAmount !== undefined) payload.typical_amount = updates.typicalAmount;
  if (updates.approxDayOfMonth !== undefined) payload.approx_day_of_month = updates.approxDayOfMonth;
  if (updates.notes !== undefined) payload.notes = updates.notes;
  if (updates.active !== undefined) payload.active = updates.active;
  const { error } = await supabase.from("card_charges").update(payload).eq("id", id);
  if (error) console.error("updateCardCharge error:", error);
}

export async function deleteCardCharge(id: string): Promise<void> {
  const { error } = await supabase.from("card_charges").delete().eq("id", id);
  if (error) console.error("deleteCardCharge error:", error);
}

// Projects a card's balance forward by applying each active charge's next
// occurrence(s) within the window — a simple monthly-recurrence model.
export function projectCardCharges(charges: CardCharge[], cardId: string, fromDate: string, daysAhead: number): number {
  const relevant = charges.filter((c) => c.creditCardId === cardId && c.active);
  const from = parseLocal(fromDate);
  let total = 0;
  for (const charge of relevant) {
    for (let d = 1; d <= daysAhead; d++) {
      const date = new Date(from);
      date.setDate(date.getDate() + d);
      if (date.getDate() === charge.approxDayOfMonth) total += charge.typicalAmount;
    }
  }
  return total;
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
  cashAccountId: string | null;
  direction: BillDirection;
  essential: boolean;
  linkedCreditCardId?: string | null;
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

// Days from `fromDate` to the next occurrence of `dayOfMonth` (0 if today).
export function daysUntilDayOfMonth(fromDate: string, dayOfMonth: number): number {
  const from = parseLocal(fromDate);
  const candidate = new Date(from.getFullYear(), from.getMonth(), dayOfMonth);
  if (candidate < from) candidate.setMonth(candidate.getMonth() + 1);
  return Math.round((candidate.getTime() - from.getTime()) / 86400000);
}

// ---------------- CRUD: recurring bills / expected transactions ----------------

function fromBillRow(row: any): RecurringBill {
  return {
    id: row.id, name: row.name, estimatedAmount: row.estimated_amount,
    frequency: row.frequency, anchorDate: row.anchor_date, category: row.category ?? "bill",
    categoryLabel: row.category_label ?? undefined, active: row.active ?? true,
    cashAccountId: row.cash_account_id ?? null, direction: row.direction ?? "outflow",
    essential: row.essential ?? true, linkedCreditCardId: row.linked_credit_card_id ?? null,
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
    cash_account_id: bill.cashAccountId, direction: bill.direction, essential: bill.essential,
    linked_credit_card_id: bill.linkedCreditCardId ?? null,
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
  if (updates.cashAccountId !== undefined) payload.cash_account_id = updates.cashAccountId;
  if (updates.direction !== undefined) payload.direction = updates.direction;
  if (updates.essential !== undefined) payload.essential = updates.essential;
  if (updates.linkedCreditCardId !== undefined) payload.linked_credit_card_id = updates.linkedCreditCardId;
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
  return { id: row.id, accountName: row.account_name, balance: row.balance, checkedAt: row.checked_at };
}

export async function loadLatestBalances(): Promise<Record<string, BalanceCheck>> {
  const { data, error } = await supabase.from("balance_checks").select("*").order("checked_at", { ascending: false });
  if (error) { console.error("loadLatestBalances error:", error); return {}; }
  const latest: Record<string, BalanceCheck> = {};
  for (const row of data ?? []) {
    const bc = fromBalanceRow(row);
    if (!latest[bc.accountName]) latest[bc.accountName] = bc;
  }
  return latest;
}

export async function loadBalanceHistory(limit: number = 20): Promise<BalanceCheck[]> {
  const { data, error } = await supabase.from("balance_checks").select("*").order("checked_at", { ascending: false }).limit(limit);
  if (error) { console.error("loadBalanceHistory error:", error); return []; }
  return (data ?? []).map(fromBalanceRow);
}

// History for one specific account/card, most recent first.
export async function loadBalanceHistoryForAccount(accountName: string, limit: number = 20): Promise<BalanceCheck[]> {
  const { data, error } = await supabase.from("balance_checks").select("*").eq("account_name", accountName).order("checked_at", { ascending: false }).limit(limit);
  if (error) { console.error("loadBalanceHistoryForAccount error:", error); return []; }
  return (data ?? []).map(fromBalanceRow);
}

export async function deleteBalanceCheck(id: string): Promise<void> {
  const { error } = await supabase.from("balance_checks").delete().eq("id", id);
  if (error) console.error("deleteBalanceCheck error:", error);
}

export async function addBalanceCheck(accountName: string, balance: number, checkedAt?: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("balance_checks").insert({ account_name: accountName, balance, checked_at: checkedAt ?? new Date().toISOString() });
  if (error) { console.error("addBalanceCheck error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

// ---------------- Weekly Friday Cash Review ----------------

export interface WeeklyCashReview {
  id: string;
  reviewDate: string;
  projectedTotalProduction: number | null;
  currentIncome: number | null;
  currentPatientIncome: number | null;
  notes: string;
}

function fromReviewRow(row: any): WeeklyCashReview {
  return {
    id: row.id, reviewDate: row.review_date,
    projectedTotalProduction: row.projected_total_production, currentIncome: row.current_income,
    currentPatientIncome: row.current_patient_income, notes: row.notes ?? "",
  };
}

export async function loadLatestWeeklyReview(): Promise<WeeklyCashReview | null> {
  const { data, error } = await supabase.from("weekly_cash_reviews").select("*").order("review_date", { ascending: false }).limit(1).maybeSingle();
  if (error) { console.error("loadLatestWeeklyReview error:", error); return null; }
  return data ? fromReviewRow(data) : null;
}

export async function loadWeeklyReviewHistory(limit: number = 12): Promise<WeeklyCashReview[]> {
  const { data, error } = await supabase.from("weekly_cash_reviews").select("*").order("review_date", { ascending: false }).limit(limit);
  if (error) { console.error("loadWeeklyReviewHistory error:", error); return []; }
  return (data ?? []).map(fromReviewRow);
}

export async function saveWeeklyReview(review: Omit<WeeklyCashReview, "id">): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("weekly_cash_reviews").upsert({
    review_date: review.reviewDate, projected_total_production: review.projectedTotalProduction,
    current_income: review.currentIncome, current_patient_income: review.currentPatientIncome, notes: review.notes,
  }, { onConflict: "review_date" });
  if (error) { console.error("saveWeeklyReview error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

export async function deleteWeeklyReview(id: string): Promise<void> {
  const { error } = await supabase.from("weekly_cash_reviews").delete().eq("id", id);
  if (error) console.error("deleteWeeklyReview error:", error);
}

// ---------------- Open Dental monthly history (separate from daily running numbers) ----------------

export interface DentalMonthlyEntry {
  id: string;
  month: string; // YYYY-MM
  netProduction: number | null;
  enteredAt: string;
}

function fromDentalMonthlyRow(row: any): DentalMonthlyEntry {
  return { id: row.id, month: row.month, netProduction: row.net_production, enteredAt: row.entered_at };
}

export async function loadDentalMonthlyHistory(): Promise<DentalMonthlyEntry[]> {
  const { data, error } = await supabase.from("dental_monthly_entries").select("*").order("month", { ascending: false });
  if (error) { console.error("loadDentalMonthlyHistory error:", error); return []; }
  return (data ?? []).map(fromDentalMonthlyRow);
}

// Backfills or corrects a specific month's official Net Production figure.
// Entirely separate from the daily running numbers on Update Numbers.
export async function backfillDentalMonth(month: string, netProduction: number | null): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("dental_monthly_entries").upsert({
    month, net_production: netProduction, entered_at: new Date().toISOString(),
  }, { onConflict: "month" });
  if (error) { console.error("backfillDentalMonth error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

export async function deleteDentalMonthlyEntry(id: string): Promise<void> {
  const { error } = await supabase.from("dental_monthly_entries").delete().eq("id", id);
  if (error) console.error("deleteDentalMonthlyEntry error:", error);
}

// ---------------- Open Dental — historical monthly summary ----------------
// Deliberately a separate table from weekly_cash_reviews: that one holds the
// day-to-day RUNNING figures shown on Update Numbers (which keep changing
// until the month closes), while this one holds the locked-in HISTORICAL
// figure for a finished month, used for Trends. Keeping them apart means a
// running update and a historical entry can never collide on the same date.

export interface DentalMonthlySummary {
  id: string;
  month: string; // YYYY-MM
  projectedTotalProduction: number | null;
  currentIncome: number | null;
  currentPatientIncome: number | null;
  enteredAt: string;
}

function fromDentalSummaryRow(row: any): DentalMonthlySummary {
  return {
    id: row.id, month: row.month,
    projectedTotalProduction: row.projected_total_production, currentIncome: row.current_income,
    currentPatientIncome: row.current_patient_income, enteredAt: row.entered_at,
  };
}

export async function loadDentalMonthlySummaries(): Promise<DentalMonthlySummary[]> {
  const { data, error } = await supabase.from("dental_monthly_summary").select("*").order("month", { ascending: false });
  if (error) { console.error("loadDentalMonthlySummaries error:", error); return []; }
  return (data ?? []).map(fromDentalSummaryRow);
}

export async function saveDentalMonthlySummary(
  month: string, projectedTotalProduction: number | null, currentIncome: number | null, currentPatientIncome: number | null
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("dental_monthly_summary").upsert({
    month, projected_total_production: projectedTotalProduction, current_income: currentIncome,
    current_patient_income: currentPatientIncome, entered_at: new Date().toISOString(),
  }, { onConflict: "month" });
  if (error) { console.error("saveDentalMonthlySummary error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

export async function deleteDentalMonthlySummary(id: string): Promise<void> {
  const { error } = await supabase.from("dental_monthly_summary").delete().eq("id", id);
  if (error) console.error("deleteDentalMonthlySummary error:", error);
}


// ---------------- Schedule computation ----------------

export function computeDueDatesInRange(bill: RecurringBill, startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  if (bill.frequency === "once") {
    if (bill.anchorDate >= startDate && bill.anchorDate <= endDate) dates.push(bill.anchorDate);
    return dates;
  }
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
        isPaid: !!payment, paymentId: payment?.id, cashAccountId: bill.cashAccountId, direction: bill.direction,
        essential: bill.essential, linkedCreditCardId: bill.linkedCreditCardId,
      });
    }
  }
  return occurrences.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function signedAmount(o: Occurrence): number {
  return o.direction === "inflow" ? o.amount : -o.amount;
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
    while (idx < sorted.length && sorted[idx].dueDate === date) { balance += signedAmount(sorted[idx]); idx++; }
    points.push({ date, balance });
  }
  return points;
}

export function computeSafeToSpend(startBalance: number, startDate: string, occurrences: Occurrence[], daysAhead: number): number {
  const cutoff = addDays(startDate, daysAhead);
  const upcoming = occurrences.filter((o) => o.dueDate > startDate && o.dueDate <= cutoff);
  return startBalance + upcoming.reduce((sum, o) => sum + signedAmount(o), 0);
}

export interface BillCheckResult {
  safe: boolean;
  projectedBalance: number;
  suggestedDate: string | null;
  suggestedBalance: number | null;
}

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

// ---------------- Per-account forecast & transfer suggestion ----------------

export interface AccountForecast {
  accountId: string;
  accountName: string;
  currentBalance: number;
  expectedDeposits14d: number;
  obligations14d: number;
  requiredCardFunding: number;
  cushion: number;
  excessOrShortfall: number;
}

export function computeAccountForecast(
  account: CashAccount, currentBalance: number,
  occurrences: Occurrence[], startDate: string, requiredCardFunding: number
): AccountForecast {
  const cutoff = addDays(startDate, 14);
  const inWindow = occurrences.filter((o) => o.cashAccountId === account.id && o.dueDate > startDate && o.dueDate <= cutoff);
  const expectedDeposits14d = inWindow.filter((o) => o.direction === "inflow").reduce((sum, o) => sum + o.amount, 0);
  const obligations14d = inWindow.filter((o) => o.direction === "outflow").reduce((sum, o) => sum + o.amount, 0);
  const excessOrShortfall = currentBalance + expectedDeposits14d - obligations14d - requiredCardFunding - account.cushionTarget;
  return {
    accountId: account.id, accountName: account.name, currentBalance, expectedDeposits14d,
    obligations14d, requiredCardFunding, cushion: account.cushionTarget, excessOrShortfall,
  };
}

export interface TransferSuggestion {
  fromAccountName: string | null;
  toAccountName: string | null;
  amount: number;
  reason: string;
}

export function computeSuggestedTransfer(ff: AccountForecast, chase: AccountForecast): TransferSuggestion {
  if (ff.excessOrShortfall < 0 && chase.excessOrShortfall > 0) {
    const amount = Math.min(-ff.excessOrShortfall, chase.excessOrShortfall);
    return { fromAccountName: chase.accountName, toAccountName: ff.accountName, amount: Math.round(amount), reason: `${ff.accountName} is projected short; ${chase.accountName} has excess above its own requirement.` };
  }
  if (chase.excessOrShortfall < 0 && ff.excessOrShortfall > 0) {
    const amount = Math.min(-chase.excessOrShortfall, ff.excessOrShortfall);
    return { fromAccountName: ff.accountName, toAccountName: chase.accountName, amount: Math.round(amount), reason: `${chase.accountName} is projected short; ${ff.accountName} has excess above its own requirement.` };
  }
  if (ff.excessOrShortfall < 0 && chase.excessOrShortfall < 0) {
    return { fromAccountName: null, toAccountName: null, amount: 0, reason: "Both accounts are projected short — this is a genuine cash shortfall, not a transfer situation." };
  }
  return { fromAccountName: null, toAccountName: null, amount: 0, reason: "No transfer needed — both accounts cover their own requirement." };
}

// ---------------- Card payment recommendations ----------------

export interface CardRecommendation {
  cardId: string;
  cardName: string;
  daysUntilClosing: number;
  daysUntilDue: number;
  currentBalance: number;
  projectedCharges14d: number;
  projectedBalance: number;
  overLimitRisk: boolean;
  availableCredit: number;
  statementBalance: number;
  statementStale: boolean; // not updated in 7+ days
  urgentMinimumDue: boolean; // due within 3 days
  suggestedExtraPayment: number; // beyond scheduled minimum/autopay, if linked account has spare cash
}

export function computeCardRecommendation(
  card: CreditCard, currentBalance: number, charges: CardCharge[], today: string,
  linkedAccountForecast: AccountForecast | null
): CardRecommendation {
  const daysUntilClosing = daysUntilDayOfMonth(today, card.approxClosingDay);
  const daysUntilDue = daysUntilDayOfMonth(today, card.dueDay);
  const projectedCharges14d = projectCardCharges(charges, card.id, today, 14);
  const projectedBalance = currentBalance + projectedCharges14d;
  const overLimitRisk = projectedBalance > card.creditLimit * 0.95;
  const availableCredit = card.creditLimit - currentBalance;
  const statementStale = !card.statementBalanceUpdatedAt || (Date.now() - new Date(card.statementBalanceUpdatedAt).getTime()) / 86400000 > 7;
  const urgentMinimumDue = daysUntilDue <= 3;

  let suggestedExtraPayment = 0;
  if (linkedAccountForecast && linkedAccountForecast.excessOrShortfall > 0) {
    suggestedExtraPayment = Math.round(Math.min(linkedAccountForecast.excessOrShortfall, card.statementBalance));
  }

  return {
    cardId: card.id, cardName: card.name, daysUntilClosing, daysUntilDue, currentBalance,
    projectedCharges14d, projectedBalance, overLimitRisk, availableCredit,
    statementBalance: card.statementBalance, statementStale, urgentMinimumDue, suggestedExtraPayment,
  };
}

// ---------------- Required collection rate ----------------

export interface RequiredCollectionsResult {
  totalObligations: number; // every outflow scheduled this calendar month, both accounts
  totalCushions: number; // both accounts' cushion targets combined
  combinedCurrentBalance: number;
  knownInflows: number; // any inflow-type transactions already scheduled this month
  requiredCollections: number; // $ still needed to collect this month to cover obligations + cushions
  requiredCollectionRate: number | null; // requiredCollections as a % of projected production, null if none entered
}

// "How much of this month's projected production actually needs to convert
// into real collections to cover every obligation on both accounts, plus
// both cushions?" — a genuine collection-rate health check, not a pace
// comparison against a fixed monthly target.
export function computeRequiredCollections(
  ffAccount: CashAccount, chaseAccount: CashAccount,
  ffBalance: number, chaseBalance: number,
  monthOccurrences: Occurrence[],
  projectedProduction: number | null
): RequiredCollectionsResult {
  const totalObligations = monthOccurrences.filter((o) => o.direction === "outflow").reduce((sum, o) => sum + o.amount, 0);
  const knownInflows = monthOccurrences.filter((o) => o.direction === "inflow").reduce((sum, o) => sum + o.amount, 0);
  const totalCushions = ffAccount.cushionTarget + chaseAccount.cushionTarget;
  const combinedCurrentBalance = ffBalance + chaseBalance;
  const requiredCollections = Math.max(0, totalObligations + totalCushions - combinedCurrentBalance - knownInflows);
  const requiredCollectionRate = projectedProduction && projectedProduction > 0 ? (requiredCollections / projectedProduction) * 100 : null;
  return { totalObligations, totalCushions, combinedCurrentBalance, knownInflows, requiredCollections, requiredCollectionRate };
}

// ---------------- Accounts Receivable (A/R) aging ----------------
// Standard dental/medical A/R aging buckets: 0-30, 31-60, 61-90, 90+ days.
// One entry per date, meant to be updated weekly — A/R shifts too slowly
// for daily tracking but often enough to catch a bucket sliding into 90+
// before it becomes uncollectable.

export interface ArAgingEntry {
  id: string;
  entryDate: string; // YYYY-MM-DD
  ar0to30: number;
  ar31to60: number;
  ar61to90: number;
  ar90plus: number;
  woEstimate: number; // estimated write-offs, subtracted from the raw 4-bucket sum to get "True A/R"
  insuranceEstimate: number; // manually entered; patient estimate is always derived as True A/R - this
  enteredAt: string;
}

function fromArAgingRow(row: any): ArAgingEntry {
  return {
    id: row.id, entryDate: row.entry_date,
    ar0to30: row.ar_0_30, ar31to60: row.ar_31_60, ar61to90: row.ar_61_90, ar90plus: row.ar_90_plus,
    woEstimate: row.wo_estimate ?? 0, insuranceEstimate: row.insurance_estimate ?? 0,
    enteredAt: row.entered_at,
  };
}

export async function loadLatestArAging(): Promise<ArAgingEntry | null> {
  const { data, error } = await supabase.from("ar_aging_entries").select("*").order("entry_date", { ascending: false }).limit(1).maybeSingle();
  if (error) { console.error("loadLatestArAging error:", error); return null; }
  return data ? fromArAgingRow(data) : null;
}

export async function loadArAgingHistory(limit: number = 26): Promise<ArAgingEntry[]> {
  const { data, error } = await supabase.from("ar_aging_entries").select("*").order("entry_date", { ascending: false }).limit(limit);
  if (error) { console.error("loadArAgingHistory error:", error); return []; }
  return (data ?? []).map(fromArAgingRow);
}

export async function saveArAgingEntry(entry: Omit<ArAgingEntry, "id" | "enteredAt">): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("ar_aging_entries").upsert({
    entry_date: entry.entryDate, ar_0_30: entry.ar0to30, ar_31_60: entry.ar31to60,
    ar_61_90: entry.ar61to90, ar_90_plus: entry.ar90plus,
    wo_estimate: entry.woEstimate, insurance_estimate: entry.insuranceEstimate,
    entered_at: new Date().toISOString(),
  }, { onConflict: "entry_date" });
  if (error) { console.error("saveArAgingEntry error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

export async function deleteArAgingEntry(id: string): Promise<void> {
  const { error } = await supabase.from("ar_aging_entries").delete().eq("id", id);
  if (error) console.error("deleteArAgingEntry error:", error);
}

export interface ArHealthResult {
  totalAr: number; // True A/R — the 4 buckets less the write-off estimate
  rawTotal: number; // the 4 buckets before write-offs
  writeOffs: number;
  pctCurrent: number; // % in 0-30
  pctOver60: number; // % in 61-90 + 90+
  pctOver90: number; // % in 90+ alone
  arRatio: number | null; // True A/R ÷ average monthly production — target ~1.0, concerning above 1.5
  daysInAr: number | null; // True A/R ÷ average net daily production — industry average ~45 days
  status: "good" | "fair" | "poor";
  reasons: string[];
}

// Benchmarks: healthy practices keep 70%+ of AR in the 0-30 bucket, no more
// than 10% past 60 days combined, and no more than 5% in the 90+ bucket alone.
export function computeArHealth(
  entry: { ar0to30: number; ar31to60: number; ar61to90: number; ar90plus: number; woEstimate?: number },
  avgMonthlyProduction?: number | null
): ArHealthResult {
  const rawTotal = entry.ar0to30 + entry.ar31to60 + entry.ar61to90 + entry.ar90plus;
  const writeOffs = entry.woEstimate ?? 0;
  const trueAr = Math.max(0, rawTotal - writeOffs);
  if (rawTotal <= 0) {
    return { totalAr: 0, rawTotal: 0, writeOffs: 0, pctCurrent: 0, pctOver60: 0, pctOver90: 0, arRatio: null, daysInAr: null, status: "good", reasons: [] };
  }

  // Write-offs are entered as one figure rather than per bucket, so they're
  // taken off the oldest balances first — that's where uncollectable money
  // almost always sits. Measuring the aging percentages against what's left
  // means they describe money still worth chasing, rather than counting
  // balances already conceded as lost.
  let remaining = writeOffs;
  const net = (amount: number) => {
    const applied = Math.min(remaining, amount);
    remaining -= applied;
    return amount - applied;
  };
  const adj90plus = net(entry.ar90plus);
  const adj61to90 = net(entry.ar61to90);
  const adj31to60 = net(entry.ar31to60);
  const adj0to30 = net(entry.ar0to30);
  const adjTotal = adj0to30 + adj31to60 + adj61to90 + adj90plus;

  const pctCurrent = adjTotal > 0 ? (adj0to30 / adjTotal) * 100 : 0;
  const pctOver60 = adjTotal > 0 ? ((adj61to90 + adj90plus) / adjTotal) * 100 : 0;
  const pctOver90 = adjTotal > 0 ? (adj90plus / adjTotal) * 100 : 0;
  const arRatio = avgMonthlyProduction && avgMonthlyProduction > 0 ? trueAr / avgMonthlyProduction : null;
  const daysInAr = arRatio != null ? arRatio * 30 : null;

  const reasons: string[] = [];
  if (pctCurrent < 70) reasons.push(`Only ${pctCurrent.toFixed(0)}% of collectable A/R is current (0-30 days) — target is 70%+`);
  if (pctOver60 > 10) reasons.push(`${pctOver60.toFixed(0)}% of collectable A/R is over 60 days — target is under 10%`);
  if (pctOver90 > 5) reasons.push(`${pctOver90.toFixed(0)}% of collectable A/R is over 90 days — target is under 5%`);
  if (arRatio != null && arRatio > 1.5) reasons.push(`A/R Ratio is ${arRatio.toFixed(2)} — target is around 1.0, concerning above 1.5`);
  if (daysInAr != null && daysInAr > 45) reasons.push(`Days in A/R is ${daysInAr.toFixed(0)} — industry average is around 45`);

  const status: ArHealthResult["status"] = reasons.length === 0 ? "good" : (pctOver90 > 5 || pctCurrent < 55 || (arRatio != null && arRatio > 2)) ? "poor" : "fair";
  return { totalAr: trueAr, rawTotal, writeOffs, pctCurrent, pctOver60, pctOver90, arRatio, daysInAr, status, reasons };
}

// Averages the most recent N months of logged Net Production (from the
// Trends tab's monthly entries) to use as the denominator for A/R Ratio and
// Days in A/R — a steadier figure than a single month's running total.
export function computeAvgMonthlyProduction(history: DentalMonthlyEntry[], monthsToAverage: number = 3): number | null {
  const withProduction = [...history].sort((a, b) => b.month.localeCompare(a.month)).filter((e) => e.netProduction != null).slice(0, monthsToAverage);
  if (withProduction.length === 0) return null;
  const sum = withProduction.reduce((total, e) => total + (e.netProduction as number), 0);
  return sum / withProduction.length;
}
