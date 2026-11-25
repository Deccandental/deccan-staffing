import { NextRequest, NextResponse } from "next/server";
import { sessionFrom, hasPerm } from "@/lib/routeAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rowToLeave, leaveHalfOnDate } from "@/lib/leaveStore";
import { odConfigured, listAppointments } from "@/lib/openDental/client";
import { loadOdSettings } from "@/lib/openDental/sync";
import { loadStaffLinks, eachDate } from "@/lib/openDental/dayPlan";
import { toMinutes } from "@/lib/openDental/staffNote";

// For the Manage Leave page: how many patients are booked with this person on
// the requested days (read-only, so it costs nothing), and whether the leave
// has made it onto the Open Dental schedule yet.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = sessionFrom(req);
  if (!session) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  if (!hasPerm(session, "leaveManage")) return NextResponse.json({ ok: false, error: "Not permitted." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { data: row } = await supabaseAdmin.from("leave_requests").select("*").eq("id", String(body?.requestId ?? "")).maybeSingle();
  if (!row) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  const r = rowToLeave(row);

  const [settings, links] = await Promise.all([loadOdSettings(), loadStaffLinks()]);
  const link = links.get(r.employeeId);
  const isProvider = !!link?.provNum;
  const configured = odConfigured();
  const dates = eachDate(r.startDate, r.endDate);

  // Booked patients, per day — only for doctors and hygienists linked to an Open Dental provider.
  let booked: { date: string; count: number }[] | null = null;
  let bookedError: string | null = null;
  if (configured && isProvider && (r.status === "pending" || r.status === "approved")) {
    try {
      // One day past the end, in case Open Dental treats dateEnd as exclusive; extra days are filtered out below.
      const after = new Date(`${r.endDate}T12:00:00Z`);
      after.setUTCDate(after.getUTCDate() + 1);
      const appts = await listAppointments(r.startDate, after.toISOString().slice(0, 10));
      const midday = toMinutes(settings.midday);
      booked = dates.map((date) => {
        const half = leaveHalfOnDate(r, date);
        const count = appts.filter((a) => {
          const [d, t = "00:00"] = String(a.AptDateTime ?? "").split(" ");
          if (d !== date || (a.ProvNum !== link!.provNum && a.ProvHyg !== link!.provNum)) return false;
          if (!/^(Scheduled|ASAP)$/i.test(String(a.AptStatus ?? ""))) return false;
          const m = toMinutes(t.slice(0, 5));
          return half === "AM" ? m < midday : half === "PM" ? m >= midday : true;
        }).length;
        return { date, count };
      }).filter((x) => x.count > 0);
    } catch (e: any) {
      bookedError = e?.message ?? "Couldn't check Open Dental.";
    }
  }

  // Sync status for approved leave.
  let sync: { state: "synced" | "pending" | "error" | "attention" | "off"; message?: string } = { state: "off" };
  if (configured && settings.enabled && r.status === "approved") {
    const [{ data: dayRows }, { data: recs }] = await Promise.all([
      supabaseAdmin.from("od_sync_days").select("date, status, message, synced_at").gte("date", r.startDate).lte("date", r.endDate),
      supabaseAdmin.from("od_blockouts").select("date, kind, employee_id").gte("date", r.startDate).lte("date", r.endDate),
    ]);
    const err = (dayRows ?? []).find((d: any) => d.status === "error");
    const flagged = (dayRows ?? []).find((d: any) => d.status === "edited_in_od" || d.status === "deleted_in_od" || d.status === "skipped_manual");
    const reviewedAt = r.reviewedAt ?? "";
    const stale = (dayRows ?? []).length === 0 || (dayRows ?? []).some((d: any) => d.synced_at < reviewedAt);
    const today = new Date().toISOString().slice(0, 10);
    const allPast = r.endDate < today;
    if (err) sync = { state: "error", message: err.message ?? "Sync failed." };
    else if (flagged && !isProvider) sync = { state: "attention", message: "The Deccan App blockout for one of these days was edited or deleted in Open Dental — see the Open Dental page." };
    else if (stale && !allPast) sync = { state: "pending" };
    else sync = { state: "synced", message: isProvider
      ? `${(recs ?? []).filter((x: any) => x.kind === "provider" && x.employee_id === r.employeeId).length} provider blockout(s) in Open Dental`
      : "Listed in the Deccan App blockout" };
  }

  return NextResponse.json({ ok: true, configured, enabled: settings.enabled, isProvider, booked, bookedError, sync });
}
