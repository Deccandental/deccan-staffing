// Escapes text for putting into an HTML email. Anything that came from the
// database or a request (names, titles, notes) must go through this, or a
// value like <a href=…> becomes a working link in an official email.
export const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Only https links are put into emails; anything else becomes "#".
export const safeUrl = (v: unknown): string => {
  const s = String(v ?? "").trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? esc(s) : "#";
};
