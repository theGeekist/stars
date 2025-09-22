import { mkdir } from "node:fs/promises";

// small file helpers ---------------------------------------------------------
export async function ensureDir(dir: string) {
	await mkdir(dir, { recursive: true });
} /* ------------------------- small utilities ------------------------- */
export function uniq<T>(xs: T[]) {
	return Array.from(new Set(xs));
}
export function basename(p: string) {
	return p.split("/").pop() ?? p;
}
export function isNumArray(x: unknown): x is number[] {
	return Array.isArray(x) && x.every((n) => typeof n === "number");
}
export function slugify(s: string) {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^(?:_+)|(?:_+)$/g, "");
}
