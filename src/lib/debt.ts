import { supabase } from "./supabase";

/**
 * The practice's debt in one place.
 *
 * Card balances and loan payments already existed, but scattered: cards on
 * one tab, loan payments indistinguishable from any other recurring bill,
 * and no interest rate recorded anywhere. That made two questions
 * unanswerable — what the debt costs to carry each month, and which one to
 * put a spare dollar against.
 */

export type DebtKind = "installment" | "revolving";

export interface Debt {
  id: string;
  name: string;
  kind: DebtKind;
  creditCardId: string | null;
  originalAmount: number;
  currentBalance: number;
  // null means no rate recorded yet; 0 is a real rate — a 0% introductory
  // card genuinely costs nothing to carry, and shouldn't be confused with
  // one whose rate nobody has entered.
  interestRate: number | null;   // annual %
  monthlyPayment: number;
  finalPaymentDate: string | null;
  lender: string;
  notes: string;
  active: boolean;
  sortOrder: number;
}

function fromRow(row: any): Debt {
  return {
    id: row.id, name: row.name, kind: row.kind ?? "installment",
    creditCardId: row.credit_card_id ?? null,
    originalAmount: row.original_amount ?? 0,
    currentBalance: row.current_balance ?? 0,
    interestRate: row.interest_rate === null || row.interest_rate === undefined ? null : Number(row.interest_rate),
    monthlyPayment: row.monthly_payment ?? 0,
    finalPaymentDate: row.final_payment_date ?? null,
    lender: row.lender ?? "", notes: row.notes ?? "",
    active: row.active ?? true, sortOrder: row.sort_order ?? 0,
  };
}

export async function loadDebts(): Promise<Debt[]> {
  const { data, error } = await supabase.from("debts").select("*").order("sort_order").order("name");
  if (error) { console.error("loadDebts error:", error); return []; }
  return (data ?? []).map(fromRow);
}

export async function saveDebt(d: Omit<Debt, "id"> & { id?: string }): Promise<{ ok: boolean; error?: string }> {
  const payload = {
    ...(d.id ? { id: d.id } : {}),
    name: d.name, kind: d.kind, credit_card_id: d.creditCardId,
    original_amount: d.originalAmount, current_balance: d.currentBalance,
    interest_rate: d.interestRate, monthly_payment: d.monthlyPayment,
    final_payment_date: d.finalPaymentDate || null,
    lender: d.lender, notes: d.notes, active: d.active, sort_order: d.sortOrder,
  };
  const { error } = await supabase.from("debts").upsert(payload);
  if (error) { console.error("saveDebt error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

export async function deleteDebt(id: string): Promise<void> {
  const { error } = await supabase.from("debts").delete().eq("id", id);
  if (error) console.error("deleteDebt error:", error);
}

// ---------------- Calculations ----------------

export interface DebtLine {
  debt: Debt;
  balance: number;          // revolving reads through to the linked card
  monthlyInterest: number;  // what this debt costs simply to carry, this month
  monthlyPayment: number;
  principalPerMonth: number; // payment less interest — what actually reduces the balance
  payoffMonths: number | null; // null when the payment never clears the interest
  neverClears: boolean;     // payment is at or below the monthly interest
}

export interface DebtSummary {
  lines: DebtLine[];
  totalBalance: number;
  totalMonthlyPayment: number;
  totalMonthlyInterest: number;
  debtServiceRate: number | null; // monthly payments as a % of monthly collections
  worstFirst: DebtLine[];         // highest rate first — where a spare dollar does most good
}

/**
 * Months to clear a balance at a fixed monthly payment, allowing for
 * interest. Returns null where the payment never clears it, which is the
 * case worth surfacing rather than hiding behind a large number.
 */
export function monthsToPayOff(balance: number, annualRate: number | null, payment: number): number | null {
  if (balance <= 0) return 0;
  if (payment <= 0) return null;
  const r = (annualRate ?? 0) / 100 / 12;
  if (r === 0) return Math.ceil(balance / payment);
  const monthlyInterest = balance * r;
  if (payment <= monthlyInterest) return null; // never clears
  return Math.ceil(-Math.log(1 - (balance * r) / payment) / Math.log(1 + r));
}

export function computeDebtSummary(
  debts: Debt[],
  cardBalances: Record<string, number>, // credit card id → current balance
  monthlyCollections?: number | null
): DebtSummary {
  const lines: DebtLine[] = debts.filter((d) => d.active).map((debt) => {
    const balance = debt.kind === "revolving" && debt.creditCardId
      ? cardBalances[debt.creditCardId] ?? 0
      : debt.currentBalance;
    const monthlyInterest = balance * ((debt.interestRate ?? 0) / 100 / 12);
    const payment = debt.monthlyPayment;
    const payoffMonths = monthsToPayOff(balance, debt.interestRate, payment);
    return {
      debt, balance, monthlyInterest, monthlyPayment: payment,
      principalPerMonth: Math.max(0, payment - monthlyInterest),
      payoffMonths,
      neverClears: balance > 0 && payment > 0 && payoffMonths === null,
    };
  });

  const totalBalance = lines.reduce((s, l) => s + l.balance, 0);
  const totalMonthlyPayment = lines.reduce((s, l) => s + l.monthlyPayment, 0);
  const totalMonthlyInterest = lines.reduce((s, l) => s + l.monthlyInterest, 0);

  return {
    lines,
    totalBalance,
    totalMonthlyPayment,
    totalMonthlyInterest,
    debtServiceRate: monthlyCollections && monthlyCollections > 0
      ? (totalMonthlyPayment / monthlyCollections) * 100
      : null,
    // Highest rate first: with balances carrying, the rate decides where an
    // extra payment buys the most, regardless of balance size.
    worstFirst: [...lines].filter((l) => l.balance > 0).sort((a, b) => (b.debt.interestRate ?? 0) - (a.debt.interestRate ?? 0)),
  };
}
