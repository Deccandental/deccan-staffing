import { NextRequest, NextResponse } from "next/server";
import { isCron, sessionFrom, hasPerm } from "@/lib/routeAuth";
import { syncRange, syncUpcoming, SyncResult } from "@/lib/openDental/sync";

// Writes the staffing app's blockouts into Open Dental.
//   GET  — the nightly scheduled job: syncs today through the next ~2 months.
//   POST — after someone changes the schedule or leave: { from, to } for just
//          those dates, or { all: true } for the whole upcoming window.
//          { from, to, force: true } (admins) rewrites the Deccan App
//          blockout exactly as the app has it, even if it was edited or deleted
//          in Open Dental.
export const runtime = "nodejs";
export const maxDuration = 300;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function summarize(out: { skipped?: string; results: SyncResult[] }) {
  const errors = out.results.filter((r) => r.status === "error");
  return {
    ok: errors.length === 0,
    skipped: out.skipped,
    days: out.results.length,
    changes: out.results.reduce((n, r) => n + r.changes, 0),
    flagged: out.results.filter((r) => r.status !== "ok" && r.status !== "error").map((r) => ({ date: r.date, status: r.status, message: r.message })),
    errors: errors.map((r) => ({ date: r.date, message: r.message })),
  };
}

export async function GET(req: NextRequest) {
  if (!isCron(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(summarize(await syncUpcoming()));
  } catch (e: any) {
    console.error("Open Dental nightly sync failed:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Sync failed." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = sessionFrom(req);
  if (!session) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  if (!hasPerm(session, "admin") && !hasPerm(session, "leaveManage")) {
    return NextResponse.json({ ok: false, error: "Not permitted." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  try {
    if (body?.all === true) return NextResponse.json(summarize(await syncUpcoming()));
    const from = String(body?.from ?? "");
    const to = String(body?.to ?? from);
    if (!YMD.test(from) || !YMD.test(to) || to < from) {
      return NextResponse.json({ ok: false, error: "Bad dates." }, { status: 400 });
    }
    const spanDays = (Date.parse(to) - Date.parse(from)) / 86400000;
    if (spanDays > 130) return NextResponse.json({ ok: false, error: "Too many days at once." }, { status: 400 });
    const force = body?.force === true;
    if (force && (!hasPerm(session, "admin") || from !== to)) {
      return NextResponse.json({ ok: false, error: "Only an admin can overwrite a day, one day at a time." }, { status: 403 });
    }
    return NextResponse.json(summarize(await syncRange(from, to, { force })));
  } catch (e: any) {
    console.error("Open Dental sync failed:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Sync failed." }, { status: 500 });
  }
}
