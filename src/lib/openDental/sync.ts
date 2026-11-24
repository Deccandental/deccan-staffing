// Server-only: makes the blockouts in Open Dental match the staffing app.
//
// For each date it works out the blockouts that SHOULD exist (one Staff
// Schedules note in the Notes column, plus one per provider who is out) and
// compares them with the blockouts the app created before (od_blockouts).
// It then creates, updates or deletes only those. Blockouts typed by hand in
// Open Dental are never edited or deleted.
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { todayStr } from "@/lib/today";
import { odConfigured, OdError, createBlockout, updateBlockout, deleteBlockout, listBlockouts, BlockoutInput } from "./client";
import { buildDayPlans, eachDate, DayPlan, StaffLink } from "./dayPlan";
import { buildStaffNoteLines, staffNoteSpan, providerSpan, providerNote, STAFF_NOTE_TITLE, DayTimes } from "./staffNote";

export interface OdSettings {
  enabled: boolean;
  notesOperatoryNum: number | null;
  staffBlockoutType: number | null;
  providerBlockoutType: number | null;
  dayStart: string;
  midday: string;
  dayEnd: string;
  rowMinutes: number;
  daysAhead: number;
}

export async function loadOdSettings(): Promise<OdSettings> {
  const { data } = await supabaseAdmin.from("od_settings").select("*").eq("id", 1).maybeSingle();
  return {
    enabled: !!data?.enabled,
    notesOperatoryNum: data?.notes_operatory_num ?? null,
    staffBlockoutType: data?.staff_blockout_type ?? null,
    providerBlockoutType: data?.provider_blockout_type ?? null,
    dayStart: data?.day_start ?? "07:00",
    midday: data?.midday ?? "12:00",
    dayEnd: data?.day_end ?? "18:00",
    rowMinutes: data?.row_minutes ?? 10,
    daysAhead: data?.days_ahead ?? 60,
  };
}

interface Desired { kind: "staff" | "provider"; employeeId: number | null; input: BlockoutInput }

const keyOf = (kind: string, employeeId: number | null) => `${kind}:${employeeId ?? 0}`;
const hashOf = (b: BlockoutInput) => crypto.createHash("sha256").update(JSON.stringify(b)).digest("hex").slice(0, 32);

/** The blockouts a day should have. Exported so the setup page can preview them without writing anything. */
export function desiredBlockouts(plan: DayPlan, s: OdSettings, links: Map<number, StaffLink>): Desired[] {
  if (!plan.isOpen) return [];
  const times: DayTimes = { dayStart: s.dayStart, midday: s.midday, dayEnd: s.dayEnd, rowMinutes: s.rowMinutes };
  const out: Desired[] = [];
  if ((plan.roster || plan.absences.length > 0) && s.notesOperatoryNum && s.staffBlockoutType) {
    const lines = buildStaffNoteLines(plan.roster, plan.absences);
    const span = staffNoteSpan(lines.length, times);
    out.push({ kind: "staff", employeeId: null, input: {
      date: plan.date, ...span, blockoutType: s.staffBlockoutType, operatoryNums: [s.notesOperatoryNum], note: lines.join("\n"),
    } });
  }
  if (s.providerBlockoutType) {
    for (const a of plan.absences) {
      const link = links.get(a.employeeId);
      if (!link?.provNum || link.operatoryNums.length === 0) continue;
      out.push({ kind: "provider", employeeId: a.employeeId, input: {
        date: plan.date, ...providerSpan(a.half, times), blockoutType: s.providerBlockoutType, operatoryNums: link.operatoryNums, note: providerNote(a),
      } });
    }
  }
  return out;
}

export interface SyncResult { date: string; status: "ok" | "error" | "skipped_manual"; message?: string; changes: number }

async function setDayStatus(date: string, status: SyncResult["status"], message?: string) {
  await supabaseAdmin.from("od_sync_days").upsert({ date, status, message: message ?? null, synced_at: new Date().toISOString() }, { onConflict: "date" });
}

