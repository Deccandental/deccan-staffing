import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendEventEmail, EventEmailType } from "@/lib/eventEmail";
import { StaffEvent } from "@/lib/eventsStore";

function fromRow(row: any): StaffEvent {
  return {
    id: row.id,
    date: row.date,
    time: row.time ?? "",
    title: row.title,
    description: row.description ?? "",
    mandatory: row.mandatory ?? false,
    inviteAll: row.invite_all ?? true,
    invitedStaffIds: row.invited_staff_ids ?? [],
    remind1Day: row.remind_1_day ?? true,
    remind1Week: row.remind_1_week ?? true,
    remind3Weeks: row.remind_3_weeks ?? false,
    remindersSent: row.reminders_sent ?? {},
    announced: row.announced ?? false,
    createdAt: row.created_at,
  };
}

// Whole-day difference computed from the date-only strings (UTC midnight for
// both sides) so this is stable regardless of the server's local timezone —
// avoids the classic off-by-one from mixing local time with a stored date.
function daysUntil(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86400000);
}

const THRESHOLDS: { days: number; key: string; type: EventEmailType; flagField: keyof StaffEvent }[] = [
  { days: 1, key: "day1", type: "reminder-1day", flagField: "remind1Day" },
  { days: 7, key: "week1", type: "reminder-1week", flagField: "remind1Week" },
  { days: 21, key: "week3", type: "reminder-3weeks", flagField: "remind3Weeks" },
];

export async function GET(req: NextRequest) {
  // Vercel Cron sends this header automatically; also accept a manually
  // configured CRON_SECRET for calling it by hand to test. If no secret is
  // configured at all, allow the call through (so this doesn't silently
  // break before CRON_SECRET is set up) but log a warning.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else {
    console.warn("CRON_SECRET is not set — /api/events/send-reminders is unauthenticated");
  }

  const todayStr = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase.from("events").select("*").gte("date", todayStr);
  if (error) {
    console.error("send-reminders load error:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const events = (data ?? []).map(fromRow);
  const results: { eventId: string; type: string; sent: boolean }[] = [];

  for (const event of events) {
    const remaining = daysUntil(event.date);
    for (const t of THRESHOLDS) {
      if (remaining !== t.days) continue;
      if (!event[t.flagField]) continue;
      if (event.remindersSent[t.key]) continue;

      const sent = await sendEventEmail(event, t.type);
      results.push({ eventId: event.id, type: t.type, sent });
      if (sent) {
        const updatedFlags = { ...event.remindersSent, [t.key]: true };
        await supabase.from("events").update({ reminders_sent: updatedFlags }).eq("id", event.id);
      }
    }
  }

  return NextResponse.json({ ok: true, checked: events.length, sent: results });
}
