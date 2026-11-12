import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { staffSession } from "@/lib/reviewAuth";
import { isCorrect, validAnswer } from "@/lib/quiz";
import { loadQuestions, quizState, QuizRow } from "@/lib/quizServer";

// Playing the live quiz from a phone. Each person plays under their own PIN, so scores are theirs.
export const runtime = "nodejs";

async function liveQuiz(): Promise<QuizRow | null> {
  const { data } = await supabaseAdmin.from("quizzes").select("*").eq("status", "live").order("started_at", { ascending: false }).limit(1).maybeSingle();
  return (data as QuizRow) ?? null;
}

export async function POST(req: NextRequest) {
  const session = staffSession(req);
  if (!session) return NextResponse.json({ error: "Log in with your own PIN to play." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const name = session.employeeName ?? "Staff";

  try {
    const quiz = await liveQuiz();

    if (b.action === "state") {
      if (!quiz) return NextResponse.json({ live: false });
      // Opening the quiz page while a game is on puts you in it.
      await supabaseAdmin.from("quiz_players").upsert(
        { quiz_id: quiz.id, employee_id: session.employeeId, employee_name: name },
        { onConflict: "quiz_id,employee_id", ignoreDuplicates: true },
      );
      return NextResponse.json({ live: true, ...(await quizState(quiz, { host: false, employeeId: session.employeeId })) });
    }

    if (b.action === "answer") {
      if (!quiz || quiz.phase !== "question") return NextResponse.json({ error: "Answers are closed for this question." }, { status: 400 });
      const questions = await loadQuestions(quiz.id);
      const q = questions[quiz.current_index];
      if (!q || q.id !== String(b.questionId ?? "")) return NextResponse.json({ error: "The host has moved on to another question." }, { status: 409 });
      if (!validAnswer(q, b.answer)) return NextResponse.json({ error: "That answer isn't complete yet." }, { status: 400 });
      const started = quiz.question_started_at ? new Date(quiz.question_started_at).getTime() : Date.now();
      const { error } = await supabaseAdmin.from("quiz_answers").upsert({
        quiz_id: quiz.id, question_id: q.id, employee_id: session.employeeId, employee_name: name,
        answer: b.answer, is_correct: isCorrect(q, b.answer),
        ms_taken: Math.max(0, Date.now() - started), answered_at: new Date().toISOString(),
      }, { onConflict: "question_id,employee_id" });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    console.error("quiz/play error:", err);
    return NextResponse.json({ error: "Request failed." }, { status: 500 });
  }
}
