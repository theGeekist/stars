export function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}/** Safe parser for JSON-encoded arrays */
export function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

