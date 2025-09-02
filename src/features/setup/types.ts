// src/features/setup/types.ts

export type PromptsConfig = {
	scoring?: {
		system?: string;
		fewshot?: string;
		/** Raw multi-line block where each line is "slug = only score if ..." */
		criteria?: string;
	};
	summarise?: {
		one_paragraph?: string;
		map_header?: string;
		reduce?: string;
	};
};

export type PromptsState =
	| { kind: "missing" }
	| { kind: "invalid"; reason: string }
	| { kind: "incomplete"; missingSlugs: string[]; placeholderCount: number }
	| { kind: "ready"; count: number };
