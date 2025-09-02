export type PromptsConfig = {
	scoring?: {
		system?: string;
		fewshot?: string;
		criteria?: string;
	};
	summarise?: {
		one_paragraph?: string;
		map_header?: string;
		reduce?: string;
	};
};
