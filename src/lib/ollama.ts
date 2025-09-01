// src/lib/ollama.ts
import ollama from "ollama";

export type GenOpts = {
	model?: string; // e.g. "llama3.2:3b"
	temperature?: number; // default 0.2
	maxTokens?: number; // maps to num_predict
};

export async function gen(prompt: string, opts: GenOpts = {}): Promise<string> {
	const {
		model = Bun.env.OLLAMA_MODEL ?? "",
		temperature = 0.2,
		maxTokens,
	} = opts;

	const res = await ollama.generate({
		model,
		prompt,
		stream: false,
		options: {
			temperature,
			...(maxTokens ? { num_predict: maxTokens } : {}),
		},
	});

	return res.response.trim();
}
