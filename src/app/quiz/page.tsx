"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import AppIdentityGate, { AppIdentity } from "@/components/AppIdentityGate";
import { Sidebar } from "@/components/Sidebar";
import { getSessionToken } from "@/lib/secureData";
import { LETTERS, KIND_LABEL, QuestionKind } from "@/lib/quiz";

/**
 * Live Quiz, phone side. The host runs the quiz on the big screen; everyone answers here.
 * The page checks in every couple of seconds, so it follows the host without anyone refreshing.
 */

interface Opt { i: number; text: string }
interface PublicQ { id: string; kind: QuestionKind; prompt: string; hint: string | null; options: Opt[]; correct?: number[]; explanation?: string | null }
interface State {
  live: boolean;
  quiz?: { id: string; title: string; phase: "lobby" | "question" | "review" | "final"; revealMode: "end" | "each"; currentIndex: number };
  total?: number;
  players?: string[];
  current?: { index: number; question: PublicQ; answeredCount: number; myAnswer: number[] | null; myCorrect?: boolean | null; correctCount?: number; optionCounts?: number[] } | null;
  leaderboard?: { name: string; score: number; rank: number }[];
  me?: { score: number; rank: number; of: number } | null;
}

const ORANGE = "#e8622a";
const GREEN = "#16a34a";

