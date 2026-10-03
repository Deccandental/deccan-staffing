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

// How a dental-practice CPA would bucket the practice's debt. The split
// matters because lenders judge the FIXED obligations (acquisition, real
// estate, equipment) against collections, while cards and the line of credit
// swing monthly and would distort that picture.
export type DebtCategory = "acquisition" | "real_estate" | "equipment" | "line_of_credit" | "card" | "other";

export const CATEGORY_LABEL: Record<DebtCategory, string> = {
  acquisition: "Practice acquisition",
  real_estate: "Real estate / build-out",
  equipment: "Equipment",
  line_of_credit: "Line of credit",
  card: "Credit card",
  other: "Other",
};
export const CATEGORY_SHORT: Record<DebtCategory, string> = {
  acquisition: "Acquisition", real_estate: "Real estate", equipment: "Equipment",
  line_of_credit: "Line of credit", card: "Card", other: "Other",
};
// Categories offered when adding a loan (cards come from the Credit Cards list).
export const LOAN_CATEGORIES: DebtCategory[] = ["acquisition", "real_estate", "equipment", "line_of_credit", "other"];
// Long-term, fixed-payment obligations — the ones debt service is measured on.
export const FIXED_CATEGORIES: DebtCategory[] = ["acquisition", "real_estate", "equipment"];
const CATEGORY_ORDER: DebtCategory[] = ["card", "acquisition", "real_estate", "equipment", "line_of_credit", "other"];
export const categoryRank = (c: DebtCategory) => CATEGORY_ORDER.indexOf(c);

export type RateType = "fixed" | "variable";

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
  category: DebtCategory;
  rateType: RateType | null;       // fixed or variable rate (loans)
  prepayPenalty: boolean;          // paying early costs a penalty (loans)
  paidInFullMonthly: boolean;      // cards: balance is cleared every month, so it isn't carried debt
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
    category: (row.category as DebtCategory) ?? (row.kind === "revolving" ? "card" : "other"),
    rateType: (row.rate_type as RateType) ?? null,
    prepayPenalty: row.prepay_penalty ?? false,
    paidInFullMonthly: row.paid_in_full ?? false,
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
    category: d.kind === "revolving" ? "card" : d.category,
    rate_type: d.kind === "revolving" ? null : d.rateType,
    prepay_penalty: d.kind === "revolving" ? false : d.prepayPenalty,
    paid_in_full: d.kind === "revolving" ? d.paidInFullMonthly : false,
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
  counted: boolean;         // false for a card that's paid in full monthly — shown, but not carried debt
}

export interface CategoryTotal { category: DebtCategory; balance: number; payment: number; interest: number; count: number }

