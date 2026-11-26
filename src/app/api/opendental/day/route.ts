import { NextRequest, NextResponse } from "next/server";
import { sessionFrom, hasPerm } from "@/lib/routeAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildDayPlans } from "@/lib/openDental/dayPlan";
import { ensureCharges } from "@/lib/charge";
import { autoLines, buildAppBlockLines, splitLines, plain, APP_BLOCK_TITLE } from "@/lib/openDental/staffNote";
import { bookingWarnings, loadOdSettings, syncRange } from "@/lib/openDental/sync";
import { odConfigured, listBlockouts } from "@/lib/openDental/client";

// The "Open Dental blockout" section of a day in the Schedule Builder.
//   { date, action: "get" }      what the app will write, the team's changes, and what Open Dental shows now
//   { date, action: "save", extraLines, override }   save changes made in the app, then send them to Open Dental
//   { date, action: "useApp" }   Open Dental was edited or deleted there: replace it with the app's version
//   { date, action: "useOd" }    keep what Open Dental shows, and make it the app's version for this day
//   { date, action: "month" }    each day's Open Dental status for date's month (calendar dots)
//   { date, action: "setEnabled", enabled }   turn the sync on or off (admins)
// Viewing needs leave or admin access; changing needs admin (like the Schedule Builder).
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_LINES = 60;

async function describe(date: string) {
  await ensureCharges(date).catch(() => undefined);
  const [{ plans, links, staff }, settings] = await Promise.all([buildDayPlans(date, date), loadOdSettings()]);
  const plan = plans[0];
  const extra = (await bookingWarnings(plans, links, staff, settings).catch(() => new Map<string, string[]>())).get(date) ?? [];
  const content = plan.content ? { ...plan.content, warnings: [...plan.content.warnings, ...extra] } : null;

  const [{ data: sched }, { data: status }, { data: rec }] = await Promise.all([
    supabaseAdmin.from("schedules").select("date").eq("date", date).maybeSingle(),
    supabaseAdmin.from("od_sync_days").select("status, message, synced_at").eq("date", date).maybeSingle(),
    supabaseAdmin.from("od_blockouts").select("schedule_num, deleted_in_od").eq("date", date).eq("kind", "staff").maybeSingle(),
  ]);

  // What Open Dental shows right now (reading is free).
  let inOd: { lines: string[]; start: string; stop: string } | null = null;
  let odError: string | null = null;
  if (odConfigured() && rec && !rec.deleted_in_od) {
    try {
      const b = (await listBlockouts(date)).find((x) => Number(x.ScheduleNum) === Number(rec.schedule_num));
      if (b) inOd = { lines: splitLines(b.Note), start: String(b.StartTime).slice(0, 5), stop: String(b.StopTime).slice(0, 5) };
    } catch (e: any) { odError = e?.message ?? "Couldn't read Open Dental."; }
  }

  return {
    ok: true,
    date,
    hasBlock: !!content,
    canSave: !!sched,
    configured: odConfigured(),
    enabled: settings.enabled,
    title: APP_BLOCK_TITLE,
    auto: content ? autoLines(content) : [],
    extraLines: content?.extraLines ?? [],
    override: content?.override ?? null,
    final: content ? buildAppBlockLines(content) : [],
    status: status ?? null,
    deletedInOd: !!rec?.deleted_in_od,
    inOd,
    odError,
  };
}

const cleanLines = (v: unknown) => (Array.isArray(v) ? v : String(v ?? "").split(/\r?\n/))
  .map((l) => plain(String(l)).slice(0, 120)).filter(Boolean).slice(0, MAX_LINES);

export async function POST(req: NextRequest) {
  const session = sessionFrom(req);
  if (!session) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  const canView = hasPerm(session, "admin") || hasPerm(session, "leaveManage");
  if (!canView) return NextResponse.json({ ok: false, error: "Not permitted." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const date = String(body?.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ ok: false, error: "Bad date." }, { status: 400 });
  const action = String(body?.action ?? "get");

  // Turn the sync on or off from the Schedule Builder (admins).
  if (action === "setEnabled") {
    if (!hasPerm(session, "admin")) return NextResponse.json({ ok: false, error: "Only an admin can turn the sync on or off." }, { status: 403 });
    const enabled = body?.enabled === true;
    const s = await loadOdSettings();
    if (enabled && (!s.notesOperatoryNum || !s.staffBlockoutType)) {
      return NextResponse.json({ ok: false, error: "Pick the Notes column and the Deccan App blockout type on the Open Dental page first." }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from("od_settings").update({ enabled, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, enabled });
  }

  // The month's Open Dental status, for the dots on the Schedule Builder calendar.
  if (action === "month") {
    const from = `${date.slice(0, 7)}-01`;
    const to = `${date.slice(0, 7)}-31`;
    const [settings, { data: days }, { data: recs }] = await Promise.all([
      loadOdSettings(),
      supabaseAdmin.from("od_sync_days").select("date, status").gte("date", from).lte("date", to),
      supabaseAdmin.from("od_blockouts").select("date").eq("kind", "staff").gte("date", from).lte("date", to),
    ]);
    const statuses: Record<string, string> = {};
    for (const d of days ?? []) statuses[d.date] = d.status;
    const sent = new Set((recs ?? []).map((r: any) => r.date));
    for (const [d, st] of Object.entries(statuses)) if (st === "ok" && !sent.has(d)) delete statuses[d];
    return NextResponse.json({ ok: true, configured: odConfigured(), enabled: settings.enabled, ready: !!(settings.notesOperatoryNum && settings.staffBlockoutType), statuses });
  }

  try {
    if (action !== "get") {
      if (!hasPerm(session, "admin")) return NextResponse.json({ ok: false, error: "Only an admin can change the blockout." }, { status: 403 });
      const { data: sched } = await supabaseAdmin.from("schedules").select("date").eq("date", date).maybeSingle();
      let sync: Awaited<ReturnType<typeof syncRange>> | null = null;

      if (action === "save") {
        if (!sched) return NextResponse.json({ ok: false, error: "Open this day in the Schedule Builder first." }, { status: 400 });
        const override = body?.override === null || body?.override === undefined ? null : cleanLines(body.override);
        const { error } = await supabaseAdmin.from("schedules").update({
          od_extra_lines: cleanLines(body?.extraLines).join("\n") || null,
          od_override: override && override.length > 0 ? override.join("\n") : null,
        }).eq("date", date);
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        sync = await syncRange(date, date);
      } else if (action === "useApp") {
        sync = await syncRange(date, date, { force: true });
      } else if (action === "useOd") {
        if (!sched) return NextResponse.json({ ok: false, error: "Open this day in the Schedule Builder first." }, { status: 400 });
        const now = await describe(date);
        if (!now.inOd) return NextResponse.json({ ok: false, error: "There's no Deccan App blockout in Open Dental for this day." }, { status: 400 });
        const { error } = await supabaseAdmin.from("schedules").update({ od_override: now.inOd.lines.join("\n") }).eq("date", date);
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        sync = await syncRange(date, date);
      } else {
        return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
      }
      const result = sync?.results[0];
      const info = await describe(date);
      return NextResponse.json({ ...info, synced: sync?.skipped ? { skipped: sync.skipped } : result ? { status: result.status, message: result.message } : null });
    }
    return NextResponse.json(await describe(date));
  } catch (e: any) {
    console.error("Open Dental day route failed:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Something went wrong." }, { status: 500 });
  }
}
