// Server-side Live Quiz helpers. Only import from files under src/app/api/.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { displayOrder, QuestionKind } from "@/lib/quiz";

export interface QuestionRow {
  id: string; quiz_id: string; sort: number; kind: QuestionKind; prompt: string; hint: string | null;
  options: string[]; correct: number[]; explanation: string | null;
}
export interface QuizRow {
  id: string; title: string; status: "draft" | "live" | "finished"; phase: "lobby" | "question" | "review" | "final";
  reveal_mode: "end" | "each"; current_index: number; question_started_at: string | null;
  created_by: string | null; created_at: string; started_at: string | null; finished_at: string | null;
}

export async function loadQuestions(quizId: string): Promise<QuestionRow[]> {
  const { data } = await supabaseAdmin.from("quiz_questions").select("*").eq("quiz_id", quizId).order("sort");
  return (data ?? []).map((q: any) => ({
    ...q,
    options: Array.isArray(q.options) ? q.options.map(String) : [],
    correct: Array.isArray(q.correct) ? q.correct.map(Number) : [],
  }));
}

/** What a phone or the host screen is allowed to see about a question. The right answer is left out until it's revealed. */
export function publicQuestion(q: QuestionRow, reveal: boolean) {
  const order = displayOrder(q);
  return {
    id: q.id, kind: q.kind, prompt: q.prompt, hint: q.hint,
    options: order.map((i) => ({ i, text: q.options[i] })),
    ...(reveal ? { correct: q.correct, explanation: q.explanation } : {}),
  };
}

export interface Standing { employeeId: number; name: string; score: number; ms: number; rank: number }

export function standings(players: { employee_id: number; employee_name: string }[], answers: any[]): Standing[] {
  const by = new Map<number, Standing>();
  for (const p of players) by.set(p.employee_id, { employeeId: p.employee_id, name: p.employee_name, score: 0, ms: 0, rank: 0 });
  for (const a of answers) {
    const s = by.get(a.employee_id) ?? { employeeId: a.employee_id, name: a.employee_name, score: 0, ms: 0, rank: 0 };
    if (a.is_correct) { s.score += 1; s.ms += Number(a.ms_taken ?? 0); }
    by.set(a.employee_id, s);
  }
  // More right answers wins; on a tie, whoever answered their right ones faster.
  const list = [...by.values()].sort((a, b) => b.score - a.score || a.ms - b.ms || a.name.localeCompare(b.name));
  list.forEach((s, i) => {
    const prev = list[i - 1];
    s.rank = prev && prev.score === s.score && prev.ms === s.ms ? prev.rank : i + 1;
  });
  return list;
}

/** Everything a screen needs to draw the quiz right now. `employeeId` adds that person's own answer and score. */
export async function quizState(quiz: QuizRow, opts: { host: boolean; employeeId?: number }) {
  const questions = await loadQuestions(quiz.id);
  const [{ data: players }, { data: answers }] = await Promise.all([
    supabaseAdmin.from("quiz_players").select("employee_id, employee_name, joined_at").eq("quiz_id", quiz.id).order("joined_at"),
    supabaseAdmin.from("quiz_answers").select("question_id, employee_id, employee_name, answer, is_correct, ms_taken").eq("quiz_id", quiz.id),
  ]);
  const ans = answers ?? [];
  const idx = Math.min(Math.max(quiz.current_index, 0), Math.max(questions.length - 1, 0));
  const q = questions[idx];
  const showingQuestion = quiz.phase === "question" || quiz.phase === "review";
  const reveal = quiz.phase === "review";

  let current = null as any;
  if (q && showingQuestion) {
    const forQ = ans.filter((a: any) => a.question_id === q.id);
    current = {
      index: idx,
      question: publicQuestion(q, reveal),
      answeredCount: forQ.length,
      answeredNames: opts.host ? forQ.map((a: any) => a.employee_name) : undefined,
      ...(reveal ? {
        correctCount: forQ.filter((a: any) => a.is_correct).length,
        // How many people picked each option (for single / pick-all questions).
        optionCounts: q.options.map((_, i) => forQ.filter((a: any) => Array.isArray(a.answer) && (q.kind === "order" ? false : a.answer.includes(i))).length),
        correctNames: opts.host ? forQ.filter((a: any) => a.is_correct).map((a: any) => a.employee_name) : undefined,
      } : {}),
    };
    if (opts.employeeId != null) {
      const mine = forQ.find((a: any) => a.employee_id === opts.employeeId);
      current.myAnswer = mine ? mine.answer : null;
      if (reveal) current.myCorrect = mine ? !!mine.is_correct : null;
    }
  }

  const table = standings(players ?? [], ans);
  const me = opts.employeeId != null ? table.find((s) => s.employeeId === opts.employeeId) ?? null : null;

  return {
    quiz: {
      id: quiz.id, title: quiz.title, status: quiz.status, phase: quiz.phase, revealMode: quiz.reveal_mode,
      currentIndex: idx, questionStartedAt: quiz.question_started_at,
    },
    total: questions.length,
    players: (players ?? []).map((p: any) => p.employee_name),
    current,
    // Phones see the full board only at the end; the host sees it whenever they want it.
    leaderboard: quiz.phase === "final" || opts.host ? table.map(({ name, score, rank }) => ({ name, score, rank })) : undefined,
    me: me ? { score: me.score, rank: me.rank, of: table.length } : null,
  };
}
