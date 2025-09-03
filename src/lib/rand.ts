import { webcrypto as wc } from "node:crypto";

/** Hex id of `len` chars (default 12). */
export function randHex(len = 12): string {
	const bytes = new Uint8Array(Math.ceil(len / 2));
	wc.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
		.join("")
		.slice(0, len);
}

/** Base36 id (lowercase) of `len` chars (default 6). */
export function randBase36(len = 6): string {
	const abc = "0123456789abcdefghijklmnopqrstuvwxyz";
	const u32 = new Uint32Array(1);
	let out = "";
	for (let i = 0; i < len; i++) {
		let x: number,
			limit = Math.floor(0x1_0000_0000 / abc.length) * abc.length;
		do {
			wc.getRandomValues(u32);
			x = u32[0];
		} while (x >= limit);
		out += abc[x % abc.length];
	}
	return out;
}

/** Uniform integer in [0, ms) for jitter/backoff. */
export function jitter(ms: number): number {
	const n = Math.floor(ms);
	if (!Number.isFinite(n) || n <= 0) return 0;
	const u32 = new Uint32Array(1);
	let x: number,
		limit = Math.floor(0x1_0000_0000 / n) * n;
	do {
		wc.getRandomValues(u32);
		x = u32[0];
	} while (x >= limit);
	return x % n;
}
