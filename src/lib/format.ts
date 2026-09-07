/** Formats a number as a plain 2-decimal string for dollar displays (no $
 * sign — callers prepend that themselves, matching existing usage). Avoids
 * floating-point artifacts like 4044.000000000001 leaking into the UI. */
export function formatMoney(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
