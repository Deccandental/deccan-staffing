"use client";

import { useState, useEffect, useCallback } from "react";
import { formatMoney } from "@/lib/format";
import {
  CashAccount, CreditCard, RecurringBill, BalanceCheck,
  loadCashAccounts, loadCreditCards, addCashAccount, updateCashAccount, addCreditCard, updateCreditCard,
  updateRecurringBill, addBalanceCheck, renameBalanceHistory,
} from "@/lib/cashflow";
import { NumInput } from "@/components/CashHistory";

/**
 * Bank accounts and credit cards: add one, change its details, or close it.
 *
 * Closing never deletes anything. A closed account stops appearing on the Overview, in Update Numbers and
 * in the cash-needed figure, but its history and its filed statements stay put, and it can be reopened.
 * Closing a bank account first moves the scheduled bills and card payments that draw from it to another
 * account, so nothing is left paying from an account that no longer exists.
 */

const box = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none bg-white";
const lbl = "block text-xs font-semibold text-slate-500 mb-1";

type Mode = null | { kind: "bank"; id?: string } | { kind: "card"; id?: string };

export default function AccountsPanel({ allBills, latestBalances, refreshAll }: {
  allBills: RecurringBill[]; latestBalances: Record<string, BalanceCheck>; refreshAll: () => void;
}) {
  const [banks, setBanks] = useState<CashAccount[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [mode, setMode] = useState<Mode>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState<{ kind: "bank" | "card"; id: string; moveTo: string } | null>(null);

  // form fields (shared by add and edit)
  const [name, setName] = useState("");
  const [cushion, setCushion] = useState("");
  const [opening, setOpening] = useState("");
  const [limit, setLimit] = useState("");
  const [closeDay, setCloseDay] = useState("1");
  const [dueDay, setDueDay] = useState("1");
  const [minPay, setMinPay] = useState("");
  const [autopay, setAutopay] = useState("");
  const [paidFrom, setPaidFrom] = useState("");

  const load = useCallback(async () => {
    const [b, c] = await Promise.all([loadCashAccounts(true), loadCreditCards(true)]);
    setBanks(b); setCards(c);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openBanks = banks.filter((b) => b.active);
  const num = (v: string) => (v === "" || isNaN(Number(v)) ? 0 : Number(v));

  function startAdd(kind: "bank" | "card") {
    setMsg(""); setClosing(null);
    setName(""); setCushion(""); setOpening(""); setLimit(""); setCloseDay("1"); setDueDay("1"); setMinPay(""); setAutopay("");
    setPaidFrom(openBanks[0]?.id ?? "");
    setMode({ kind });
  }
  function startEdit(kind: "bank" | "card", id: string) {
    setMsg(""); setClosing(null);
    if (kind === "bank") {
      const a = banks.find((x) => x.id === id)!;
      setName(a.name); setCushion(String(a.cushionTarget));
    } else {
      const c = cards.find((x) => x.id === id)!;
      setName(c.name); setLimit(String(c.creditLimit)); setCloseDay(String(c.approxClosingDay)); setDueDay(String(c.dueDay));
      setMinPay(String(c.minimumPayment)); setAutopay(String(c.autopayAmount)); setPaidFrom(c.linkedCashAccountId ?? "");
    }
    setMode({ kind, id });
  }

  async function save() {
    if (!mode) return;
    const nm = name.trim();
    if (!nm) { setMsg("Enter a name."); return; }
    const taken = [...banks, ...cards].some((x) => x.name.trim().toLowerCase() === nm.toLowerCase() && x.id !== mode.id);
    if (taken) { setMsg("Another account or card already has that name."); return; }
    setBusy(true); setMsg("");
    if (mode.kind === "bank") {
      if (mode.id) {
        const old = banks.find((x) => x.id === mode.id)!;
        const r = await updateCashAccount(mode.id, { name: nm, cushionTarget: num(cushion) });
        if (!r.ok) { setBusy(false); setMsg(r.error ?? "Couldn't save."); return; }
        if (old.name !== nm) await renameBalanceHistory(old.name, nm);
      } else {
        const r = await addCashAccount(nm, num(cushion));
        if (!r.ok) { setBusy(false); setMsg(r.error ?? "Couldn't add the account."); return; }
        if (opening !== "" && !isNaN(Number(opening))) await addBalanceCheck(nm, Number(opening));
      }
    } else {
      const fields = { creditLimit: num(limit), approxClosingDay: Math.min(31, Math.max(1, num(closeDay) || 1)), dueDay: Math.min(31, Math.max(1, num(dueDay) || 1)), minimumPayment: num(minPay), autopayAmount: num(autopay), linkedCashAccountId: paidFrom || null };
      if (mode.id) {
        const old = cards.find((x) => x.id === mode.id)!;
        await updateCreditCard(mode.id, { name: nm, ...fields });
        if (old.name !== nm) await renameBalanceHistory(old.name, nm);
      } else {
        const r = await addCreditCard({ name: nm, ...fields });
        if (!r.ok) { setBusy(false); setMsg(r.error ?? "Couldn't add the card."); return; }
        if (opening !== "" && !isNaN(Number(opening))) await addBalanceCheck(nm, Number(opening));
      }
    }
    setBusy(false); setMode(null); setMsg(`${nm} saved.`);
    await load(); refreshAll();
  }

  async function confirmClose() {
    if (!closing) return;
    setBusy(true); setMsg("");
    if (closing.kind === "bank") {
      const billsHere = allBills.filter((b) => b.active && b.cashAccountId === closing.id);
      const cardsHere = cards.filter((c) => c.active && c.linkedCashAccountId === closing.id);
      if ((billsHere.length > 0 || cardsHere.length > 0) && !closing.moveTo) { setBusy(false); setMsg("Choose which account to move its bills and card payments to."); return; }
      for (const b of billsHere) await updateRecurringBill(b.id, { cashAccountId: closing.moveTo });
      for (const c of cardsHere) await updateCreditCard(c.id, { linkedCashAccountId: closing.moveTo });
      await updateCashAccount(closing.id, { active: false });
    } else {
      // A closed card's scheduled payments would otherwise keep showing up as obligations.
      for (const b of allBills.filter((x) => x.active && x.linkedCreditCardId === closing.id)) await updateRecurringBill(b.id, { active: false });
      await updateCreditCard(closing.id, { active: false });
    }
    setBusy(false); setClosing(null); setMsg("Closed. Its history and filed statements are kept, and you can reopen it any time.");
    await load(); refreshAll();
  }

  async function reopen(kind: "bank" | "card", id: string) {
    setBusy(true);
    if (kind === "bank") await updateCashAccount(id, { active: true }); else await updateCreditCard(id, { active: true });
    setBusy(false); setMsg("Reopened."); await load(); refreshAll();
  }

  const row = "grid items-center gap-x-3 py-1.5 border-b border-slate-50 last:border-0 text-sm";
  const closingBank = closing?.kind === "bank" ? banks.find((b) => b.id === closing.id) : null;
  const closingCard = closing?.kind === "card" ? cards.find((c) => c.id === closing.id) : null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Add a new bank account or card, change its details, or close one that's no longer used. Closing keeps all its history and filed statements.
      </p>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => startAdd("bank")} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>+ Add bank account</button>
        <button onClick={() => startAdd("card")} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#e8622a" }}>+ Add credit card</button>
      </div>

      {mode && (
        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
          <h3 className="font-bold text-sm text-slate-700">{mode.id ? "Edit" : "Add"} {mode.kind === "bank" ? "bank account" : "credit card"}</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className={lbl}>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder={mode.kind === "bank" ? "e.g. Wells Fargo Checking" : "e.g. Amex 1234"} className={box} /></div>
            {mode.kind === "bank" ? (
              <div><label className={lbl}>Cushion target</label><NumInput value={cushion} onChange={(e) => setCushion(e.target.value)} onFocus={(e) => e.target.select()} className={box} /></div>
            ) : (
              <>
                <div><label className={lbl}>Credit limit</label><NumInput value={limit} onChange={(e) => setLimit(e.target.value)} onFocus={(e) => e.target.select()} className={box} /></div>
                <div><label className={lbl}>Paid from</label>
                  <select value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)} className={box}>
                    <option value="">Not set</option>
                    {openBanks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div><label className={lbl}>Statement closes (day of month)</label><input type="number" min={1} max={31} value={closeDay} onChange={(e) => setCloseDay(e.target.value)} className={box} /></div>
                <div><label className={lbl}>Payment due (day of month)</label><input type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} className={box} /></div>
                <div><label className={lbl}>Minimum payment</label><NumInput value={minPay} onChange={(e) => setMinPay(e.target.value)} onFocus={(e) => e.target.select()} className={box} /></div>
                <div><label className={lbl}>Autopay amount</label><NumInput value={autopay} onChange={(e) => setAutopay(e.target.value)} onFocus={(e) => e.target.select()} className={box} /></div>
              </>
            )}
            {!mode.id && (
              <div><label className={lbl}>Opening balance (optional)</label><NumInput value={opening} onChange={(e) => setOpening(e.target.value)} onFocus={(e) => e.target.select()} className={box} /></div>
            )}
          </div>
          {mode.id && <p className="text-xs text-slate-400">Renaming moves this account's balance history with it.</p>}
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={busy} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: "#e8622a" }}>{busy ? "Saving…" : "Save"}</button>
            <button onClick={() => { setMode(null); setMsg(""); }} className="text-sm text-slate-400 hover:underline">Cancel</button>
          </div>
        </div>
      )}

      {closing && (closingBank || closingCard) && (
        <div className="rounded-xl px-4 py-3 text-sm space-y-2" style={{ background: "#FAEEDA", color: "#854F0B", border: "1px solid #f2d3a0" }}>
          <p className="font-semibold">Close {closingBank?.name ?? closingCard?.name}?</p>
          {closingBank && (() => {
            const billsHere = allBills.filter((b) => b.active && b.cashAccountId === closingBank.id);
            const cardsHere = cards.filter((c) => c.active && c.linkedCashAccountId === closingBank.id);
            const bal = latestBalances[closingBank.name]?.balance;
            return (
              <>
                {bal != null && Math.abs(bal) > 0.5 && <p>Its last entered balance is <strong>${formatMoney(bal)}</strong>. Move that money and enter a zero balance first, or Cash Flow will stop counting it.</p>}
                {(billsHere.length > 0 || cardsHere.length > 0) ? (
                  <div>
                    <p>{billsHere.length} scheduled bill{billsHere.length === 1 ? "" : "s"} and {cardsHere.length} card{cardsHere.length === 1 ? "" : "s"} pay from this account. Move them to:</p>
                    <select value={closing.moveTo} onChange={(e) => setClosing({ ...closing, moveTo: e.target.value })} className="mt-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none text-slate-800">
                      <option value="">Choose an account…</option>
                      {openBanks.filter((b) => b.id !== closingBank.id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                ) : <p>Nothing is scheduled to pay from it.</p>}
              </>
            );
          })()}
          {closingCard && <p>Its scheduled payments ({allBills.filter((b) => b.active && b.linkedCreditCardId === closingCard.id).length}) will be paused. History and statements are kept.</p>}
          <div className="flex items-center gap-3">
            <button onClick={confirmClose} disabled={busy} className="rounded-lg px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "#b45309" }}>{busy ? "Working…" : "Close it"}</button>
            <button onClick={() => { setClosing(null); setMsg(""); }} className="text-xs underline">Cancel</button>
          </div>
        </div>
      )}
      {msg && <p className="text-xs font-semibold text-slate-600">{msg}</p>}

      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Bank accounts</p>
        {banks.length === 0 && <p className="text-xs text-slate-400">None yet.</p>}
        {banks.map((a) => (
          <div key={a.id} className={row} style={{ gridTemplateColumns: "minmax(160px,1fr) 150px 160px", opacity: a.active ? 1 : 0.55 }}>
            <span className="font-medium text-slate-700 truncate">{a.name}{!a.active && <span className="ml-2 text-xs font-normal text-slate-400">closed</span>}</span>
            <span className="text-xs text-slate-500">Cushion ${formatMoney(a.cushionTarget)}</span>
            <span className="text-right text-xs whitespace-nowrap">
              {a.active && <button onClick={() => startEdit("bank", a.id)} className="text-orange-500 hover:underline mr-3">Edit</button>}
              {a.active ? <button onClick={() => { setMode(null); setMsg(""); setClosing({ kind: "bank", id: a.id, moveTo: "" }); }} className="text-slate-400 hover:text-red-500 hover:underline">Close</button>
                : <button onClick={() => reopen("bank", a.id)} className="text-orange-500 hover:underline">Reopen</button>}
            </span>
          </div>
        ))}
      </div>

      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Credit cards</p>
        {cards.length === 0 && <p className="text-xs text-slate-400">None yet.</p>}
        {cards.map((c) => (
          <div key={c.id} className={row} style={{ gridTemplateColumns: "minmax(160px,1fr) 150px 160px", opacity: c.active ? 1 : 0.55 }}>
            <span className="font-medium text-slate-700 truncate">{c.name}{!c.active && <span className="ml-2 text-xs font-normal text-slate-400">closed</span>}</span>
            <span className="text-xs text-slate-500">Limit ${formatMoney(c.creditLimit)} · due day {c.dueDay}</span>
            <span className="text-right text-xs whitespace-nowrap">
              {c.active && <button onClick={() => startEdit("card", c.id)} className="text-orange-500 hover:underline mr-3">Edit</button>}
              {c.active ? <button onClick={() => { setMode(null); setMsg(""); setClosing({ kind: "card", id: c.id, moveTo: "" }); }} className="text-slate-400 hover:text-red-500 hover:underline">Close</button>
                : <button onClick={() => reopen("card", c.id)} className="text-orange-500 hover:underline">Reopen</button>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
