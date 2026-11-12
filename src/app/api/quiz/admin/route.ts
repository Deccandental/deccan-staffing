import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { adminSession } from "@/lib/reviewAuth";
import { NOVEMBER_2026_QUIZ, QuizQuestion, questionProblems, QuestionKind } from "@/lib/quiz";
import { loadQuestions, quizState, QuizRow } from "@/lib/quizServer";

// Building and hosting quizzes. Admins only (the manager passcode, or someone with Admin access).
export const runtime = "nodejs";

const KINDS: QuestionKind[] = ["single", "multi", "order"];

function cleanQuestions(raw: unknown): QuizQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 60).map((q: any, n: number) => {
    const kind: QuestionKind = KINDS.includes(q?.kind) ? q.kind : "single";
    const options: string[] = Array.isArray(q?.options) ? q.options.map((o: unknown) => String(o ?? "").trim().slice(0, 300)).filter(Boolean).slice(0, 12) : [];
    let correct: number[] = Array.isArray(q?.correct) ? [...new Set<number>(q.correct.map(Number).filter((i: number) => Number.isInteger(i) && i >= 0 && i < options.length))] : [];
    if (kind === "single") correct = correct.slice(0, 1);
    if (kind === "order") correct = options.map((_, i) => i);
    return {
      sort: n, kind, options, correct,
      prompt: String(q?.prompt ?? "").trim().slice(0, 600),
      hint: String(q?.hint ?? "").trim().slice(0, 300) || null,
      explanation: String(q?.explanation ?? "").trim().slice(0, 600) || null,
    };
  });
}

async function getQuiz(id: unknown): Promise<QuizRow | null> {
  const { data } = await supabaseAdmin.from("quizzes").select("*").eq("id", String(id ?? "")).maybeSingle();
  return (data as QuizRow) ?? null;
}

async function replaceQuestions(quizId: string, questions: QuizQuestion[]) {
  await supabaseAdmin.from("quiz_questions").delete().eq("quiz_id", quizId);
  if (questions.length === 0) return null;
  const { error } = await supabaseAdmin.from("quiz_questions").insert(questions.map((q) => ({
    quiz_id: quizId, sort: q.sort, kind: q.kind, prompt: q.prompt, hint: q.hint ?? null,
    options: q.options, correct: q.correct, explanation: q.explanation ?? null,
  })));
  return error;
}

