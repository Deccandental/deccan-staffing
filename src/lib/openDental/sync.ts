// Server-only: makes the blockouts in Open Dental match the staffing app.
//
// For each date it works out the blockouts that SHOULD exist (one Staff
// Schedules note in the Notes column, plus one per provider who is out) and
// compares them with the blockouts the app created before (od_blockouts).
// It then creates, updates or deletes only those. Blockouts typed by hand in
// Open Dental are never edited or deleted.
//
// The team may also edit the app's Staff Schedules note in Open Dental:
//   - lines they ADD are kept (at the bottom) when the app updates the note;
//   - if they CHANGE or remove one of the app's lines, the app stops updating
//     that day's note and flags it on the Open Dental page;
//   - if they DELETE the note, it stays deleted.
// An admin can override either with "Use the staffing app's version".
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { todayStr } from "@/lib/today";
import { odConfigured, OdError, OdBlockout, createBlockout, updateBlockout, deleteBlockout, listBlockouts, BlockoutInput } from "./client";
import { buildDayPlans, eachDate, DayPlan, StaffLink } from "./dayPlan";
import { buildStaffNoteLines, staffNoteSpan, providerSpan, providerNote, STAFF_NOTE_TITLE, DayTimes, splitLines, mergeStaffNote } from "./staffNote";

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

export interface SyncResult { date: string; status: "ok" | "error" | "skipped_manual" | "edited_in_od" | "deleted_in_od"; message?: string; changes: number }

async function setDayStatus(date: string, status: SyncResult["status"], message?: string) {
  await supabaseAdmin.from("od_sync_days").upsert({ date, status, message: message ?? null, synced_at: new Date().toISOString() }, { onConflict: "date" });
}

const sameOps = (a: string, b: number[]) =>
  String(a ?? "").split(",").map((x) => Number(x.trim())).filter(Boolean).sort().join(",") === [...b].sort().join(",");

/**
 * Brings one day in Open Dental in line with the app.
 * `force` (admin's "Use the staffing app's version"): the staff note is
 * rewritten exactly as the app has it, and put back if it was deleted.
 */
