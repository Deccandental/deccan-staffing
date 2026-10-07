import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Today's date in the practice's time zone (San Mateo), as YYYY-MM-DD.
export function practiceToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

// Statements set to autopay are marked paid once their due date arrives. This runs whenever the
// statements are loaded, so no scheduled job is needed. It never throws: if the new columns aren't
// in the database yet it simply does nothing.
export async function applyAutopay(): Promise<number> {
  try {
    const today = practiceToday();
    const { data, error } = await supabaseAdmin.from("statement_files")
      .select("id, due_date, paid_from_kind")
      .eq("autopay", true).eq("paid", false).not("due_date", "is", null).lte("due_date", today);
    if (error || !data || data.length === 0) return 0;
    for (const r of data as any[]) {
      await supabaseAdmin.from("statement_files")
        .update({ paid: true, paid_date: r.due_date, paid_auto: true, paid_method: r.paid_from_kind === "card" ? "card" : "ach" })
        .eq("id", r.id).eq("paid", false);
    }
    return data.length;
  } catch {
    return 0;
  }
}