export async function POST(req: NextRequest) {
  const session = adminSession(req);
  if (!session) return NextResponse.json({ error: "Only admins can build or host quizzes." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const by = session.mode === "super" ? "Manager passcode" : (session.employeeName ?? "Admin");
  const now = () => new Date().toISOString();

  try {
    if (b.action === "list") {
      const { data, error } = await supabaseAdmin.from("quizzes").select("*").order("created_at", { ascending: false });
      if (error) return NextResponse.json({ error: "The quiz tables aren't set up yet. Run the Live Quiz SQL in Supabase." }, { status: 500 });
      const ids = (data ?? []).map((q: any) => q.id);
      const { data: qs } = ids.length ? await supabaseAdmin.from("quiz_questions").select("quiz_id").in("quiz_id", ids) : { data: [] as any[] };
      const counts = new Map<string, number>();
      for (const q of qs ?? []) counts.set(q.quiz_id, (counts.get(q.quiz_id) ?? 0) + 1);
      return NextResponse.json({ quizzes: (data ?? []).map((q: any) => ({ ...q, questionCount: counts.get(q.id) ?? 0 })) });
    }

    if (b.action === "create" || b.action === "createNovember") {
      const seed = b.action === "createNovember" ? NOVEMBER_2026_QUIZ : null;
      const title = seed ? seed.title : String(b.title ?? "").trim().slice(0, 120) || "New quiz";
      const { data, error } = await supabaseAdmin.from("quizzes").insert({ title, created_by: by }).select("id").single();
      if (error || !data) return NextResponse.json({ error: error?.message ?? "Couldn't create the quiz." }, { status: 400 });
      if (seed) {
        const err = await replaceQuestions(data.id, seed.questions);
        if (err) return NextResponse.json({ error: err.message }, { status: 400 });
      }
      return NextResponse.json({ id: data.id });
    }

    const quiz = await getQuiz(b.quizId);
    if (!quiz) return NextResponse.json({ error: "Quiz not found." }, { status: 404 });

    if (b.action === "get") {
      return NextResponse.json({ quiz, questions: await loadQuestions(quiz.id) });
    }

    if (b.action === "save") {
      if (quiz.status === "live") return NextResponse.json({ error: "This quiz is running. End it before changing the questions." }, { status: 400 });
      const questions = cleanQuestions(b.questions);
      const problems = questions.flatMap((q, i) => questionProblems(q, i + 1));
      if (problems.length) return NextResponse.json({ error: problems[0], problems }, { status: 400 });
      const title = String(b.title ?? quiz.title).trim().slice(0, 120) || quiz.title;
      const reveal_mode = b.revealMode === "each" ? "each" : "end";
      await supabaseAdmin.from("quizzes").update({ title, reveal_mode }).eq("id", quiz.id);
      const err = await replaceQuestions(quiz.id, questions);
      if (err) return NextResponse.json({ error: err.message }, { status: 400 });
      // Old answers belong to the old questions; they're removed with them.
      return NextResponse.json({ ok: true });
    }

    if (b.action === "delete") {
      const { error } = await supabaseAdmin.from("quizzes").delete().eq("id", quiz.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (b.action === "start") {
      const questions = await loadQuestions(quiz.id);
      if (questions.length === 0) return NextResponse.json({ error: "Add at least one question first." }, { status: 400 });
      // Only one quiz runs at a time, so phones always know which one to show.
      await supabaseAdmin.from("quizzes").update({ status: "finished", finished_at: now() }).eq("status", "live").neq("id", quiz.id);
      // Starting again wipes the last run's answers and players, so every run is a fresh game.
      await supabaseAdmin.from("quiz_answers").delete().eq("quiz_id", quiz.id);
      await supabaseAdmin.from("quiz_players").delete().eq("quiz_id", quiz.id);
      const { error } = await supabaseAdmin.from("quizzes").update({
        status: "live", phase: "lobby", current_index: 0, question_started_at: null, started_at: now(), finished_at: null,
      }).eq("id", quiz.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (b.action === "state") {
      return NextResponse.json(await quizState(quiz, { host: true }));
    }

    if (b.action === "next" || b.action === "back") {
      if (quiz.status !== "live") return NextResponse.json({ error: "This quiz isn't running." }, { status: 400 });
      const total = (await loadQuestions(quiz.id)).length;
      const last = total - 1;
      let phase = quiz.phase, i = quiz.current_index;
      const each = quiz.reveal_mode === "each";
      if (b.action === "next") {
        if (phase === "lobby") { phase = "question"; i = 0; }
        else if (phase === "question") {
          if (each) phase = "review";
          else if (i < last) i += 1;
          else { phase = "review"; i = 0; }
        } else if (phase === "review") {
          if (each) { if (i < last) { phase = "question"; i += 1; } else phase = "final"; }
          else if (i < last) i += 1;
          else phase = "final";
        }
      } else {
        if (phase === "final") { phase = "review"; i = last; }
        else if (phase === "review") {
          if (each) phase = "question";
          else if (i > 0) i -= 1;
          else { phase = "question"; i = last; }
        } else if (phase === "question") {
          if (i > 0) { i -= 1; if (each) phase = "review"; }
          else phase = "lobby";
        }
      }
      const restartClock = phase === "question" && (phase !== quiz.phase || i !== quiz.current_index);
      const { error } = await supabaseAdmin.from("quizzes").update({
        phase, current_index: i, ...(restartClock ? { question_started_at: now() } : {}),
      }).eq("id", quiz.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (b.action === "end") {
      const { error } = await supabaseAdmin.from("quizzes").update({ status: "finished", finished_at: now() }).eq("id", quiz.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    console.error("quiz/admin error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Request failed." }, { status: 500 });
  }
}
