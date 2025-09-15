// src/lib/logger.ts

import type { ConsolaReporter, LogObject } from "consola";
import { createConsola } from "consola";
import ora, { type Ora } from "ora";

type Variadic = [unknown?, ...unknown[]];

const ANSI = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	gray: "\x1b[90m",
	cyan: "\x1b[36m",
};
const ICON: Record<string, string> = {
	info: "ℹ",
	success: "✔",
	warn: "⚠",
	error: "✖",
	debug: "·",
};

// Optional tap to mirror logs elsewhere (e.g. SSE)
let __tap: undefined | ((type: string, line: string) => void);
export function setLogTap(tap?: (type: string, line: string) => void) {
	__tap = tap;
}
export function getLogTap() {
	return __tap;
}

const reporter: ConsolaReporter = {
	log(obj: LogObject) {
		// Build a clean, timestamp-free line
		const icon = ICON[obj.type] ?? "•";
		const parts = [obj.message, ...(obj.args || [])]
			.filter((v) => v !== undefined)
			.map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
		const line = `${icon} ${parts.join(" ")}`;
		// Mirror to tap (classify errors)
		try {
			__tap?.(obj.type === "error" ? "err" : obj.type, line);
		} catch {
			// ignore tap errors
		}
		const dest = obj.type === "error" ? process.stderr : process.stdout;
		dest.write(`${line}\n`);
	},
};

function divider(width = Math.min(process.stdout.columns ?? 80, 100)) {
	return "─".repeat(Math.max(16, Math.min(width - 2, 80)));
}

export function createLogger(opts?: { debug?: boolean }) {
	// 4 = debug, 3 = info+
	const level = (opts?.debug ?? !!Bun.env.DEBUG) ? 4 : 3;
	const c = createConsola({ level, reporters: [reporter] });

	function tap(type: string, line: string) {
		try {
			__tap?.(type, line);
		} catch {
			// ignore tap errors
		}
	}

	/** Spinner wrapper with automatic succeed/fail messaging and tap mirroring */
	async function withSpinner<T>(
		text: string,
		run: (s: Ora) => Promise<T> | T,
		opts?: { succeedText?: string; failText?: string },
	): Promise<T> {
		const s = ora({ text }).start();
		tap("info", text);
		try {
			const out = await run(s);
			s.succeed(opts?.succeedText ?? text);
			tap("info", opts?.succeedText ?? text);
			return out;
		} catch (e) {
			s.fail(opts?.failText ?? text);
			tap("err", opts?.failText ?? text);
			throw e;
		}
	}

	/** Minimal aligned columns printer (no extra deps) */
	function columns(
		rows: Array<Record<string, string | number | null | undefined>>,
		order: string[],
		header?: Record<string, string>,
	): void {
		const str = (v: unknown) => (v == null ? "" : String(v));
		const widths = order.map((k) =>
			Math.max(
				header ? str(header[k]).length : 0,
				...rows.map((r) => str(r[k]).length),
				1,
			),
		);
		const pad = (val: string, w: number) => (val + " ".repeat(w)).slice(0, w);
		const line = (cells: string[]) =>
			`  ${cells.map((v, i) => pad(v, widths[i])).join("   ")}`;

		if (header) {
			c.log("");
			c.log(line(order.map((k) => header[k] ?? k)));
			c.log(line(order.map((_k, i) => "─".repeat(widths[i]))));
		}
		for (const r of rows) c.log(line(order.map((k) => str(r[k]))));
		c.log("");
	}

	return {
		// same API you already use
		info: (...args: Variadic) => c.info(...args),
		success: (...args: Variadic) => c.success(...args),
		warn: (...args: Variadic) => c.warn(...args),
		error: (...args: Variadic) => c.error(...args),
		debug: (...args: Variadic) => c.debug(...args),
		json: (obj: unknown) => c.log(JSON.stringify(obj, null, 2)),
		header: (title: string) => {
			const line = divider();
			process.stdout.write(
				`\n${ANSI.bold}${ANSI.cyan}${title}${ANSI.reset}\n${ANSI.gray}${line}${ANSI.reset}\n`,
			);
		},

		subheader: (title: string) => {
			process.stdout.write(`${ANSI.bold}${title}${ANSI.reset}\n`);
		},

		list: (items: string[]) => {
			for (const it of items) process.stdout.write(`  • ${it}\n`);
		},

		line: (s = "") => process.stdout.write(`${s}\n`),
		spinner: (text: string): Ora => {
			const base = ora({ text });
			const proxy = new Proxy(base as unknown as Record<string, unknown>, {
				set(target, prop, value) {
					if (prop === "text" && typeof value === "string") {
						tap("info", value);
					}
					// @ts-expect-error dynamic
					target[prop] = value;
					return true;
				},
				get(target, prop, receiver) {
					// intercept a few methods to mirror to tap
					const val = Reflect.get(target, prop, receiver);
					if (typeof val === "function") {
						return (...args: unknown[]) => {
							if (prop === "succeed" || prop === "fail") {
								const msg =
									(args && typeof args[0] === "string"
										? (args[0] as string)
										: ((target as { text?: unknown }).text as
												| string
												| undefined)) || text;
								tap(prop === "fail" ? "err" : "info", msg);
							} else if (prop === "start") {
								tap(
									"info",
									((target as { text?: unknown }).text as string | undefined) ||
										text,
								);
							}
							const out = (val as (...a: unknown[]) => unknown).apply(
								target,
								args as never,
							);
							// Ensure chaining keeps proxy instance (esp. for .start())
							if (prop === "start") return proxy;
							return out;
						};
					}
					return val;
				},
			});
			return proxy as unknown as Ora;
		},
		// new helpers
		withSpinner,
		columns,
	} as const;
}

export type Logger = ReturnType<typeof createLogger>;
