import { NextRequest, NextResponse } from "next/server";
import { sessionFrom, hasPerm } from "@/lib/routeAuth";
import { buildDayPlans } from "@/lib/openDental/dayPlan";
import { buildStaffNoteLines } from "@/lib/openDental/staffNote";
import { desiredBlockouts, loadOdSettings } from "@/lib/openDental/sync";

// Shows what the app WOULD write to Open Dental for one day. Writes nothing
// and doesn't need Open Dental, so it works before the keys are set up.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = sessionFrom(req);
  if (!session) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  if (!hasPerm(session, "admin") && !hasPerm(session, "leaveManage")) {
    return NextResponse.json({ ok: false, error: "Not permitted." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const date = String(body?.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ ok: false, error: "Bad date." }, { status: 400 });
  try {
    const [{ plans, links }, settings] = await Promise.all([buildDayPlans(date, date), loadOdSettings()]);
    const plan = plans[0];
    const staffLines = plan.isOpen && (plan.roster || plan.absences.length > 0) ? buildStaffNoteLines(plan.roster, plan.absences) : [];
    const blockouts = desiredBlockouts(plan, settings, links).map((d) => ({
      kind: d.kind, start: d.input.start, stop: d.input.stop, operatoryNums: d.input.operatoryNums, note: d.input.note,
    }));
    return NextResponse.json({ ok: true, date, isOpen: plan.isOpen, staffLines, blockouts });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Preview failed." }, { status: 500 });
  }
}
