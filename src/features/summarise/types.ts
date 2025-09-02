export type Meta = {
	nameWithOwner: string;
	url: string;
	description?: string | null;
	primaryLanguage?: string | null;
	topics?: string[];
};
export type BatchSelector = {
	limit?: number;
	slug?: string;
	resummarise?: boolean;
};
export type BindLimit = [limit: number];
export type BindLimitSlug = [limit: number, slug: string];
