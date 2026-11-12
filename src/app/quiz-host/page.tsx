"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AppIdentityGate, { AppIdentity } from "@/components/AppIdentityGate";
import { getSessionToken } from "@/lib/secureData";
import { LETTERS, KIND_LABEL, QuestionKind } from "@/lib/quiz";

/**
 * Live Quiz, host screen. Put this on the TV or projector; staff answer on their phones at /quiz.
 * Admins only. Arrow keys or the buttons move the quiz along.
 */

interface Opt { i: number; text: string }
interface PublicQ { id: string; kind: QuestionKind; prompt: string; hint: string | null; options: Opt[]; correct?: number[]; explanation?: string | null }
interface HostState {
  quiz: { id: string; title: string; status: "draft" | "live" | "finished"; phase: "lobby" | "question" | "review" | "final"; revealMode: "end" | "each"; currentIndex: number };
  total: number;
  players: string[];
  current: { index: number; question: PublicQ; answeredCount: number; answeredNames?: string[]; correctCount?: number; optionCounts?: number[]; correctNames?: string[] } | null;
  leaderboard?: { name: string; score: number; rank: number }[];
}

const ORANGE = "#e8622a";
const INK = "#232634";
const CREAM = "#FBF7EF";
const GREEN = "#16a34a";

async function api(body: Record<string, unknown>): Promise<{ ok: boolean; json: any }> {
  try {
    const res = await fetch("/api/quiz/admin", { method: "POST", headers: { "Content-Type": "application/json", "x-session-token": getSessionToken() }, body: JSON.stringify(body) });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch { return { ok: false, json: { error: "Couldn't reach the server." } }; }
}

function HostBody({ identity }: { identity: AppIdentity }) {
  const params = useSearchParams();
  const quizId = params.get("id") ?? "";
  const [s, setS] = useState<HostState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [joinUrl, setJoinUrl] = useState("/quiz");

  useEffect(() => { setJoinUrl(`${window.location.host}/quiz`); }, []);

  const load = useCallback(async () => {
    if (!quizId) return;
    const r = await api({ action: "state", quizId });
    if (!r.ok) { setError(r.json.error ?? "Couldn't load the quiz."); return; }
    setError(""); setS(r.json);
  }, [quizId]);

  useEffect(() => {
    if (!identity.canAdmin) return;
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [identity.canAdmin, load]);

  const move = useCallback(async (action: "next" | "back" | "start" | "end") => {
    if (busy) return;
    if (action === "end" && !confirm("End the quiz for everyone?")) return;
    if (action === "start" && s?.quiz.status === "finished" && !confirm("Run this quiz again? The last run's answers will be cleared.")) return;
    setBusy(true);
    const r = await api({ action, quizId });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "Something went wrong."); return; }
    setShowBoard(false);
    load();
  }, [busy, quizId, load, s?.quiz.status]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (s?.quiz.status !== "live") return;
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); move("next"); }
      if (e.key === "ArrowLeft") { e.preventDefault(); move("back"); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s?.quiz.status, move]);

  if (!identity.canAdmin) return <Center>Only admins can host a quiz.</Center>;
  if (!quizId) return <Center>No quiz chosen. Open a quiz from <a href="/quiz-admin" style={{ color: ORANGE }} className="underline">Quiz Builder</a>.</Center>;
  if (!s) return <Center>{error || "Loading…"}</Center>;

  const { quiz, current, total } = s;
  const live = quiz.status === "live";
  const last = total - 1;
  const each = quiz.revealMode === "each";

  let nextLabel = "Next ›";
  if (quiz.phase === "lobby") nextLabel = "Start question 1 ›";
  else if (quiz.phase === "question") nextLabel = each ? "Show answer ›" : quiz.currentIndex < last ? "Next question ›" : "Show the answers ›";
  else if (quiz.phase === "review") nextLabel = each ? (quiz.currentIndex < last ? "Next question ›" : "Final scores ›") : quiz.currentIndex < last ? "Next answer ›" : "Final scores ›";

  return (
    <main className="min-h-screen flex flex-col" style={{ background: CREAM, color: INK }}>
      {/* Control bar */}
      <div className="flex items-center gap-3 px-6 py-3 flex-wrap" style={{ borderBottom: "1px solid rgba(35,38,52,0.08)", background: "#fff" }}>
        <a href="/quiz-admin" className="text-sm font-semibold hover:underline" style={{ color: ORANGE }}>← Quiz Builder</a>
        <span className="font-bold" style={{ fontFamily: "'Poppins', sans-serif" }}>{quiz.title}</span>
        <span className="text-xs rounded-full px-2 py-0.5 font-semibold" style={{ background: live ? "#dcfce7" : "#f1f5f9", color: live ? GREEN : "#64748b" }}>{live ? "LIVE" : quiz.status === "finished" ? "Ended" : "Not started"}</span>
        <div className="flex-1" />
        {error && <span className="text-sm text-red-600 font-semibold">{error}</span>}
        {live ? (
          <>
            {quiz.phase !== "lobby" && <button onClick={() => move("back")} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-semibold border border-slate-200 bg-white">‹ Back</button>}
            {quiz.phase !== "final" && <button onClick={() => move("next")} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: ORANGE }}>{nextLabel}</button>}
            {quiz.phase !== "final" && quiz.phase !== "lobby" && <button onClick={() => setShowBoard((v) => !v)} className="rounded-lg px-3 py-2 text-sm font-semibold border border-slate-200 bg-white">{showBoard ? "Hide scores" : "Scores"}</button>}
            <button onClick={() => move("end")} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-semibold text-red-600 border border-red-200 bg-white">End quiz</button>
          </>
        ) : (
          <button onClick={() => move("start")} disabled={busy || total === 0} className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: ORANGE }}>
            {quiz.status === "finished" ? "Run again" : "Open the quiz"}
          </button>
        )}
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-6xl">
          {!live && quiz.status !== "finished" && (
            <Big>
              <p className="text-6xl font-bold" style={{ fontFamily: "'Poppins', sans-serif" }}>{quiz.title}</p>
              <p className="text-2xl mt-4 opacity-60">{total} questions. Press “Open the quiz” so people can join.</p>
            </Big>
          )}

          {(showBoard || quiz.phase === "final" || (!live && quiz.status === "finished")) && s.leaderboard && (live || quiz.status === "finished") ? (
            <Leaderboard rows={s.leaderboard} total={total} final={quiz.phase === "final" || !live} />
          ) : live && quiz.phase === "lobby" ? (
            <Big>
              <p className="text-2xl opacity-60">Join on your phone</p>
              <p className="text-5xl font-bold mt-2" style={{ fontFamily: "'Poppins', sans-serif" }}>Staff app › 🎯 Live Quiz</p>
              <p className="text-2xl mt-3" style={{ color: ORANGE }}>{joinUrl}</p>
              <p className="text-xl mt-10 opacity-60">{s.players.length} joined</p>
              <div className="flex flex-wrap gap-3 justify-center mt-4">
                {s.players.map((n) => <span key={n} className="rounded-full bg-white px-5 py-2 text-xl font-semibold shadow-sm">{n}</span>)}
              </div>
            </Big>
          ) : live && current ? (
            <QuestionView s={s} />
          ) : null}
        </div>
      </div>
    </main>
  );
}

