// Shared pieces of the Live Quiz: question types, grading, and the order the
// steps of an "order" question are shown in. Safe to import on the server and in the browser.

export type QuestionKind = "single" | "multi" | "order";
export type QuizPhase = "lobby" | "question" | "review" | "final";
export type QuizStatus = "draft" | "live" | "finished";
export type RevealMode = "end" | "each";

export interface QuizQuestion {
  id?: string;
  sort: number;
  kind: QuestionKind;
  prompt: string;
  hint?: string | null;
  options: string[];
  // single: [index of the right option]
  // multi:  [indexes of every right option]
  // order:  always [0, 1, 2, ...]; the steps are written in the right order and shuffled for players
  correct: number[];
  explanation?: string | null;
}

export const LETTERS = "ABCDEFGHIJKLMNOP";

export const KIND_LABEL: Record<QuestionKind, string> = {
  single: "Pick one",
  multi: "Pick all that apply",
  order: "Put in order",
};

// Same shuffle on every phone and on the host screen, so "C" means the same step everywhere.
function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The order options are displayed in, as a list of original indexes. Only "order" questions are scrambled. */
export function displayOrder(q: { id?: string; kind: QuestionKind; options: string[] }): number[] {
  const idx = q.options.map((_, i) => i);
  if (q.kind !== "order" || q.options.length < 2) return idx;
  const rand = rng(seedFrom(q.id ?? q.options.join("|")));
  for (let attempt = 0; attempt < 10; attempt++) {
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    if (idx.some((v, i) => v !== i)) break;   // never show the steps already in the right order
  }
  return idx;
}

/** Answers are lists of ORIGINAL option indexes. */
export function isCorrect(q: { kind: QuestionKind; correct: number[]; options: string[] }, answer: number[]): boolean {
  if (!Array.isArray(answer)) return false;
  if (q.kind === "single") return answer.length === 1 && answer[0] === q.correct[0];
  if (q.kind === "multi") {
    const a = [...new Set(answer)].sort((x, y) => x - y);
    const c = [...new Set(q.correct)].sort((x, y) => x - y);
    return a.length === c.length && a.every((v, i) => v === c[i]);
  }
  // order
  return answer.length === q.options.length && answer.every((v, i) => v === i);
}

/** True if the answer is the right shape for the question (used before saving). */
export function validAnswer(q: { kind: QuestionKind; options: string[] }, answer: unknown): answer is number[] {
  if (!Array.isArray(answer) || answer.length === 0) return false;
  const n = q.options.length;
  if (!answer.every((v) => Number.isInteger(v) && v >= 0 && v < n)) return false;
  if (new Set(answer).size !== answer.length) return false;
  if (q.kind === "single") return answer.length === 1;
  if (q.kind === "order") return answer.length === n;
  return true;
}

/** Problems that stop a quiz from being saved or started. Empty list = fine. */
export function questionProblems(q: QuizQuestion, n: number): string[] {
  const out: string[] = [];
  const opts = q.options.map((o) => o.trim()).filter(Boolean);
  if (!q.prompt.trim()) out.push(`Question ${n} has no question text.`);
  if (opts.length < 2) out.push(`Question ${n} needs at least 2 choices.`);
  if (q.kind === "single" && q.correct.length !== 1) out.push(`Question ${n}: mark the one right answer.`);
  if (q.kind === "multi" && q.correct.length < 1) out.push(`Question ${n}: mark at least one right answer.`);
  return out;
}

/** The staff quiz from the November 2026 meeting, ready to load into a new quiz. */
export const NOVEMBER_2026_QUIZ: { title: string; questions: QuizQuestion[] } = {
  title: "Staff Trivia: November 2026",
  questions: [
    {
      sort: 0, kind: "single",
      prompt: "Healthy patient, no known medical issues. Lower front teeth or upper teeth: which is the preferred needle and anesthetic?",
      options: ["Long needle, lidocaine", "Short needle, Septocaine", "Long needle, Carbocaine", "Short needle, lidocaine", "Long needle, Septocaine", "Short needle, Carbocaine"],
      correct: [1],
      explanation: "Lower front teeth and all upper teeth are numbed by infiltration, so a short needle is enough.",
    },
    {
      sort: 1, kind: "single",
      prompt: "Same healthy patient. Lower back teeth: which is the preferred needle and anesthetic?",
      options: ["Long needle, lidocaine", "Short needle, Septocaine", "Long needle, Carbocaine", "Short needle, lidocaine", "Long needle, Septocaine", "Short needle, Carbocaine"],
      correct: [0],
      explanation: "Lower back teeth need a nerve block, which takes the reach of a long needle.",
    },
    {
      sort: 2, kind: "single",
      prompt: "Shot A: needle goes into the cheek-side fold right next to the tooth, near its root tip, and numbs that tooth. Shot B: needle goes deep behind the last molars and numbs half the lower jaw, lip and tongue. Which is which?",
      options: ["A is a buccal infiltration, B is a block", "A is a block, B is a buccal infiltration", "Both are infiltrations", "Both are blocks"],
      correct: [0],
      explanation: "Infiltration numbs one area near the tooth. A block (here the inferior alveolar nerve block) numbs everything that nerve supplies.",
    },
    {
      sort: 3, kind: "order",
      prompt: "Crown appointment: put these steps in the right order.",
      options: [
        "Room set-up; check with DDS that you have everything",
        "Greet patient, explain and confirm the procedure",
        "Scan the tooth",
        "Take the shade",
        "Make the mold",
        "Place topical anesthetic",
        "DDS discusses treatment with patient",
        "Administer local anesthetic",
        "Place isolation device",
      ],
      correct: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      explanation: "Shade goes early, before the tooth dries out under isolation.",
    },
    {
      sort: 4, kind: "single",
      prompt: "What does MAD stand for?",
      hint: "It is a sleep apnea appliance.",
      options: ["Maxillary Airway Dilator", "Mandibular Advancement Device", "Mouth Airflow Device", "Mandibular Alignment Disc"],
      correct: [1],
      explanation: "It holds the lower jaw slightly forward during sleep to keep the airway open.",
    },
    {
      sort: 5, kind: "single",
      prompt: "Which types of sleep apnea do we treat with an oral appliance?",
      options: [
        "All of them: mild, moderate, severe and central",
        "Mild and moderate; severe sometimes, together with CPAP; not central",
        "Only mild",
        "Mild, moderate and central",
      ],
      correct: [1],
      explanation: "Central apnea is a breathing signal problem from the brain, not a blocked airway, so an oral appliance does not help.",
    },
    {
      sort: 6, kind: "multi",
      prompt: "Which three of these are real sleep apnea devices?",
      options: ["SomnoDent", "RestoAir MRD", "TAP (Thornton Adjustable Positioner)", "Oralux Night Positioner", "EMA (Elastic Mandibular Advancement)", "SleepBridge Advancer"],
      correct: [0, 2, 4],
      explanation: "SomnoDent, TAP and EMA are real oral appliances. The other three are made up.",
    },
  ],
};