async function syncOneDay(plan: DayPlan, s: OdSettings, links: Map<number, StaffLink>, existing: any[], force: boolean): Promise<SyncResult> {
  const desired = desiredBlockouts(plan, s, links);
  const have = new Map(existing.map((r) => [keyOf(r.kind, r.employee_id), r]));
  const times: DayTimes = { dayStart: s.dayStart, midday: s.midday, dayEnd: s.dayEnd, rowMinutes: s.rowMinutes };
  let changes = 0;
  const flags: { status: SyncResult["status"]; message: string }[] = [];

  // What's on this day in Open Dental right now — read only when needed.
  let odDay: OdBlockout[] | null = null;
  const inOd = async () => (odDay ??= await listBlockouts(plan.date));
  const findInOd = async (num: number) => (await inOd()).find((b) => Number(b.ScheduleNum) === num) ?? null;

  async function record(rec: any, d: Desired, scheduleNum: number, extra: Record<string, unknown> = {}) {
    const row = { date: plan.date, kind: d.kind, employee_id: d.employeeId, schedule_num: scheduleNum, content_hash: hashOf(d.input), synced_at: new Date().toISOString(), deleted_in_od: false, ...extra };
    const { error } = rec
      ? await supabaseAdmin.from("od_blockouts").update(row).eq("id", rec.id)
      : await supabaseAdmin.from("od_blockouts").insert(row);
    if (error) throw new Error(`Saved in Open Dental but couldn't record it here: ${error.message}`);
  }

  for (const d of desired) {
    const key = keyOf(d.kind, d.employeeId);
    const rec = have.get(key);
    have.delete(key);
    const hash = hashOf(d.input);

    if (d.kind === "staff") {
      const desiredLines = splitLines(d.input.note);
      if (!rec) {
        // Don't add a second note to a day the team already filled in by hand.
        const theirs = (await inOd()).some((b) => sameOps(b.operatories, [s.notesOperatoryNum!]) &&
          String(b.Note ?? "").trim().toLowerCase().startsWith(STAFF_NOTE_TITLE.toLowerCase()));
        if (theirs) {
          flags.push({ status: "skipped_manual", message: "A hand-made Staff Schedules blockout is already on this day, so the app left the Notes column alone. Delete it in Open Dental if you'd like the app to take this day over." });
          continue;
        }
        await record(null, d, await createBlockout(d.input), { last_note: d.input.note });
        changes++;
        continue;
      }
      if (rec.deleted_in_od && !force) {
        flags.push({ status: "deleted_in_od", message: "The Staff Schedules note was deleted in Open Dental, so the app is leaving this day alone." });
        continue;
      }
      if (rec.content_hash === hash && !rec.deleted_in_od && !force) continue; // nothing new to write

      const current = rec.deleted_in_od ? null : await findInOd(Number(rec.schedule_num));
      if (!current) {
        if (force) { await record(rec, d, await createBlockout(d.input), { last_note: d.input.note }); changes++; }
        else {
          await supabaseAdmin.from("od_blockouts").update({ deleted_in_od: true }).eq("id", rec.id);
          flags.push({ status: "deleted_in_od", message: "The Staff Schedules note was deleted in Open Dental, so the app is leaving this day alone." });
        }
        continue;
      }
      if (force) {
        await updateBlockout(Number(rec.schedule_num), d.input);
        await record(rec, d, Number(rec.schedule_num), { last_note: d.input.note });
        changes++;
        continue;
      }
      const merge = mergeStaffNote(splitLines(current.Note), rec.last_note ? splitLines(rec.last_note) : null, desiredLines);
      if (merge.action === "conflict") {
        const parts = [
          merge.theirs.length ? `Open Dental has: ${merge.theirs.join(" · ")}` : "",
          merge.ours.length ? `the app had: ${merge.ours.join(" · ")}` : "",
        ].filter(Boolean).join("; ");
        flags.push({ status: "edited_in_od", message: `Someone changed the Staff Schedules note in Open Dental (${parts}). The app hasn't overwritten it. Update the Schedule Builder to match, or use the staffing app's version.` });
        continue;
      }
      if (merge.action === "write") {
        const input = { ...d.input, ...staffNoteSpan(merge.lines.length, times), note: merge.lines.join("\n") };
        await updateBlockout(Number(rec.schedule_num), input);
        changes++;
      }
      await record(rec, d, Number(rec.schedule_num), { last_note: d.input.note });
      continue;
    }

    // Provider blockouts follow approved leave strictly: changed or deleted in Open Dental, they're put back.
    if (rec) {
      const current = await findInOd(Number(rec.schedule_num));
      const intact = current && rec.content_hash === hash &&
        String(current.StartTime).slice(0, 5) === d.input.start && String(current.StopTime).slice(0, 5) === d.input.stop &&
        sameOps(current.operatories, d.input.operatoryNums);
      if (intact) continue;
      if (current) await updateBlockout(Number(rec.schedule_num), d.input);
      await record(rec, d, current ? Number(rec.schedule_num) : await createBlockout(d.input));
    } else {
      await record(null, d, await createBlockout(d.input));
    }
    changes++;
  }

  // Anything the app made earlier that's no longer wanted (leave cancelled, day closed...).
  for (const rec of have.values()) {
    if (!rec.deleted_in_od) await deleteBlockout(Number(rec.schedule_num));
    await supabaseAdmin.from("od_blockouts").delete().eq("id", rec.id);
    changes++;
  }

  const order: SyncResult["status"][] = ["edited_in_od", "deleted_in_od", "skipped_manual"];
  const top = flags.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))[0];
  return top ? { date: plan.date, status: top.status, message: top.message, changes } : { date: plan.date, status: "ok", changes };
}

/**
 * Syncs every date in [from, to] (past dates are left alone).
 * Returns per-date results; a failure on one date doesn't stop the others.
 */
export async function syncRange(from: string, to: string, opts: { force?: boolean } = {}): Promise<{ skipped?: string; results: SyncResult[] }> {
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
      const r = await syncOneDay(plan, s, links, (recs ?? []).filter((x) => x.date === plan.date), !!opts.force);
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
