import { supabase } from "./supabase";

export interface StaffEvent {
  id: string;
  date: string;
  time: string;
  title: string;
  description: string;
  mandatory: boolean;
  inviteAll: boolean;
  invitedStaffIds: number[];
  remind1Day: boolean;
  remind1Week: boolean;
  remind3Weeks: boolean;
  remindersSent: Record<string, boolean>;
  announced: boolean;
  createdAt: string;
}

export interface NewEventInput {
  date: string;
  time: string;
  title: string;
  description: string;
  mandatory: boolean;
  inviteAll: boolean;
  invitedStaffIds: number[];
  remind1Day: boolean;
  remind1Week: boolean;
  remind3Weeks: boolean;
}

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

export async function loadEventsForMonth(year: number, month: number): Promise<StaffEvent[]> {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .like("date", `${key}-%`)
    .order("date")
    .order("time");
  if (error) { console.error("loadEventsForMonth error:", error); return []; }
  return (data ?? []).map(fromRow);
}

export async function loadUpcomingEvents(fromDate: string): Promise<StaffEvent[]> {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .gte("date", fromDate)
    .order("date")
    .order("time");
  if (error) { console.error("loadUpcomingEvents error:", error); return []; }
  return (data ?? []).map(fromRow);
}

export async function createEvent(input: NewEventInput): Promise<StaffEvent | null> {
  const { data, error } = await supabase
    .from("events")
    .insert({
      date: input.date,
      time: input.time,
      title: input.title,
      description: input.description,
      mandatory: input.mandatory,
      invite_all: input.inviteAll,
      invited_staff_ids: input.invitedStaffIds,
      remind_1_day: input.remind1Day,
      remind_1_week: input.remind1Week,
      remind_3_weeks: input.remind3Weeks,
    })
    .select()
    .single();
  if (error) { console.error("createEvent error:", error); return null; }
  return fromRow(data);
}

export async function deleteEvent(id: string): Promise<void> {
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) console.error("deleteEvent error:", error);
}

export async function markAnnounced(id: string): Promise<void> {
  const { error } = await supabase.from("events").update({ announced: true }).eq("id", id);
  if (error) console.error("markAnnounced error:", error);
}
