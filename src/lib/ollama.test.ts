import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import type { OllamaLike } from "./ollama";

type StandardRequest = {
	model: string;
	prompt: string;
	stream?: boolean;
	options: { temperature?: number; num_predict?: number };
};

type TestOllamaLike = {
	generate: (request: StandardRequest) => Promise<{ response?: string }>;
};

const clientConfigs: Array<{ host: string; headers?: Record<string, string> }> =
	[];
const recordedRequests: StandardRequest[] = [];

mock.module("ollama", () => {
	class StubOllama implements TestOllamaLike {
		public constructor(
			public config: { host: string; headers?: Record<string, string> },
		) {
			clientConfigs.push(config);
		}

		async generate(request: StandardRequest): Promise<{ response?: string }> {
			recordedRequests.push(request);
			return { response: " stubbed response \n" };
		}
	}

	return { Ollama: StubOllama } as unknown as typeof import("ollama");
});

let importedGen: typeof import("./ollama").gen;

beforeAll(async () => {
	({ gen: importedGen } = await import("./ollama"));
});

function assertDefined<T>(v: T, msg?: string): asserts v is NonNullable<T> {
	if (v == null) throw new Error(msg ?? "Expected value to be defined");
}

class FakeOllama implements TestOllamaLike {
	public lastArgs: StandardRequest | null = null;
	constructor(private readonly response: string) {}
	async generate(request: StandardRequest): Promise<{ response?: string }> {
		this.lastArgs = request;
		return { response: this.response };
	}
}

const originalEnv = {
	model: Bun.env.OLLAMA_MODEL,
	host: Bun.env.OLLAMA_HOST,
	apiKey: Bun.env.OLLAMA_API_KEY,
};

describe("ollama gen", () => {
	beforeEach(() => {
		clientConfigs.length = 0;
		recordedRequests.length = 0;
	});

	afterEach(() => {
		if (originalEnv.model == null) {
			delete (Bun.env as Record<string, string | undefined>).OLLAMA_MODEL;
		} else {
			(Bun.env as Record<string, string>).OLLAMA_MODEL = originalEnv.model;
		}
		if (originalEnv.host == null) {
			delete (Bun.env as Record<string, string | undefined>).OLLAMA_HOST;
		} else {
			(Bun.env as Record<string, string>).OLLAMA_HOST = originalEnv.host;
		}
		if (originalEnv.apiKey == null) {
			delete (Bun.env as Record<string, string | undefined>).OLLAMA_API_KEY;
		} else {
			(Bun.env as Record<string, string>).OLLAMA_API_KEY = originalEnv.apiKey;
		}
	});

	it("maps options and trims response", async () => {
		const client = new FakeOllama(" hello world \n");
		const out = await importedGen(
			"Say hi",
			{ model: "m", temperature: 0.7, maxTokens: 42 },
			client as unknown as OllamaLike,
		);
		expect(out).toBe("hello world");

		assertDefined(client.lastArgs, "lastArgs not set after gen");
		const args = client.lastArgs;

		expect(args.model).toBe("m");
		expect(args.prompt).toBe("Say hi");
		expect(args.stream).toBeFalse();
		expect(args.options.temperature).toBe(0.7);
		expect(args.options.num_predict).toBe(42);
	});

	it("uses env model and defaults when opts omitted", async () => {
		(Bun.env as Record<string, string>).OLLAMA_MODEL = "env-model";

		const client = new FakeOllama("ok");
		const out = await importedGen("q", {}, client as unknown as OllamaLike);
		expect(out).toBe("ok");

		assertDefined(client.lastArgs, "lastArgs not set after gen");
		const args = client.lastArgs;

		expect(args.model).toBe("env-model");
		expect(args.options.temperature).toBe(0.2);
		expect(args.options.num_predict).toBeUndefined();
	});

	it("constructs Ollama client using env host and API key", async () => {
		(Bun.env as Record<string, string>).OLLAMA_HOST = "http://env-host:11434";
		(Bun.env as Record<string, string>).OLLAMA_API_KEY = "secret";

		const response = await importedGen("hi");
		expect(response).toBe("stubbed response");

		expect(clientConfigs).toHaveLength(1);
		expect(clientConfigs[0]).toEqual({
			host: "http://env-host:11434",
			headers: { Authorization: "Bearer secret" },
		});
		expect(recordedRequests[0].options.temperature).toBe(0.2);
		expect(recordedRequests[0].options.num_predict).toBeUndefined();
	});

	it("allows opts to override host, headers, and max tokens", async () => {
		const response = await importedGen("prompt", {
			host: "http://custom-host",
			headers: { "X-Test": "1" },
			maxTokens: 16,
		});
		expect(response).toBe("stubbed response");

		expect(clientConfigs.pop()).toEqual({
			host: "http://custom-host",
			headers: { "X-Test": "1" },
		});
		expect(recordedRequests.pop()?.options.num_predict).toBe(16);
	});
});
