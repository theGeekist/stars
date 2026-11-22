import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResearchTarget } from "./service";

/** Use the existing safe-fetch command as an independently fetched, bounded evidence source. */
export function createFetchConsumer(options: {
	fetcher: string;
	python?: string;
	maxBytes?: number;
	timeoutMs?: number;
}) {
	const maxBytes = options.maxBytes ?? 200_000;
	const timeoutMs = options.timeoutMs ?? 60_000;
	if (maxBytes < 1 || maxBytes > 5_000_000)
		throw new Error("Invalid evidence byte limit");
	return async (target: ResearchTarget) => {
		const dir = await mkdtemp(join(tmpdir(), "stars-research-"));
		try {
			const file = join(dir, "response");
			const child = Bun.spawn(
				[
					options.python ?? "python3",
					options.fetcher,
					target.url,
					file,
					"--max-bytes",
					String(maxBytes),
				],
				{ stdout: "pipe", stderr: "pipe" },
			);
			const timer = setTimeout(() => child.kill(), timeoutMs);
			let stdout: string;
			let stderr: string;
			let status: number;
			try {
				[stdout, stderr, status] = await Promise.all([
					new Response(child.stdout).text(),
					new Response(child.stderr).text(),
					child.exited,
				]);
			} finally {
				clearTimeout(timer);
			}
			if (status !== 0)
				throw new Error(
					`Evidence fetch failed: ${stderr.trim().slice(-500) || `exit ${status}`}`,
				);
			const meta = JSON.parse(stdout) as {
				url: string;
				content_type: string;
				bytes: number;
			};
			const raw = await readFile(file);
			if (raw.length !== meta.bytes || raw.length > maxBytes || !meta.url)
				throw new Error("Invalid evidence fetch receipt");
			const textual =
				/^(text\/|application\/(json|xml|[^;]+\+json|[^;]+\+xml))/.test(
					meta.content_type,
				);
			return {
				kind: "fetched-resource",
				requested_url: target.url,
				source_url: meta.url,
				observed_at: new Date().toISOString(),
				content_type: meta.content_type,
				bytes: raw.length,
				sha256: createHash("sha256").update(raw).digest("hex"),
				text: textual ? raw.toString("utf8") : null,
				source_content_is_untrusted: true,
			};
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	};
}
