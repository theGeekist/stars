// src/types/yaml.d.ts
declare module "*.yaml" {
	export type CriteriaItem = {
		slug: string;
		name?: string;
		description: string;
		placeholder?: boolean;
	};

	const content: {
		scoring?: {
			system?: string;
			fewshot?: string;
			criteria?: CriteriaItem[] | string;
		};
		summarise?: {
			one_paragraph?: string;
			map_header?: string;
			reduce?: string;
		};
	};
	export default content;
}
