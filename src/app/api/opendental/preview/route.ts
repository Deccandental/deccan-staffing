import { NextRequest, NextResponse } from "next/server";
import { sessionFrom, hasPerm } from "@/lib/routeAuth";
import { buildDayPlans } from "@/lib/openDental/dayPlan";
import { ensureCharges } from "@/lib/charge";
import { buildAppBlockLines } from "@/lib/openDental/staffNote";
import { desiredBlockouts, loadOdSettings, bookingWarnings } from "@/lib/openDental/sync";

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
    await ensureCharges(date).catch(() => undefined);
    const [{ plans, links, staff }, settings] = await Promise.all([buildDayPlans(date, date), loadOdSettings()]);
    const plan = plans[0];
    // Booking checks need Open Dental; without it the preview simply leaves them out.
    const extra = (await bookingWarnings(plans, links, staff, settings).catch(() => new Map<string, string[]>())).get(date) ?? [];
    const staffLines = plan.content ? buildAppBlockLines({ ...plan.content, warnings: [...plan.content.warnings, ...extra] }) : [];
    const blockouts = desiredBlockouts(plan, settings, links, extra).map((d) => ({
      kind: d.kind, start: d.input.start, stop: d.input.stop, operatoryNums: d.input.operatoryNums, note: d.input.note,
    }));
    return NextResponse.json({ ok: true, date, isOpen: plan.isOpen || !!plan.content, staffLines, blockouts });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Preview failed." }, { status: 500 });
  }
}
