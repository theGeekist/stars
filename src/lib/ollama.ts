// src/lib/ollama.ts
import ollama from "ollama";

export type GenOpts = {
	model?: string; // e.g. "llama3.2:3b"
	temperature?: number; // default 0.2
	maxTokens?: number; // maps to num_predict
};

export type OllamaLike = {
	generate: (args: {
		model: string;
		prompt: string;
		stream: false;
		options: { temperature?: number; num_predict?: number };
	}) => Promise<{ response: string }>;
};

/**
 * Generate a completion via Ollama.
 * Accepts an optional client to facilitate testing.
 */
export async function gen(
	prompt: string,
	opts: GenOpts = {},
	client: OllamaLike = ollama,
): Promise<string> {
	const {
		model = Bun.env.OLLAMA_MODEL ?? "",
		temperature = 0.2,
		maxTokens,
	} = opts;

	const res = await client.generate({
		model,
		prompt,
		stream: false,
		options: {
			temperature,
			...(typeof maxTokens === "number" ? { num_predict: maxTokens } : {}),
		},
	});

	return (res.response ?? "").trim();
}
