// Thin re-export shim to new scoring feature module
export type {
	ListDef,
	RepoFacts,
	ScoreItem,
	ScoreResponse,
} from "@features/scoring/llm";
export { scoreRepoAgainstLists } from "@features/scoring/llm";
