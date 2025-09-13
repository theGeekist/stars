// src/features/wiki/steps/stepWritePages.ts
import { OllamaService, Logger } from "@jasonnathan/llm-core";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "/Users/jasonnathan/Repos/questioneer/src/core/pipeline";
import type {
	PipelineStep,
	PagesContextOutput,
	DraftsOutput,
	PageDraft,
	PageInit,
	PageComposed,
} from "../types.ts";

import {
	s1_scoreFiles,
	s2_headings,
	s3_planSections,
	s4_codeGenerateAndSelect,
	s5_explainCode,
	s6_narratives,
	s7_composeMarkdown,
} from "./stepWritePagesSteps";
import { ensureDir } from "../utils.js";

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
	s1: (st: any) => ({ preferredFiles: st.preferredFiles }),
	s2: (st: any) => ({ headings: st.headings }),
	s3: (st: any) => ({ plans: st.plans }),
	s4: (st: any) => ({
		codeBySection: Array.from((st.codeBySection ?? new Map()).entries()).map(
			([sectionId, c]: any) => ({
				sectionId,
				lang: c?.lang,
				text: c?.text,
				align: c?.expected_output_alignment,
			}),
		),
	}),
	s5: (st: any) => ({
		codeExplById: Array.from((st.codeExplById ?? new Map()).entries()).map(
			([id, e]: any) => ({
				id,
				explanation: e?.explanation,
				risks: e?.risks ?? [],
			}),
		),
	}),
	s6: (st: any) => ({
		narrativesBySection: Array.from(
			(st.narrativesBySection ?? new Map()).entries(),
		).map(([sectionId, n]: any) => ({
			sectionId,
			heading: n?.heading,
			pCount: n?.paragraphs?.length ?? 0,
		})),
	}),
	s7: (st: any) => st.markdown ?? "",
};

export function stepWritePages(
	genModel?: string,
): PipelineStep<PagesContextOutput, DraftsOutput> {
	return (log) => async (doc) => {
		const svc = new OllamaService(genModel ?? Bun.env.OLLAMA_MODEL ?? "");
		const drafts: PageDraft[] = [];
		const legacyOutlines: {
			pageId: string;
			lead: string;
			sections: string[];
		}[] = [];

		const runId =
			(doc as any).commitSha || new Date().toISOString().replace(/[:.]/g, "-");
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
				step: PipelineStep<I, O>,
			) =>
				((lg) => async (state: I) => {
					const out = await step(lg)(state);
					try {
						await saveSnapshot(
							pageDir,
							String(label),
							(pickState as any)[label](out),
						);
					} catch (e) {
						log.warn?.(
							`checkpoint ${String(label)} failed: ${(e as Error).message}`,
						);
					}
					return out;
				}) as PipelineStep<I, O>;

			try {
				const inner = pipeline<PageInit>(innerLogger)
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