function QuestionView({ s }: { s: HostState }) {
  const c = s.current!;
  const q = c.question;
  const reviewing = s.quiz.phase === "review";
  const correct = new Set(q.correct ?? []);
  const maxCount = Math.max(1, ...(c.optionCounts ?? [0]));
  const cols = q.options.length > 6 ? "grid-cols-3" : "grid-cols-2";

  return (
    <div>
      <div className="flex items-center justify-between text-xl opacity-60 mb-4">
        <span>{reviewing ? "Answer" : "Question"} {c.index + 1} of {s.total}</span>
        <span>{KIND_LABEL[q.kind]}</span>
      </div>
      <p className="text-5xl font-bold leading-tight" style={{ fontFamily: "'Poppins', sans-serif" }}>{q.prompt}</p>
      {q.hint && <p className="text-2xl italic opacity-60 mt-3">Clue: {q.hint}</p>}

      {reviewing && q.kind === "order" ? (
        <ol className="mt-8 grid grid-cols-2 gap-x-10 gap-y-3">
          {[...q.options].sort((a, b) => a.i - b.i).map((o, n) => (
            <li key={o.i} className="flex items-center gap-4 rounded-2xl bg-white px-5 py-3 shadow-sm">
              <span className="w-12 h-12 rounded-full flex items-center justify-center text-2xl font-bold text-white flex-shrink-0" style={{ background: GREEN }}>{n + 1}</span>
              <span className="text-2xl">{o.text} <span className="opacity-40">({LETTERS[q.options.findIndex((x) => x.i === o.i)]})</span></span>
            </li>
          ))}
        </ol>
      ) : (
        <div className={`mt-8 grid ${cols} gap-4`}>
          {q.options.map((o, pos) => {
            const right = reviewing && correct.has(o.i);
            const count = c.optionCounts?.[o.i] ?? 0;
            return (
              <div key={o.i} className="relative rounded-2xl px-6 py-5 flex items-center gap-4 overflow-hidden shadow-sm"
                style={{ background: right ? "#ecfdf3" : "#fff", border: `3px solid ${right ? GREEN : "transparent"}`, opacity: reviewing && !right ? 0.55 : 1 }}>
                {reviewing && q.kind !== "order" && (
                  <div className="absolute left-0 top-0 bottom-0" style={{ width: `${(count / maxCount) * 100}%`, background: right ? "rgba(22,163,74,0.10)" : "rgba(35,38,52,0.05)" }} />
                )}
                <span className="relative w-12 h-12 rounded-full flex items-center justify-center text-2xl font-bold text-white flex-shrink-0" style={{ background: right ? GREEN : ORANGE }}>{LETTERS[pos]}</span>
                <span className="relative text-2xl flex-1">{o.text}</span>
                {reviewing && q.kind !== "order" && <span className="relative text-2xl font-bold opacity-60">{count}</span>}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-8 flex items-center gap-6 text-2xl">
        {reviewing ? (
          <>
            <span className="font-bold" style={{ color: GREEN }}>{c.correctCount ?? 0} of {c.answeredCount} got it right</span>
            {q.explanation && <span className="opacity-70 text-xl">{q.explanation}</span>}
          </>
        ) : (
          <span className="opacity-70"><b style={{ color: ORANGE }}>{c.answeredCount}</b> of {s.players.length} answered</span>
        )}
      </div>
    </div>
  );
}

function Leaderboard({ rows, total, final }: { rows: { name: string; score: number; rank: number }[]; total: number; final: boolean }) {
  const medal = (r: number) => (r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : `#${r}`);
  return (
    <div className="max-w-3xl mx-auto">
      <p className="text-5xl font-bold text-center mb-8" style={{ fontFamily: "'Poppins', sans-serif" }}>{final ? "🏆 Final scores" : "Scores so far"}</p>
      {rows.length === 0 && <p className="text-center text-2xl opacity-60">No one played.</p>}
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-5 rounded-2xl bg-white px-6 py-4 shadow-sm" style={{ border: r.rank === 1 ? `3px solid ${ORANGE}` : "3px solid transparent" }}>
            <span className="w-14 text-3xl text-center">{medal(r.rank)}</span>
            <span className="flex-1 text-3xl font-semibold">{r.name}</span>
            <span className="text-3xl font-bold" style={{ color: ORANGE }}>{r.score}<span className="text-xl opacity-50"> / {total}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Big({ children }: { children: React.ReactNode }) {
  return <div className="text-center">{children}</div>;
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen flex items-center justify-center p-8 text-slate-600" style={{ background: CREAM }}>{children}</main>;
}

export default function QuizHostPage() {
  return (
    <AppIdentityGate>
      {(identity) => (
        <Suspense fallback={<Center>Loading…</Center>}>
          <HostBody identity={identity} />
        </Suspense>
      )}
    </AppIdentityGate>
  );
}
