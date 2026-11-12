// Server-side Secret Santa helpers. Only import from files under src/app/api/.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { APP_URL, sendEmails } from "@/lib/reviewAuth";

export interface SantaEvent {
  id: string; title: string; budget: number; exchange_date: string | null; location: string | null;
  wishlist_due: string | null; notes: string | null; status: "open" | "drawn" | "revealed" | "closed";
  created_at: string; drawn_at: string | null; revealed_at: string | null;
}

/** The Secret Santa that's running now (the newest one that isn't closed). */
export async function currentEvent(): Promise<SantaEvent | null> {
  const { data } = await supabaseAdmin.from("santa_events").select("*").neq("status", "closed").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as SantaEvent) ?? null;
}

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const fmtDay = (d: string | null | undefined) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "";

export function santaEmailHtml(opts: { name: string; heading: string; lines: string[]; event: SantaEvent; button: string }): string {
  const e = opts.event;
  const facts = [
    `Budget: $${Number(e.budget).toFixed(0)} max`,
    e.exchange_date ? `Gift exchange: ${fmtDay(e.exchange_date)}${e.location ? ` at ${e.location}` : ""}` : "",
    e.wishlist_due ? `Wishlists due: ${fmtDay(e.wishlist_due)}` : "",
  ].filter(Boolean);
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#5a5a5a">
    <div style="background:#b91c1c;padding:20px;border-radius:12px 12px 0 0"><h1 style="color:#fff;margin:0;font-size:19px">🎅 ${esc(opts.heading)}</h1></div>
    <div style="background:#f9f9f9;padding:22px;border-radius:0 0 12px 12px">
      <p>Hi ${esc(opts.name.split(" ")[0] || "there")},</p>
      ${opts.lines.map((l) => `<p>${esc(l)}</p>`).join("")}
      <div style="background:#fff;border:1px solid #eee;border-radius:10px;padding:12px 14px;margin:14px 0">
        ${facts.map((f) => `<p style="margin:3px 0;font-size:14px">${esc(f)}</p>`).join("")}
      </div>
      <p style="margin:22px 0"><a href="${APP_URL()}/secret-santa" style="background:#e8622a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${esc(opts.button)}</a></p>
      <p style="font-size:13px">Log in with your PIN and open Secret Santa.</p>
      <p style="color:#888;font-size:12px;margin-top:20px">Deccan Dental</p>
    </div></div>`;
}

/** Email a set of staff (by id). Returns how many were emailed and who has no email on file. */
export async function emailStaff(ids: number[], build: (name: string) => { subject: string; html: string }) {
  if (ids.length === 0) return { emailed: 0, noEmail: [] as string[], failed: false };
  const { data } = await supabaseAdmin.from("staff").select("id, name, email, archived").in("id", ids);
  const people = (data ?? []).filter((p: any) => !p.archived);
  const withEmail = people.filter((p: any) => !!p.email);
  const ok = await sendEmails(withEmail.map((p: any) => ({ to: p.email, ...build(p.name) })));
  return { emailed: ok ? withEmail.length : 0, noEmail: people.filter((p: any) => !p.email).map((p: any) => p.name), failed: !ok && withEmail.length > 0 };
}
