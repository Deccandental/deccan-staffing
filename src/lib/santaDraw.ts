// Secret Santa name draw. Pure function, no database: used by the server route that does the draw.
//
// It aims for ONE big circle (A gives to B, B to C ... the last person gives to A), the way most Secret Santa
// apps do it. That means no two people simply swap gifts with each other, and nobody draws themselves.
// "Exclusions" are pairs who must not draw each other (in either direction), such as family members.

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function drawNames(people: number[], exclusions: [number, number][]): Map<number, number> | null {
  if (people.length < 3) return null;
  const blocked = new Set<string>();
  for (const [a, b] of exclusions) { blocked.add(`${a}>${b}`); blocked.add(`${b}>${a}`); }
  const ok = (giver: number, recipient: number) => giver !== recipient && !blocked.has(`${giver}>${recipient}`);

  // First choice: a single circle through everyone.
  for (let attempt = 0; attempt < 20000; attempt++) {
    const order = shuffle(people);
    let good = true;
    for (let i = 0; i < order.length && good; i++) good = ok(order[i], order[(i + 1) % order.length]);
    if (good) {
      const m = new Map<number, number>();
      order.forEach((g, i) => m.set(g, order[(i + 1) % order.length]));
      return m;
    }
  }
  // Fallback when exclusions make one circle impossible: any fair draw where nobody gets themselves or an excluded person.
  for (let attempt = 0; attempt < 20000; attempt++) {
    const recipients = shuffle(people);
    if (people.every((g, i) => ok(g, recipients[i]))) {
      const m = new Map<number, number>();
      people.forEach((g, i) => m.set(g, recipients[i]));
      return m;
    }
  }
  return null;
}

/** Up to 3 entries, trimmed, blanks removed. */
export function cleanList(raw: unknown, max = 3): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v ?? "").trim().slice(0, 200)).filter(Boolean).slice(0, max);
}
