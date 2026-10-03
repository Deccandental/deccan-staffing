/** Formats a number as a plain 2-decimal string for dollar displays (no $
 * sign — callers prepend that themselves, matching existing usage). Avoids
 * floating-point artifacts like 4044.000000000001 leaking into the UI. */
export function formatMoney(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "$1,234.50", or "−$1,234.50" for negatives (rather than "$-1,234.50"). */
export function formatUSD(n: number): string {
  return `${n < 0 ? "−" : ""}$${formatMoney(Math.abs(n))}`;
}

/**
 * Sorts people by surname.
 *
 * Names are stored as a single field, so the surname has to be inferred:
 * drop any leading title ("Dr."), then take the last word — which handles
 * "Dr. Coulter" (Coulter), "Margot Gonzales" (Gonzales) and "Karla G" (G)
 * alike. Someone recorded with a single name sorts on that name. Ties fall
 * back to the full name so the order stays stable rather than shuffling
 * between renders.
 */
export function lastNameOf(fullName: string): string {
  const cleaned = fullName.trim().replace(/^(dr\.?|mr\.?|mrs\.?|ms\.?)\s+/i, "");
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return (parts[parts.length - 1] ?? cleaned).toLowerCase();
}

export function byLastName<T extends { name: string }>(a: T, b: T): number {
  const cmp = lastNameOf(a.name).localeCompare(lastNameOf(b.name));
  return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
}
