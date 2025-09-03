export type BatchSelector = {
	limit?: number;
	slug?: string;
	resummarise?: boolean;
};
export type BindLimit = [limit: number];
export type BindLimitSlug = [slug: string, limit: number];
export type Metrics = {
	popularity?: number;
	freshness?: number;
	activeness?: number;
};
export type Meta = {
	repoId?: number;
	nameWithOwner: string;
	url: string;
	description?: string | null;
	primaryLanguage?: string | null;
	topics?: string[];
	metrics?: Metrics;
};

export type SummariseDeps = {
	gen?: (prompt: string, opts?: Record<string, unknown>) => Promise<string>;
	embed?: { embedTexts: (texts: string[]) => Promise<number[][]> };
};