export interface DebtSummary {
  lines: DebtLine[];
  totalBalance: number;
  totalMonthlyPayment: number;
  totalMonthlyInterest: number;
  debtServiceRate: number | null; // monthly payments as a % of monthly collections
  worstFirst: DebtLine[];         // where a spare dollar does most good (see computeDebtSummary)
  skippedForPenalty: number;      // loans left out of worstFirst because paying early costs a penalty
  categories: CategoryTotal[];    // counted debt only, in display order
  fixedServiceMonthly: number;    // acquisition + real estate + equipment payments
  fixedServiceRate: number | null;// …as a % of monthly collections
  paidMonthlyBalance: number;     // cards cleared every month — informational, not debt
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
    // A card cleared in full every month carries no interest and isn't debt.
    const paidMonthly = debt.kind === "revolving" && debt.paidInFullMonthly;
    const monthlyInterest = paidMonthly ? 0 : balance * ((debt.interestRate ?? 0) / 100 / 12);
    const payment = debt.monthlyPayment;
    const payoffMonths = paidMonthly ? 0 : monthsToPayOff(balance, debt.interestRate, payment);
    return {
      debt, balance, monthlyInterest, monthlyPayment: payment,
      principalPerMonth: Math.max(0, payment - monthlyInterest),
      payoffMonths,
      neverClears: !paidMonthly && balance > 0 && payment > 0 && payoffMonths === null,
      counted: !paidMonthly,
    };
  });

  const counted = lines.filter((l) => l.counted);
  const totalBalance = counted.reduce((s, l) => s + l.balance, 0);
  const totalMonthlyPayment = counted.reduce((s, l) => s + l.monthlyPayment, 0);
  const totalMonthlyInterest = counted.reduce((s, l) => s + l.monthlyInterest, 0);
  const rateOf = (amt: number) => (monthlyCollections && monthlyCollections > 0 ? (amt / monthlyCollections) * 100 : null);

  const byCat = new Map<DebtCategory, CategoryTotal>();
  for (const l of counted) {
    const c = l.debt.category;
    const t = byCat.get(c) ?? { category: c, balance: 0, payment: 0, interest: 0, count: 0 };
    t.balance += l.balance; t.payment += l.monthlyPayment; t.interest += l.monthlyInterest; t.count += 1;
    byCat.set(c, t);
  }
  const categories = [...byCat.values()].sort((a, b) => categoryRank(a.category) - categoryRank(b.category));
  const fixedServiceMonthly = counted.filter((l) => FIXED_CATEGORIES.includes(l.debt.category)).reduce((s, l) => s + l.monthlyPayment, 0);

  // Where a spare dollar goes furthest: revolving debt that's actually costing
  // interest (carried cards, the line of credit) first, then everything else
  // by rate. Loans with a prepayment penalty are left out — paying early
  // there has a cost the rate alone doesn't show.
  const candidates = counted.filter((l) => l.balance > 0);
  const eligible = candidates.filter((l) => !l.debt.prepayPenalty);
  const revolvingCosting = (l: DebtLine) => (l.debt.category === "card" || l.debt.category === "line_of_credit") && (l.debt.interestRate ?? 0) > 0 ? 0 : 1;
  const worstFirst = [...eligible].sort((a, b) =>
    revolvingCosting(a) - revolvingCosting(b) || (b.debt.interestRate ?? 0) - (a.debt.interestRate ?? 0));

  return {
    lines,
    totalBalance,
    totalMonthlyPayment,
    totalMonthlyInterest,
    debtServiceRate: rateOf(totalMonthlyPayment),
    worstFirst,
    skippedForPenalty: candidates.length - eligible.length,
    categories,
    fixedServiceMonthly,
    fixedServiceRate: rateOf(fixedServiceMonthly),
    paidMonthlyBalance: lines.filter((l) => !l.counted).reduce((s, l) => s + l.balance, 0),
  };
}

// ---------------- Statement log for loans ----------------
// Cards already keep one in card_statement_entries; loans get the same shape
// so every debt can carry a statement balance labelled by the month it covers.

export interface DebtStatementEntry {
  id: string;
  debtId: string;
  month: string; // YYYY-MM
  balance: number;
  enteredAt: string;
}

function fromStatementRow(row: any): DebtStatementEntry {
  return { id: row.id, debtId: row.debt_id, month: row.month, balance: row.balance, enteredAt: row.entered_at };
}

export async function loadDebtStatements(debtId: string): Promise<DebtStatementEntry[]> {
  const { data, error } = await supabase.from("debt_statement_entries").select("*").eq("debt_id", debtId).order("month", { ascending: false });
  if (error) { console.error("loadDebtStatements error:", error); return []; }
  return (data ?? []).map(fromStatementRow);
}

export async function saveDebtStatement(debtId: string, month: string, balance: number): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("debt_statement_entries").upsert(
    { debt_id: debtId, month, balance, entered_at: new Date().toISOString() },
    { onConflict: "debt_id,month" },
  );
  if (error) { console.error("saveDebtStatement error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

export async function deleteDebtStatement(id: string): Promise<void> {
  const { error } = await supabase.from("debt_statement_entries").delete().eq("id", id);
  if (error) console.error("deleteDebtStatement error:", error);
}

export async function updateDebtStatementAmount(id: string, balance: number): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("debt_statement_entries").update({ balance }).eq("id", id);
  if (error) { console.error("updateDebtStatementAmount error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}
