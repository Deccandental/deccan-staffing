// Browser-side: asks the server to update Open Dental after something that
// changes the schedule is saved. Calls made within a few seconds of each
// other are merged into one request covering every date touched, so
// approving a two-week leave (one save per day) sends a single sync.
//
// Fire-and-forget: if Open Dental isn't set up, or the call fails, nothing in
// the app is affected — the nightly sync and the Retry button catch up later.
import { sessionHeaders } from "@/lib/secureData";

const WAIT_MS = 4000;
let pending: { from: string; to: string } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function requestOdSync(from: string, to: string = from): void {
  if (typeof window === "undefined" || !from) return;
  if (to < from) [from, to] = [to, from];
  pending = pending ? { from: from < pending.from ? from : pending.from, to: to > pending.to ? to : pending.to } : { from, to };
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, WAIT_MS);
}

function flush() {
  const range = pending;
  pending = null;
  timer = null;
  if (!range) return;
  fetch("/api/opendental/sync", { method: "POST", headers: sessionHeaders(), body: JSON.stringify(range), keepalive: true })
    .catch(() => { /* picked up by the nightly sync */ });
}

/** Runs a sync now and waits for the answer (used by Retry / Sync now buttons). */
export async function syncOdNow(body: { from: string; to: string } | { all: true }): Promise<{ ok: boolean; skipped?: string; changes?: number; errors?: { date: string; message: string }[]; error?: string }> {
  try {
    const res = await fetch("/api/opendental/sync", { method: "POST", headers: sessionHeaders(), body: JSON.stringify(body) });
    return await res.json();
  } catch {
    return { ok: false, error: "Network error." };
  }
}
