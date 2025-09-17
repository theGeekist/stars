// src/features/wiki/steps/stepWritePages.ts

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createOllamaService, Logger, pipeline } from "@jasonnathan/llm-core";
import type {
	DraftsOutput,
	PageComposed,
	PageDraft,
	PageInit,
	PagesContextOutput,
	Step,
} from "../types.ts";
import { ensureDir } from "../utils.js";
import {
	s1_scoreFiles,
	s2_headings,
	s3_planSections,
	s4_codeGenerateAndSelect,
	s5_explainCode,
	s6_narratives,
	s7_composeMarkdown,
} from "./stepWritePagesSteps";

async function saveSnapshot(dir: string, name: string, payload: unknown) {
	await ensureDir(dir);
	if (typeof payload === "string") {
		await writeFile(join(dir, `${name}.md`), payload, "utf8");
	} else {
		await writeFile(
			join(dir, `${name}.json`),
			JSON.stringify(payload, null, 2),
			"utf8",
		);
	}
}
const pickState = {
	s1: (st: unknown) => ({
		preferredFiles: (st as Record<string, unknown>).preferredFiles,
	}),
	s2: (st: unknown) => ({ headings: (st as Record<string, unknown>).headings }),
	s3: (st: unknown) => ({ plans: (st as Record<string, unknown>).plans }),
	s4: (st: unknown) => ({
		codeBySection: Array.from(
			(
				((st as Record<string, unknown>).codeBySection ?? new Map()) as Map<
					unknown,
					unknown
				>
			).entries(),
		).map(([sectionId, c]) => ({
			sectionId,
			lang: (c as Record<string, unknown>)?.lang,
			text: (c as Record<string, unknown>)?.text,
			align: (c as Record<string, unknown>)?.expected_output_alignment,
		})),
	}),
	s5: (st: unknown) => ({
		codeExplById: Array.from(
			(
				((st as Record<string, unknown>).codeExplById ?? new Map()) as Map<
					unknown,
					unknown
				>
			).entries(),
		).map(([id, e]) => ({
			id,
			explanation: (e as Record<string, unknown>)?.explanation,
			risks: (e as Record<string, unknown>)?.risks ?? [],
		})),
	}),
	s6: (st: unknown) => ({
		narrativesBySection: Array.from(
			(
				((st as Record<string, unknown>).narrativesBySection ??
					new Map()) as Map<unknown, unknown>
			).entries(),
		).map(([sectionId, n]) => ({
			sectionId,
			heading: (n as Record<string, unknown>)?.heading,
			pCount:
				((n as Record<string, unknown>)?.paragraphs as unknown as unknown[])
					?.length ?? 0,
		})),
	}),
	s7: (st: unknown) =>
		((st as Record<string, unknown>).markdown as string) ?? "",
};

export function stepWritePages(
	genModel?: string,
): Step<PagesContextOutput, DraftsOutput> {
	return (log) => async (doc) => {
		const svc = createOllamaService({
			model: genModel ?? Bun.env.OLLAMA_MODEL ?? "",
		});
		const drafts: PageDraft[] = [];
		const legacyOutlines: {
			pageId: string;
			lead: string;
			sections: string[];
		}[] = [];

		const runId =
			(doc as Record<string, unknown>).commitSha ||
			new Date().toISOString().replace(/[:.]/g, "-");
		const runRoot = join(".wiki_runs", String(runId));
		await ensureDir(runRoot);

		for (const page of doc.wiki.pages) {
			const pc = doc.pagesContext.find((p) => p.pageId === page.id);
			if (!pc) {
				log.warn?.(`writePages: no PageContext for ${page.id}`);
				continue;
			}

			const pageDir = join(runRoot, page.id);
			await ensureDir(pageDir);

			const init: PageInit = { doc, page, pc };
			const innerLogger = new Logger(join(pageDir, "inner-steps.md"));

			// helper to wrap and save after each step
			const wrapWithSave = <I, O>(
				label: keyof typeof pickState,
				step: Step<I, O>,
			) =>
				((lg) => async (state: I) => {
					const out = await step(lg)(state);
					try {
						await saveSnapshot(
							pageDir,
							String(label),
							(pickState as Record<string, (st: unknown) => unknown>)[label](
								out,
							),
						);
					} catch (e) {
						log.warn?.(
							`checkpoint ${String(label)} failed: ${(e as Error).message}`,
						);
					}
					return out;
				}) as Step<I, O>;

			try {
				const inner = pipeline<Logger, PageInit>(innerLogger)
					.addStep(wrapWithSave("s1", s1_scoreFiles(svc, doc.languageName)))
					.addStep(wrapWithSave("s2", s2_headings(svc, doc.languageName)))
					.addStep(wrapWithSave("s3", s3_planSections(svc, doc.languageName)))
					.addStep(
						wrapWithSave("s4", s4_codeGenerateAndSelect(svc, doc.languageName)),
					)
					.addStep(wrapWithSave("s5", s5_explainCode(svc, doc.languageName)))
					.addStep(wrapWithSave("s6", s6_narratives(svc, doc.languageName)))
					.addStep(wrapWithSave("s7", s7_composeMarkdown()));

				const result: PageComposed = await inner.run(init);

				drafts.push({
					pageId: page.id,
					markdown: result.markdown ?? `# ${page.title}\n`,
				});
				legacyOutlines.push({
					pageId: page.id,
					lead: result.headings?.lead ?? "",
					sections: (result.headings?.sections ?? []).map((s) => s.heading),
				});

				log.info?.(`writePages: ${page.id} done`);
			} catch (err) {
				// fail-soft: emit a minimal page so downstream steps won’t crash
				const fallback = `# ${page.title}\n\n> generation failed: ${(err as Error).message}\n`;
				await saveSnapshot(pageDir, "error", { error: String(err) });
				await saveSnapshot(pageDir, "s7", fallback);
				drafts.push({ pageId: page.id, markdown: fallback });
				legacyOutlines.push({ pageId: page.id, lead: "", sections: [] });
				log.warn?.(`writePages: ${page.id} failed-soft`);
			}
		}

		const out: DraftsOutput = { ...doc, outlines: legacyOutlines, drafts };
		return out;
	};
}
