// src/lib/logger.ts
// Simple, consistent logger with DEBUG-aware output.

type Level = "info" | "debug" | "warn" | "error" | "success";

function ts(): string {
	const d = new Date();
	return d.toISOString().replace("T", " ").substring(0, 19);
}

function prefix(level: Level): string {
	switch (level) {
		case "info":
			return "ℹ";
		case "debug":
			return "·";
		case "warn":
			return "⚠";
		case "error":
			return "✖";
		case "success":
			return "✔";
	}
}

function format(level: Level, parts: unknown[]): string {
	return `${ts()} ${prefix(level)} ${parts.map(String).join(" ")}`;
}

export function createLogger(opts?: { debug?: boolean }) {
	const debug = opts?.debug ?? !!Bun.env.DEBUG;

	return {
		info: (...args: unknown[]) => console.log(format("info", args)),
		success: (...args: unknown[]) => console.log(format("success", args)),
		warn: (...args: unknown[]) => console.warn(format("warn", args)),
		error: (...args: unknown[]) => console.error(format("error", args)),
		debug: (...args: unknown[]) => {
			if (debug) console.log(format("debug", args));
		},
		json: (obj: unknown) => console.log(JSON.stringify(obj, null, 2)),
		header: (title: string) => console.log(`\n▶ ${title}`),
		line: (s = "") => console.log(s),
	} as const;
}

export type Logger = ReturnType<typeof createLogger>;
