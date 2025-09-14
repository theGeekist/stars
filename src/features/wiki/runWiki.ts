// src/features/wiki/runWiki.ts
import { Logger, pipeline } from "@jasonnathan/llm-core";
import { stepAutoExtracts } from "./steps/autoExtracts";
import { stepCheckpoint } from "./steps/checkpoint";
import { stepChunk } from "./steps/chunk";
import { stepCrosslinkSimple } from "./steps/crosslinkSimple";
import { stepEmbedAndStore } from "./steps/embedAndStore";
import { stepGenerateWiki } from "./steps/generateWiki";
import { stepPolishWiki } from "./steps/polishWiki";
import { stepReadDocs } from "./steps/readDocs";
import { stepRepairWiki } from "./steps/repairWiki";
import { stepResolveRepo } from "./steps/resolveRepo";
import { stepResolveRepoSha } from "./steps/resolveRepoSha";
import { stepRetrieve } from "./steps/retrieve";
import { stepRetrieveForPages } from "./steps/retrieveForPages";
import { stepWritePages } from "./steps/stepWritePages";
import { stepValidateAndPack } from "./steps/validateAndPack";
import type { FilterOptions, RepoInput } from "./types.ts";

const logger = new Logger("./run-pipeline.md");

export async function createWikiForRepo(
	input: RepoInput & {
		filter?: FilterOptions;
		numCtx?: number;
		contextShare?: number;
		pagesTarget: number;
		comprehensive: boolean;
		useCosineChunker?: boolean;
	},
) {
	const p = pipeline<Logger, RepoInput>(logger)
		.addStep(stepResolveRepo(input.dbDir))
		.addStep(stepReadDocs(input.filter))
		.addStep(
			stepChunk(
				input.useCosineChunker ?? true,
				Bun.env.OLLAMA_EMBEDDING_MODEL ?? "",
			),
		)
		.addStep(stepEmbedAndStore(Bun.env.OLLAMA_EMBEDDING_MODEL ?? ""))
		.addStep(
			stepRetrieve({
				query:
					"what is this project, its core purpose, technical approach, and standout capability",
				k: 32,
				perFileLimit: 3,
				budget: {
					numCtx: 8192,
					contextShare: input.contextShare ?? 0.45,
				},
				embedModel: Bun.env.OLLAMA_EMBEDDING_MODEL ?? "",
			}),
		)
		.addStep(stepCheckpoint("after_step_retrieve"))
		.addStep(
			stepGenerateWiki(
				input.pagesTarget,
				input.comprehensive,
				Bun.env.OLLAMA_MODEL,
			),
		)
		.addStep(
			stepRepairWiki({
				maxFilesPerPage: 4,
				fillDescriptions: true, // set true if you want the 1-liners
			}),
		)
		.addStep(
			stepPolishWiki({
				embedModel: Bun.env.OLLAMA_EMBEDDING_MODEL ?? "",
				maxFilesPerPage: 4,
				minFilesPerPage: 2,
				maxRelated: 5,
				readmePenalty: 0.08,
			}),
		)
		.addStep(stepResolveRepoSha())
		.addStep(
			stepRetrieveForPages({
				k: 24,
				perFileLimit: 3,
				budget: { numCtx: 8192 },
				embedModel: Bun.env.OLLAMA_EMBEDDING_MODEL ?? "",
			}),
		)
		.addStep(stepCheckpoint("after_retrieve_for_pages"))
		.addStep(stepWritePages(Bun.env.OLLAMA_MODEL))
		.addStep(stepCheckpoint("after_write_pages"))
		.addStep(stepAutoExtracts())
		.addStep(stepCrosslinkSimple())
		.addStep(stepValidateAndPack("dist/wiki"));

	return p.run({ ...input });
}

const res = await createWikiForRepo({
	repoUrlOrPath: "https://github.com/TheR1D/shell_gpt.git",
	ownerRepo: "TheR1D/shell_gpt",
	languageName: "English",
	dbDir: `/Users/jasonnathan/Repos/@pipewrk/stars/src/features/wiki/database`,
	dbName: "shell_gpt",
	pagesTarget: 10, // 8–12 recommended for comprehensive
	comprehensive: true, // include sections
});

console.log(res.wiki);