async function api(body: Record<string, unknown>): Promise<{ ok: boolean; json: any }> {
  try {
    const res = await fetch("/api/quiz/play", { method: "POST", headers: { "Content-Type": "application/json", "x-session-token": getSessionToken() }, body: JSON.stringify(body) });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch { return { ok: false, json: { error: "Couldn't reach the server." } }; }
}

function QuizBody({ identity }: { identity: AppIdentity }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<number[]>([]);   // what's selected on screen, before or after sending
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const shownFor = useRef<string>("");

  const poll = useCallback(async () => {
    const r = await api({ action: "state" });
    if (!r.ok) { setError(r.json.error ?? "Couldn't load the quiz."); return; }
    setError("");
    setState(r.json);
  }, []);

  useEffect(() => {
    if (identity.mode !== "staff") return;
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [identity.mode, poll]);

  // When a new question appears, start from your saved answer (if any) or a clean slate.
  const qKey = state?.current ? `${state.quiz?.phase}:${state.current.question.id}` : "";
  useEffect(() => {
    if (!qKey || qKey === shownFor.current) return;
    shownFor.current = qKey;
    setPicked(state?.current?.myAnswer ?? []);
    setMsg("");
  }, [qKey, state]);

  async function send(answer: number[]) {
    if (!state?.current) return;
    setSaving(true); setMsg("");
    const r = await api({ action: "answer", questionId: state.current.question.id, answer });
    setSaving(false);
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't save your answer."); return; }
    poll();
  }

  if (identity.mode !== "staff") {
    return (
      <Shell>
        <Card>The quiz is played under each person's own PIN so scores are theirs. Log off and log back in with your own PIN to play. To run the quiz, use <a href="/quiz-admin" className="font-semibold underline" style={{ color: ORANGE }}>Quiz Builder</a>.</Card>
      </Shell>
    );
  }
  if (error) return <Shell><Card><span className="text-red-600 font-semibold">⚠️ {error}</span></Card></Shell>;
  if (!state) return <Shell><p className="text-slate-400 text-sm">Loading…</p></Shell>;

  if (!state.live || !state.quiz) {
    return (
      <Shell>
        <Card>
          <div className="text-5xl mb-3">🎯</div>
          <p className="font-semibold text-slate-700">No quiz running right now.</p>
          <p className="text-sm text-slate-500 mt-1">Keep this page open. When the host starts a quiz, it will show up here by itself.</p>
        </Card>
      </Shell>
    );
  }

  const { quiz, current, total = 0 } = state;

  if (quiz.phase === "lobby") {
    return (
      <Shell title={quiz.title}>
        <Card>
          <div className="text-5xl mb-3">🙌</div>
          <p className="text-lg font-bold text-slate-700">You're in, {identity.employeeName?.split(" ")[0]}!</p>
          <p className="text-sm text-slate-500 mt-1">{total} questions. The first one shows up here as soon as the host starts.</p>
          <p className="text-xs text-slate-400 mt-4">{state.players?.length ?? 0} playing so far</p>
        </Card>
      </Shell>
    );
  }

  if (quiz.phase === "final") {
    const top = (state.leaderboard ?? []).slice(0, 3);
    return (
      <Shell title={quiz.title}>
        <Card>
          <div className="text-5xl mb-2">{state.me?.rank === 1 ? "🏆" : "🎉"}</div>
          <p className="text-sm text-slate-500">Your score</p>
          <p className="text-5xl font-extrabold mt-1" style={{ color: ORANGE, fontFamily: "'Poppins', sans-serif" }}>{state.me?.score ?? 0}<span className="text-2xl text-slate-400"> / {total}</span></p>
          {state.me && <p className="text-sm text-slate-600 mt-2">You placed <b>#{state.me.rank}</b> of {state.me.of}.</p>}
        </Card>
        {top.length > 0 && (
          <div className="rounded-2xl bg-white shadow p-4 mt-4">
            <p className="font-bold text-slate-700 mb-2">Top of the board</p>
            {top.map((s) => (
              <div key={s.name} className="flex items-center gap-3 py-1.5">
                <span className="w-7 text-center text-lg">{s.rank === 1 ? "🥇" : s.rank === 2 ? "🥈" : s.rank === 3 ? "🥉" : `#${s.rank}`}</span>
                <span className="flex-1 font-semibold text-slate-700">{s.name}</span>
                <span className="font-bold" style={{ color: ORANGE }}>{s.score}</span>
              </div>
            ))}
          </div>
        )}
      </Shell>
    );
  }

  if (!current) return <Shell title={quiz.title}><Card>Waiting for the host…</Card></Shell>;
  const q = current.question;
  const reviewing = quiz.phase === "review";
  const sent = current.myAnswer;
  const sameAsSent = !!sent && sent.length === picked.length && sent.every((v, i) => v === picked[i]);

  function tap(i: number) {
    if (reviewing || saving) return;
    if (q.kind === "single") { setPicked([i]); send([i]); return; }
    if (q.kind === "multi") { setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i])); return; }
    // order: tap the steps in sequence
    setPicked((p) => (p.includes(i) ? p.slice(0, p.indexOf(i)) : [...p, i]));
  }

  const correctSet = new Set(q.correct ?? []);
  const letterOf = (orig: number) => LETTERS[q.options.findIndex((o) => o.i === orig)] ?? "?";

  return (
    <Shell title={quiz.title}>
      <div className="flex items-center justify-between mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        <span>{reviewing ? "Answer" : "Question"} {current.index + 1} of {total}</span>
        <span>{KIND_LABEL[q.kind]}</span>
      </div>
      <div className="rounded-2xl bg-white shadow p-5">
        <p className="text-lg font-bold text-slate-800 leading-snug">{q.prompt}</p>
        {q.hint && <p className="text-sm text-slate-500 italic mt-2">Clue: {q.hint}</p>}

        {q.kind === "order" && !reviewing && (
          <p className="text-xs text-slate-500 mt-3">Tap the steps in the order they happen. Tap a numbered step again to undo from there.</p>
        )}

        <div className="mt-4 space-y-2">
          {q.options.map((o, pos) => {
            const chosen = picked.includes(o.i);
            const orderNum = q.kind === "order" ? picked.indexOf(o.i) + 1 : 0;
            const right = reviewing && q.kind !== "order" && correctSet.has(o.i);
            const wrongPick = reviewing && q.kind !== "order" && chosen && !correctSet.has(o.i);
            let bg = "#f8fafc", border = "#e2e8f0", color = "#334155";
            if (chosen && !reviewing) { bg = "#fff4ec"; border = ORANGE; color = "#9a3412"; }
            if (right) { bg = "#ecfdf3"; border = GREEN; color = "#14532d"; }
            if (wrongPick) { bg = "#fef2f2"; border = "#dc2626"; color = "#7f1d1d"; }
            return (
              <button key={o.i} onClick={() => tap(o.i)} disabled={reviewing}
                className="w-full text-left rounded-xl px-4 py-3 flex items-center gap-3 transition active:scale-[0.99]"
                style={{ background: bg, border: `2px solid ${border}`, color }}>
                <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{ background: chosen || right ? (right ? GREEN : wrongPick ? "#dc2626" : ORANGE) : "#e2e8f0", color: chosen || right ? "#fff" : "#64748b" }}>
                  {q.kind === "order" ? (orderNum > 0 ? orderNum : LETTERS[pos]) : LETTERS[pos]}
                </span>
                <span className="flex-1 font-medium">{o.text}</span>
                {right && <span className="text-sm font-bold">✓</span>}
                {reviewing && current.optionCounts && q.kind !== "order" && <span className="text-xs text-slate-400">{current.optionCounts[o.i]}</span>}
              </button>
            );
          })}
        </div>

        {!reviewing && q.kind !== "single" && (
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <button onClick={() => send(picked)} disabled={saving || picked.length === 0 || (q.kind === "order" && picked.length !== q.options.length) || sameAsSent}
              className="rounded-xl px-5 py-3 font-semibold text-white disabled:opacity-40" style={{ background: ORANGE }}>
              {saving ? "Saving…" : sent ? "Update answer" : "Lock it in"}
            </button>
            {picked.length > 0 && <button onClick={() => setPicked([])} className="text-sm text-slate-500 underline">Clear</button>}
            {q.kind === "order" && picked.length < q.options.length && <span className="text-xs text-slate-400">{q.options.length - picked.length} steps left</span>}
          </div>
        )}

        {!reviewing && sent && (
          <p className="mt-4 text-sm font-semibold" style={{ color: GREEN }}>✓ Answer locked in. You can change it until the host moves on.</p>
        )}
        {!reviewing && !sent && q.kind === "single" && <p className="mt-4 text-xs text-slate-400">Tap an answer to lock it in.</p>}
        {msg && <p className="mt-3 text-sm font-semibold text-red-600">{msg}</p>}

        {reviewing && (
          <div className="mt-4 rounded-xl p-4" style={{ background: current.myCorrect ? "#ecfdf3" : "#fff7ed" }}>
            <p className="font-bold" style={{ color: current.myCorrect ? GREEN : "#c2410c" }}>
              {current.myCorrect ? "You got it! 🎉" : sent ? "Not quite." : "You didn't answer this one."}
            </p>
            {q.kind === "order" && (
              <div className="mt-2 text-sm text-slate-700">
                <p className="font-semibold mb-1">Right order:</p>
                <ol className="list-decimal pl-5 space-y-0.5">
                  {[...q.options].sort((a, b) => a.i - b.i).map((o) => <li key={o.i}>{o.text} <span className="text-slate-400">({letterOf(o.i)})</span></li>)}
                </ol>
              </div>
            )}
            {q.explanation && <p className="text-sm text-slate-600 mt-2">{q.explanation}</p>}
            {typeof current.correctCount === "number" && (
              <p className="text-xs text-slate-500 mt-2">{current.correctCount} of {current.answeredCount} got it right.</p>
            )}
          </div>
        )}
      </div>
      {state.me && <p className="text-xs text-slate-400 mt-3 text-center">{reviewing ? `Your score so far: ${state.me.score}` : `${current.answeredCount} answered`}</p>}
    </Shell>
  );
}

function Shell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-24 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <div className="max-w-xl mx-auto">
          <h1 className="text-2xl font-bold mb-1">🎯 Live Quiz</h1>
          {title && <p className="text-sm text-slate-500 mb-4">{title}</p>}
          {!title && <div className="mb-4" />}
          {children}
        </div>
      </div>
    </main>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl bg-white shadow p-6 text-center text-slate-600">{children}</div>;
}

export default function QuizPage() {
  return <AppIdentityGate>{(identity) => <QuizBody identity={identity} />}</AppIdentityGate>;
}
