// Thin re-export shim to summarise feature module
export type {
	Meta as SummariseMeta,
	SummariseDeps,
} from "@features/summarise/llm";
export { summariseRepoOneParagraph } from "@features/summarise/llm";
