import { NextRequest, NextResponse } from "next/server";
import { sessionFrom, hasPerm } from "@/lib/routeAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { odConfigured, listProviders, listOperatories, listBlockoutTypes } from "@/lib/openDental/client";
import { loadOdSettings } from "@/lib/openDental/sync";
import { loadStaffLinks, loadStaffForOd } from "@/lib/openDental/dayPlan";
import { defaultDisplayName } from "@/lib/openDental/staffNote";
import { todayStr } from "@/lib/today";

// The Open Dental setup page: settings, how each staff member maps to Open
// Dental, and (when the keys are in) Open Dental's own lists to pick from.
export const runtime = "nodejs";

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

function gate(req: NextRequest) {
  const session = sessionFrom(req);
  if (!session) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  if (!hasPerm(session, "admin")) return NextResponse.json({ ok: false, error: "Not permitted." }, { status: 403 });
  return null;
}

export async function GET(req: NextRequest) {
  const denied = gate(req);
  if (denied) return denied;
  const [settings, links, staff] = await Promise.all([loadOdSettings(), loadStaffLinks(), loadStaffForOd()]);
  const { data: errorDays } = await supabaseAdmin.from("od_sync_days").select("date, status, message, synced_at")
    .neq("status", "ok").gte("date", todayStr()).order("date").limit(60);
  const { data: lastSync } = await supabaseAdmin.from("od_sync_days").select("synced_at").order("synced_at", { ascending: false }).limit(1);

  let od: { providers: any[]; operatories: any[]; blockoutTypes: any[] } | null = null;
  let odError: string | null = null;
  if (odConfigured()) {
    try {
      const [providers, operatories, blockoutTypes] = await Promise.all([listProviders(), listOperatories(), listBlockoutTypes()]);
      od = {
        providers: providers.map((p) => ({ provNum: p.ProvNum, abbr: p.Abbr, name: `${p.FName ?? ""} ${p.LName ?? ""}`.trim() })),
        operatories: operatories.map((o) => ({ operatoryNum: o.OperatoryNum, name: o.OpName, abbrev: o.Abbrev })),
        blockoutTypes: blockoutTypes.map((d) => ({ defNum: d.DefNum, name: d.ItemName })),
      };
    } catch (e: any) {
      odError = e?.message ?? "Couldn't reach Open Dental.";
    }
  }

  return NextResponse.json({
    ok: true,
    configured: odConfigured(),
    odError,
    od,
    settings,
    staff: staff.filter((e) => !e.archived).map((e) => {
      const l = links.get(e.id);
      return {
        id: e.id, name: e.name, role: e.role,
        displayName: l?.displayName ?? "", defaultDisplayName: defaultDisplayName(e.name, e.role),
        provNum: l?.provNum ?? null, operatoryNums: l?.operatoryNums ?? [],
      };
    }),
    problemDays: errorDays ?? [],
    lastSyncedAt: lastSync?.[0]?.synced_at ?? null,
  });
}

const intOrNull = (v: unknown) => (v === null || v === "" || v === undefined ? null : Number.isInteger(Number(v)) ? Number(v) : NaN);

export async function POST(req: NextRequest) {
  const denied = gate(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const s = body?.settings ?? {};
  const settingsRow = {
    id: 1,
    enabled: !!s.enabled,
    notes_operatory_num: intOrNull(s.notesOperatoryNum),
    staff_blockout_type: intOrNull(s.staffBlockoutType),
    provider_blockout_type: intOrNull(s.providerBlockoutType),
    day_start: String(s.dayStart ?? "07:00"),
    midday: String(s.midday ?? "12:00"),
    day_end: String(s.dayEnd ?? "18:00"),
    row_minutes: Number(s.rowMinutes ?? 10),
    days_ahead: Number(s.daysAhead ?? 60),
    updated_at: new Date().toISOString(),
  };
  if ([settingsRow.notes_operatory_num, settingsRow.staff_blockout_type, settingsRow.provider_blockout_type].some((v) => Number.isNaN(v))) {
    return NextResponse.json({ ok: false, error: "Bad Open Dental number." }, { status: 400 });
  }
  if (![settingsRow.day_start, settingsRow.midday, settingsRow.day_end].every((t) => HM.test(t)) ||
      !(settingsRow.day_start < settingsRow.midday && settingsRow.midday < settingsRow.day_end)) {
    return NextResponse.json({ ok: false, error: "Times must be HH:MM, with the day start before midday before the day end." }, { status: 400 });
  }
  if (!(settingsRow.row_minutes >= 5 && settingsRow.row_minutes <= 60) || !(settingsRow.days_ahead >= 7 && settingsRow.days_ahead <= 120)) {
    return NextResponse.json({ ok: false, error: "Row minutes must be 5–60 and days ahead 7–120." }, { status: 400 });
  }
  if (settingsRow.enabled && (!settingsRow.notes_operatory_num || !settingsRow.staff_blockout_type)) {
    return NextResponse.json({ ok: false, error: "Pick the Notes column and the Staff Schedules blockout type before turning the sync on." }, { status: 400 });
  }

  const links = Array.isArray(body?.links) ? body.links : [];
  const linkRows = [];
  for (const l of links) {
    const employeeId = Number(l?.employeeId);
    const provNum = intOrNull(l?.provNum);
    const ops = Array.isArray(l?.operatoryNums) ? l.operatoryNums.map(Number) : [];
    if (!Number.isInteger(employeeId) || Number.isNaN(provNum) || ops.some((n: number) => !Number.isInteger(n))) {
      return NextResponse.json({ ok: false, error: "Bad staff link." }, { status: 400 });
    }
    linkRows.push({
      employee_id: employeeId,
      display_name: String(l?.displayName ?? "").replace(/[\r\n]/g, " ").trim().slice(0, 30),
      prov_num: provNum,
      operatory_nums: ops,
      updated_at: new Date().toISOString(),
    });
  }

  const { error: e1 } = await supabaseAdmin.from("od_settings").upsert(settingsRow, { onConflict: "id" });
  if (e1) return NextResponse.json({ ok: false, error: e1.message }, { status: 500 });
  if (linkRows.length > 0) {
    const { error: e2 } = await supabaseAdmin.from("od_staff_links").upsert(linkRows, { onConflict: "employee_id" });
    if (e2) return NextResponse.json({ ok: false, error: e2.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
