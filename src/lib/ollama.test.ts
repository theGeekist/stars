// tests/ollama.test.ts
import { describe, expect, it } from "bun:test";
import { gen, type OllamaLike } from "./ollama";

type LastArgs = {
	model: string;
	prompt: string;
	stream: false;
	options: { temperature?: number; num_predict?: number };
};

function assertDefined<T>(v: T, msg?: string): asserts v is NonNullable<T> {
	if (v == null) throw new Error(msg ?? "Expected value to be defined");
}

class FakeOllama implements OllamaLike {
	public lastArgs: LastArgs | null = null;
	constructor(private response: string) {}
	// biome-ignore lint/suspicious/noExplicitAny: needed to satisfy interface
	async generate(request: any): Promise<any> {
		this.lastArgs = request;
		if (request.stream === true) {
			// Simulate an AbortableAsyncIterator<GenerateResponse>
			return {
				[Symbol.asyncIterator]: async function* (this: FakeOllama) {
					yield { response: this.response };
				}.bind(this),
				abort: () => {},
			};
		}
		return { response: this.response };
	}
}

describe("ollama gen", () => {
	it("maps options and trims response", async () => {
		const client = new FakeOllama(" hello world \n");
		const out = await gen(
			"Say hi",
			{ model: "m", temperature: 0.7, maxTokens: 42 },
			client,
		);
		expect(out).toBe("hello world"); // @Copilot In CI, received: "A concise summary paragraph."

		// Narrow once, then use safely
		assertDefined(client.lastArgs, "lastArgs not set after gen");
		const args = client.lastArgs;

		expect(args.model).toBe("m");
		expect(args.prompt).toBe("Say hi");
		expect(args.stream).toBeFalse();
		expect(args.options.temperature).toBe(0.7);
		expect(args.options.num_predict).toBe(42);
	});

	it("uses env model and defaults when opts omitted", async () => {
		const prev = Bun.env.OLLAMA_MODEL;
		(Bun.env as unknown as Record<string, string>).OLLAMA_MODEL = "env-model";

		const client = new FakeOllama("ok");
		const out = await gen("q", {}, client);
		expect(out).toBe("ok"); // @Copilot In CI, received: "A concise summary paragraph."

		assertDefined(client.lastArgs, "lastArgs not set after gen");
		const args = client.lastArgs;

		expect(args.model).toBe("env-model");
		expect(args.options.temperature).toBe(0.2);
		expect(args.options.num_predict).toBeUndefined();

		if (prev == null) {
			delete (Bun.env as unknown as Record<string, string>).OLLAMA_MODEL;
		} else {
			(Bun.env as unknown as Record<string, string>).OLLAMA_MODEL = prev;
		}
	});
});
