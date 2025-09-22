export type TableName = "repo" | "list" | "topic" | "global";

/** Keep flags open-ended; you can narrow to a union if you prefer. */
export type FlagName =
	| "ingest"
	| "enrich"
	| "summarise"
	| "score"
	| "sync"
	| `backfill-${string}`
	| string;

export type ISODateTime = string;

export interface RunsLatestRow {
	table: TableName;
	row_id: string | null;
	flag: FlagName;
	last_run_at: ISODateTime;
}