async function syncOneDay(plan: DayPlan, s: OdSettings, links: Map<number, StaffLink>, existing: any[]): Promise<SyncResult> {
  const desired = desiredBlockouts(plan, s, links);
  const have = new Map(existing.map((r) => [keyOf(r.kind, r.employee_id), r]));
  let changes = 0;
  let skippedManual = false;

  // Don't add a second Staff Schedules note to a day the team already filled in by hand.
  if (desired.some((d) => d.kind === "staff") && !have.has(keyOf("staff", null))) {
    const theirs = (await listBlockouts(plan.date)).some((b) =>
      String(b.operatories ?? "").split(",").map((x) => Number(x.trim())).includes(s.notesOperatoryNum!) &&
      String(b.Note ?? "").trim().toLowerCase().startsWith(STAFF_NOTE_TITLE.toLowerCase())
    );
    if (theirs) skippedManual = true;
  }

  for (const d of desired) {
    if (d.kind === "staff" && skippedManual) continue;
    const key = keyOf(d.kind, d.employeeId);
    const rec = have.get(key);
    have.delete(key);
    const hash = hashOf(d.input);
    if (rec && rec.content_hash === hash) continue;
    let scheduleNum: number;
    if (rec) {
      try { await updateBlockout(Number(rec.schedule_num), d.input); scheduleNum = Number(rec.schedule_num); }
      catch (e) {
        // Someone deleted it in Open Dental; put it back.
        if (!(e instanceof OdError) || (e.status !== 404 && e.status !== 400)) throw e;
        scheduleNum = await createBlockout(d.input);
      }
    } else {
      scheduleNum = await createBlockout(d.input);
    }
    changes++;
    const row = { date: plan.date, kind: d.kind, employee_id: d.employeeId, schedule_num: scheduleNum, content_hash: hash, synced_at: new Date().toISOString() };
    const { error } = rec
      ? await supabaseAdmin.from("od_blockouts").update(row).eq("id", rec.id)
      : await supabaseAdmin.from("od_blockouts").insert(row);
    if (error) throw new Error(`Saved in Open Dental but couldn't record it here: ${error.message}`);
  }

  // Anything the app made earlier that's no longer wanted (leave cancelled, day closed...).
  for (const rec of have.values()) {
    await deleteBlockout(Number(rec.schedule_num));
    await supabaseAdmin.from("od_blockouts").delete().eq("id", rec.id);
    changes++;
  }

  return skippedManual
    ? { date: plan.date, status: "skipped_manual", message: "A hand-made Staff Schedules blockout is already on this day, so the app left the Notes column alone.", changes }
    : { date: plan.date, status: "ok", changes };
}

/**
 * Syncs every date in [from, to] (past dates are left alone).
 * Returns per-date results; a failure on one date doesn't stop the others.
 */
export async function syncRange(from: string, to: string): Promise<{ skipped?: string; results: SyncResult[] }> {
  if (!odConfigured()) return { skipped: "Open Dental keys are not set up yet.", results: [] };
  const s = await loadOdSettings();
  if (!s.enabled) return { skipped: "Open Dental sync is turned off.", results: [] };
  const today = todayStr();
  if (from < today) from = today;
  if (to < from) return { results: [] };

  const { plans, links } = await buildDayPlans(from, to);
  const { data: recs, error } = await supabaseAdmin.from("od_blockouts").select("*").gte("date", from).lte("date", to);
  if (error) throw new Error(`Couldn't read the sync record: ${error.message}`);

  const results: SyncResult[] = [];
  for (const plan of plans) {
    try {
      const r = await syncOneDay(plan, s, links, (recs ?? []).filter((x) => x.date === plan.date));
      await setDayStatus(plan.date, r.status, r.message);
      results.push(r);
    } catch (e: any) {
      const message = e?.message ?? "Unknown error.";
      await setDayStatus(plan.date, "error", message);
      results.push({ date: plan.date, status: "error", message, changes: 0 });
      // If Open Dental itself is unreachable or refusing us, the rest will fail the same way.
      if (e instanceof OdError && (e.status === 0 || e.status === 401 || e.status >= 500)) {
        for (const p of plans.slice(plans.indexOf(plan) + 1)) {
          await setDayStatus(p.date, "error", message);
          results.push({ date: p.date, status: "error", message, changes: 0 });
        }
        break;
      }
    }
  }
  return { results };
}

/** today .. today + daysAhead */
export async function syncUpcoming(): Promise<{ skipped?: string; results: SyncResult[] }> {
  const s = await loadOdSettings();
  const dates = eachDate(todayStr(), todayStr());
  const end = new Date(`${dates[0]}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + Math.max(1, Math.min(120, s.daysAhead)));
  return syncRange(dates[0], end.toISOString().slice(0, 10));
}
