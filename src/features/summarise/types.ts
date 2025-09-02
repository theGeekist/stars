export type BatchSelector = {
	limit?: number;
	slug?: string;
	resummarise?: boolean;
};
export type BindLimit = [limit: number];
export type BindLimitSlug = [limit: number, slug: string];
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
