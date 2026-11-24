// Server-only: a thin wrapper around the Open Dental REST API.
//
// Requests are authorized with the practice's two keys, read from the
// environment (never stored in the database or sent to the browser):
//   OPEN_DENTAL_DEVELOPER_KEY   from the API portal's Account page
//   OPEN_DENTAL_CUSTOMER_KEY    created in the portal for Deccan Dental
// The practice's eConnector must be running for remote calls to reach it.
//
// Every endpoint and field name the app depends on is in this one file, so
// if Open Dental's naming differs from what is here it is fixed in one place.

const BASE_URL = (process.env.OPEN_DENTAL_API_URL || "https://api.opendental.com/api/v1").replace(/\/$/, "");
// Open Dental returns at most this many rows per request; larger lists are paged with Offset.
const PAGE_SIZE = 100;

export function odConfigured(): boolean {
  return !!(process.env.OPEN_DENTAL_DEVELOPER_KEY && process.env.OPEN_DENTAL_CUSTOMER_KEY);
}

export class OdError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Open Dental answers 404, or 400 "...not found", for a ScheduleNum that no longer exists. */
export function isNotFound(e: OdError): boolean {
  return e.status === 404 || (e.status === 400 && /not found|does not exist|invalid schedulenum/i.test(e.message));
}

async function od<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  if (!odConfigured()) throw new OdError("Open Dental keys are not set up yet.", 0);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `ODFHIR ${process.env.OPEN_DENTAL_DEVELOPER_KEY}/${process.env.OPEN_DENTAL_CUSTOMER_KEY}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch (e: any) {
    throw new OdError(`Couldn't reach Open Dental (${e?.message ?? "network error"}).`, 0);
  }
  const text = await res.text();
  if (!res.ok) {
    // Open Dental's error bodies are short plain-text explanations; keep them, minus anything long.
    const detail = text.replace(/\s+/g, " ").trim().slice(0, 300);
    const hint = res.status === 401 ? " Check the developer and customer keys."
      : /econnector/i.test(detail) ? " Is the eConnector running at the office?" : "";
    throw new OdError(`Open Dental said ${res.status}${detail ? `: ${detail}` : ""}.${hint}`, res.status);
  }
  if (!text) return undefined as T;
  try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
}

async function getAll<T>(path: string, params: Record<string, string | number | undefined>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
    if (offset) q.set("Offset", String(offset));
    const page = await od<T[]>("GET", `${path}${q.toString() ? `?${q}` : ""}`);
    if (!Array.isArray(page)) break;
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
    if (offset > 20000) break; // runaway guard
  }
  return out;
}

// ---- reference lists (read-only, free) -------------------------------------

export interface OdProvider { ProvNum: number; Abbr: string; FName: string; LName: string; IsHidden?: string | boolean; IsSecondary?: string | boolean }
export interface OdOperatory { OperatoryNum: number; OpName: string; Abbrev: string; IsHidden?: string | boolean }
export interface OdDefinition { DefNum: number; ItemName: string; IsHidden?: string | boolean }

const truthy = (v: unknown) => v === true || v === "true";

export async function listProviders(): Promise<OdProvider[]> {
  return (await getAll<OdProvider>("/providers", {})).filter((p) => !truthy(p.IsHidden));
}
export async function listOperatories(): Promise<OdOperatory[]> {
  return (await getAll<OdOperatory>("/operatories", {})).filter((o) => !truthy(o.IsHidden));
}
/** Blockout types are definitions in category 25. */
export async function listBlockoutTypes(): Promise<OdDefinition[]> {
  return (await getAll<OdDefinition>("/definitions", { Category: 25 })).filter((d) => !truthy(d.IsHidden));
}

// ---- blockouts --------------------------------------------------------------

export interface OdBlockout {
  ScheduleNum: number;
  SchedDate: string;   // yyyy-MM-dd
  StartTime: string;   // HH:mm:ss
  StopTime: string;
  BlockoutType: number;
  Note: string;
  operatories: string; // comma-separated OperatoryNums
}

export interface BlockoutInput {
  date: string;        // yyyy-MM-dd
  start: string;       // HH:mm
  stop: string;        // HH:mm
  blockoutType: number;
  operatoryNums: number[];
  note: string;
}

const hms = (hm: string) => (hm.length === 5 ? `${hm}:00` : hm);

function blockoutBody(b: BlockoutInput) {
  return {
    SchedDate: b.date,
    StartTime: hms(b.start),
    StopTime: hms(b.stop),
    BlockoutType: b.blockoutType,
    operatoryNums: b.operatoryNums.join(","),
    Note: b.note,
  };
}

export async function listBlockouts(date: string): Promise<OdBlockout[]> {
  return getAll<OdBlockout>("/schedules", { date, SchedType: "Blockout" });
}

export async function getSchedule(scheduleNum: number): Promise<OdBlockout | null> {
  try { return await od<OdBlockout>("GET", `/schedules/${scheduleNum}`); }
  catch (e) { if (e instanceof OdError && (e.status === 404 || e.status === 400)) return null; throw e; }
}

export async function createBlockout(b: BlockoutInput): Promise<number> {
  const res = await od<Partial<OdBlockout>>("POST", "/schedules/Blockout", blockoutBody(b));
  const num = Number(res?.ScheduleNum);
  if (!num) throw new OdError("Open Dental created the blockout but didn't return its number.", 0);
  return num;
}

export async function updateBlockout(scheduleNum: number, b: BlockoutInput): Promise<void> {
  await od("PUT", `/schedules/${scheduleNum}/Blockout`, blockoutBody(b));
}

/** Deletes a blockout; one that is already gone counts as deleted. */
export async function deleteBlockout(scheduleNum: number): Promise<void> {
  try { await od("DELETE", `/schedules/${scheduleNum}/Blockout`); }
  catch (e) { if (e instanceof OdError && isNotFound(e)) return; throw e; }
}

// ---- appointments (read-only, free) -----------------------------------------

export interface OdAppointment { AptNum: number; AptDateTime: string; AptStatus: string; ProvNum: number; ProvHyg: number; Op: number }

/** Appointments booked between two dates (inclusive). */
export async function listAppointments(dateStart: string, dateEnd: string): Promise<OdAppointment[]> {
  return getAll<OdAppointment>("/appointments", { dateStart, dateEnd });
}
