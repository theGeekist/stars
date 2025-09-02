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

const reporter: ConsolaReporter = {
	log(obj: LogObject) {
		// Build a clean, timestamp-free line
		const icon = ICON[obj.type] ?? "•";
		const parts = [obj.message, ...(obj.args || [])]
			.filter((v) => v !== undefined)
			.map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
		const line = `${icon} ${parts.join(" ")}`;
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

	/** Spinner wrapper with automatic succeed/fail messaging */
	async function withSpinner<T>(
		text: string,
		run: (s: Ora) => Promise<T> | T,
		opts?: { succeedText?: string; failText?: string },
	): Promise<T> {
		const s = ora({ text }).start();
		try {
			const out = await run(s);
			s.succeed(opts?.succeedText ?? text);
			return out;
		} catch (e) {
			s.fail(opts?.failText ?? text);
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
		spinner: (text: string) => ora({ text }).start(),
		// new helpers
		withSpinner,
		columns,
	} as const;
}

export type Logger = ReturnType<typeof createLogger>;
