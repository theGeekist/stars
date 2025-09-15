// src/lib/ollama.ts
import { Ollama } from "ollama";

export type GenOpts = {
	model?: string;
	temperature?: number;
	maxTokens?: number;
	host?: string;
	headers?: Record<string, string>;
};

export type OllamaLike = Pick<Ollama, "generate">;

function createOllamaClient(opts: GenOpts = {}): OllamaLike {
	const host = opts.host ?? Bun.env.OLLAMA_HOST ?? "http://localhost:11434";
	const headers =
		opts.headers ??
		(Bun.env.OLLAMA_API_KEY
			? { Authorization: `Bearer ${Bun.env.OLLAMA_API_KEY}` }
			: undefined);

	return new Ollama({
		host,
		headers,
	});
}

/**
 * Generate a completion via Ollama.
 * Accepts an optional client to facilitate testing.
 */
export async function gen(
	prompt: string,
	opts: GenOpts = {},
	client?: OllamaLike,
): Promise<string> {
	const {
		model = Bun.env.OLLAMA_MODEL ?? "",
		temperature = 0.2,
		maxTokens,
	} = opts;

	const ollama = client ?? createOllamaClient(opts);

	const res = await ollama.generate({
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
