"use client";

import { useState, useEffect, useCallback } from "react";
import AppIdentityGate, { AppIdentity } from "@/components/AppIdentityGate";
import { Sidebar } from "@/components/Sidebar";
import { getSessionToken } from "@/lib/secureData";
import { LETTERS, KIND_LABEL, QuestionKind, QuizQuestion, questionProblems } from "@/lib/quiz";

/**
 * Quiz Builder. Write a quiz, then host it live: the host screen goes on the TV and staff answer on their phones.
 * Admins only.
 */

interface QuizListItem { id: string; title: string; status: "draft" | "live" | "finished"; reveal_mode: "end" | "each"; questionCount: number; created_at: string; started_at: string | null }

const ORANGE = "#e8622a";

async function api(body: Record<string, unknown>): Promise<{ ok: boolean; json: any }> {
  try {
    const res = await fetch("/api/quiz/admin", { method: "POST", headers: { "Content-Type": "application/json", "x-session-token": getSessionToken() }, body: JSON.stringify(body) });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch { return { ok: false, json: { error: "Couldn't reach the server." } }; }
}

const blankQuestion = (sort: number): QuizQuestion => ({ sort, kind: "single", prompt: "", hint: "", options: ["", "", "", ""], correct: [], explanation: "" });

function Editor({ quizId, onClose }: { quizId: string; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [revealMode, setRevealMode] = useState<"end" | "each">("end");
  const [status, setStatus] = useState<"draft" | "live" | "finished">("draft");
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await api({ action: "get", quizId });
      setLoading(false);
      if (!r.ok) { setMsg(r.json.error ?? "Couldn't load the quiz."); return; }
      setTitle(r.json.quiz.title); setRevealMode(r.json.quiz.reveal_mode); setStatus(r.json.quiz.status);
      setQuestions((r.json.questions ?? []).map((q: any) => ({ ...q, hint: q.hint ?? "", explanation: q.explanation ?? "" })));
    })();
  }, [quizId]);

  function update(n: number, patch: Partial<QuizQuestion>) {
    setDirty(true);
    setQuestions((qs) => qs.map((q, i) => (i === n ? { ...q, ...patch } : q)));
  }
  function move(n: number, d: number) {
    const to = n + d;
    if (to < 0 || to >= questions.length) return;
    setDirty(true);
    setQuestions((qs) => { const c = [...qs]; [c[n], c[to]] = [c[to], c[n]]; return c; });
  }
  function setKind(n: number, kind: QuestionKind) {
    const q = questions[n];
    update(n, { kind, correct: kind === "order" ? q.options.map((_, i) => i) : kind === "single" ? q.correct.slice(0, 1) : q.correct });
  }
  function setOption(n: number, i: number, text: string) {
    const q = questions[n];
    update(n, { options: q.options.map((o, j) => (j === i ? text : o)) });
  }
  function addOption(n: number) { const q = questions[n]; if (q.options.length < 12) update(n, { options: [...q.options, ""] }); }
  function removeOption(n: number, i: number) {
    const q = questions[n];
    const options = q.options.filter((_, j) => j !== i);
    const correct = q.correct.filter((c) => c !== i).map((c) => (c > i ? c - 1 : c));
    update(n, { options, correct: q.kind === "order" ? options.map((_, j) => j) : correct });
  }
  function toggleCorrect(n: number, i: number) {
    const q = questions[n];
    if (q.kind === "single") update(n, { correct: [i] });
    else update(n, { correct: q.correct.includes(i) ? q.correct.filter((c) => c !== i) : [...q.correct, i] });
  }

  async function save() {
    // Drop empty choice boxes before checking, and keep the right-answer marks pointing at the same choices.
    const cleaned = questions.map((q, n) => {
      const keep = q.options.map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o);
      const remap = new Map(keep.map((x, j) => [x.i, j]));
      const options = keep.map((x) => x.o);
      const correct = q.kind === "order" ? options.map((_, j) => j) : q.correct.filter((c) => remap.has(c)).map((c) => remap.get(c)!);
      return { ...q, sort: n, options, correct };
    });
    const problems = cleaned.flatMap((q, i) => questionProblems(q, i + 1));
    if (problems.length) { setMsg(problems[0]); return; }
    setSaving(true); setMsg("");
    const r = await api({ action: "save", quizId, title, revealMode, questions: cleaned });
    setSaving(false);
    if (!r.ok) { setMsg(r.json.error ?? "Couldn't save."); return; }
    setQuestions(cleaned); setDirty(false); setMsg("Saved.");
  }

  if (loading) return <p className="text-sm text-slate-400">Loading…</p>;

  return (
    <div className="max-w-3xl space-y-4">
      <button onClick={() => { if (!dirty || confirm("Leave without saving your changes?")) onClose(); }} className="text-sm font-semibold hover:underline" style={{ color: ORANGE }}>← All quizzes</button>

      {status === "live" && <p className="rounded-xl bg-amber-50 text-amber-800 text-sm px-4 py-3">This quiz is running right now. End it on the host screen before changing questions.</p>}

      <div className="rounded-2xl bg-white shadow p-4 space-y-3">
        <div>
          <label className="block text-xs text-slate-400 mb-0.5">Quiz title</label>
          <input value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-0.5">When do people see the right answers?</label>
          <select value={revealMode} onChange={(e) => { setRevealMode(e.target.value as "end" | "each"); setDirty(true); }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white">
            <option value="end">All at the end, after the last question</option>
            <option value="each">Right after each question</option>
          </select>
        </div>
      </div>

      {questions.map((q, n) => (
        <div key={n} className="rounded-2xl bg-white shadow p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-slate-700">Question {n + 1}</span>
            <select value={q.kind} onChange={(e) => setKind(n, e.target.value as QuestionKind)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs bg-white">
              {(Object.keys(KIND_LABEL) as QuestionKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <div className="flex-1" />
            <button onClick={() => move(n, -1)} disabled={n === 0} className="text-slate-400 disabled:opacity-30 px-1" title="Move up">▲</button>
            <button onClick={() => move(n, 1)} disabled={n === questions.length - 1} className="text-slate-400 disabled:opacity-30 px-1" title="Move down">▼</button>
            <button onClick={() => { if (confirm(`Delete question ${n + 1}?`)) { setDirty(true); setQuestions((qs) => qs.filter((_, i) => i !== n)); } }} className="text-xs text-red-400 hover:underline ml-2">Delete</button>
          </div>
          <textarea value={q.prompt} onChange={(e) => update(n, { prompt: e.target.value })} rows={2} placeholder="Type the question"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
          <input value={q.hint ?? ""} onChange={(e) => update(n, { hint: e.target.value })} placeholder="Clue (optional)"
            className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none" />

          <p className="text-xs text-slate-500">
            {q.kind === "single" && "Type the choices, then tap the circle next to the right one."}
            {q.kind === "multi" && "Type the choices, then tick every right one."}
            {q.kind === "order" && "Type the steps in the RIGHT order. Players get them shuffled and tap them back into order."}
          </p>
          <div className="space-y-1.5">
            {q.options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                {q.kind === "order" ? (
                  <span className="w-6 text-center text-xs font-bold text-slate-400">{i + 1}</span>
                ) : (
                  <button onClick={() => toggleCorrect(n, i)} title="Mark as right"
                    className={`w-6 h-6 flex items-center justify-center text-xs font-bold flex-shrink-0 ${q.kind === "single" ? "rounded-full" : "rounded-md"}`}
                    style={q.correct.includes(i) ? { background: "#16a34a", color: "#fff" } : { background: "#f1f5f9", color: "#94a3b8" }}>
                    {q.correct.includes(i) ? "✓" : LETTERS[i]}
                  </button>
                )}
                <input value={o} onChange={(e) => setOption(n, i, e.target.value)} placeholder={q.kind === "order" ? `Step ${i + 1}` : `Choice ${LETTERS[i]}`}
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none" />
                <button onClick={() => removeOption(n, i)} className="text-slate-300 hover:text-red-400 px-1" title="Remove">✕</button>
              </div>
            ))}
          </div>
          {q.options.length < 12 && <button onClick={() => addOption(n)} className="text-xs font-semibold hover:underline" style={{ color: ORANGE }}>+ Add {q.kind === "order" ? "step" : "choice"}</button>}
          <input value={q.explanation ?? ""} onChange={(e) => update(n, { explanation: e.target.value })} placeholder="Why it's right, shown with the answer (optional)"
            className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none" />
        </div>
      ))}

      <div className="flex items-center gap-3 flex-wrap sticky bottom-4">
        <button onClick={() => { setDirty(true); setQuestions((qs) => [...qs, blankQuestion(qs.length)]); }} className="rounded-lg px-4 py-2 text-sm font-semibold border border-slate-200 bg-white shadow-sm">+ Add question</button>
        <button onClick={save} disabled={saving || status === "live"} className="rounded-lg px-5 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-40" style={{ background: ORANGE }}>{saving ? "Saving…" : "Save quiz"}</button>
        {msg && <span className={`text-sm font-semibold ${msg === "Saved." ? "text-green-600" : "text-red-600"}`}>{msg}</span>}
      </div>
    </div>
  );
}

function QuizAdminBody({ identity }: { identity: AppIdentity }) {
  const [quizzes, setQuizzes] = useState<QuizListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api({ action: "list" });
    setLoading(false);
    if (!r.ok) { setError(r.json.error ?? "Couldn't load quizzes."); return; }
    setError(""); setQuizzes(r.json.quizzes ?? []);
  }, []);
  useEffect(() => { if (identity.canAdmin) load(); }, [identity.canAdmin, load]);

  async function create(kind: "create" | "createNovember") {
    const r = await api({ action: kind, title: newTitle });
    if (!r.ok) { setError(r.json.error ?? "Couldn't create the quiz."); return; }
    setNewTitle("");
    if (kind === "create") setEditing(r.json.id); else load();
  }

  async function remove(q: QuizListItem) {
    if (!confirm(`Delete "${q.title}" and all its answers?`)) return;
    const r = await api({ action: "delete", quizId: q.id });
    if (!r.ok) { setError(r.json.error ?? "Couldn't delete."); return; }
    load();
  }

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-24 lg:pt-0 lg:ml-64 p-4 lg:p-8">
        <h1 className="text-2xl font-bold">🧩 Quiz Builder</h1>
        <p className="text-sm text-slate-500 mb-4 max-w-3xl">
          Write a quiz, then press <b>Host</b> to open the host screen on the TV. Staff open <b>🎯 Live Quiz</b> in the app on their phones,
          logged in with their own PIN, and answer as you move through the questions.
        </p>

        {!identity.canAdmin ? (
          <p className="rounded-xl bg-white shadow px-5 py-4 text-sm text-slate-600">Only admins can build and host quizzes.</p>
        ) : editing ? (
          <Editor quizId={editing} onClose={() => { setEditing(null); load(); }} />
        ) : (
          <div className="max-w-3xl space-y-4">
            {error && <p className="text-sm font-semibold text-red-600">⚠️ {error}</p>}
            <div className="rounded-2xl bg-white shadow p-4 flex items-end gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs text-slate-400 mb-0.5">New quiz</label>
                <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g. December staff trivia"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
              </div>
              <button onClick={() => create("create")} className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: ORANGE }}>Create</button>
              <button onClick={() => create("createNovember")} className="rounded-lg px-4 py-2 text-sm font-semibold border border-slate-200 bg-white">Load the November staff quiz</button>
            </div>

            {loading ? <p className="text-sm text-slate-400">Loading…</p> : quizzes.length === 0 ? (
              <p className="text-sm text-slate-400">No quizzes yet.</p>
            ) : (
              <div className="space-y-2">
                {quizzes.map((q) => (
                  <div key={q.id} className="rounded-2xl bg-white shadow p-4 flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-[180px]">
                      <p className="font-semibold text-slate-700">{q.title}</p>
                      <p className="text-xs text-slate-400">
                        {q.questionCount} question{q.questionCount === 1 ? "" : "s"} · answers {q.reveal_mode === "each" ? "after each question" : "at the end"}
                        {q.status === "live" && <span className="ml-2 font-bold text-green-600">● LIVE</span>}
                        {q.status === "finished" && q.started_at && <span className="ml-2">· last run {new Date(q.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                      </p>
                    </div>
                    <a href={`/quiz-host?id=${q.id}`} className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: ORANGE }}>Host</a>
                    <button onClick={() => setEditing(q.id)} className="rounded-lg px-3 py-2 text-sm font-semibold border border-slate-200 bg-white">Edit</button>
                    <button onClick={() => remove(q)} className="text-xs text-red-400 hover:underline">Delete</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default function QuizAdminPage() {
  return <AppIdentityGate>{(identity) => <QuizAdminBody identity={identity} />}</AppIdentityGate>;
}
