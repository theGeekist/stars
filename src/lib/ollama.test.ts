import { describe, expect, it } from "bun:test";
import { gen, type OllamaLike } from "./ollama";

class FakeOllama implements OllamaLike {
	public lastArgs: {
		model: string;
		prompt: string;
		stream: false;
		options: { temperature?: number; num_predict?: number };
	} | null = null;
	constructor(private response: string) {}
	async generate(args: {
		model: string;
		prompt: string;
		stream: false;
		options: { temperature?: number; num_predict?: number };
	}): Promise<{ response: string }> {
		this.lastArgs = args;
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
		expect(out).toBe("hello world");
		expect(client.lastArgs.model).toBe("m");
		expect(client.lastArgs.prompt).toBe("Say hi");
		expect(client.lastArgs.stream).toBeFalse();
		expect(client.lastArgs.options.temperature).toBe(0.7);
		expect(client.lastArgs.options.num_predict).toBe(42);
	});

	it("uses env model and defaults when opts omitted", async () => {
		const prev = Bun.env.OLLAMA_MODEL;
		(Bun.env as unknown as Record<string, string>).OLLAMA_MODEL = "env-model";
		const client = new FakeOllama("ok");
		const out = await gen("q", {}, client);
		expect(out).toBe("ok");
		expect(client.lastArgs.model).toBe("env-model");
		expect(client.lastArgs.options.temperature).toBe(0.2);
		expect(client.lastArgs.options.num_predict).toBeUndefined();
		if (prev == null) {
			delete (Bun.env as unknown as Record<string, string>).OLLAMA_MODEL;
		} else {
			(Bun.env as unknown as Record<string, string>).OLLAMA_MODEL = prev;
		}
	});
});
