import { afterEach, describe, expect, it } from "bun:test";
import { resolveModelConfig } from "./public.types";

const originalEnv = { ...Bun.env };

afterEach(() => {
	for (const key of Object.keys(Bun.env)) {
		if (!(key in originalEnv)) delete Bun.env[key as keyof typeof Bun.env];
	}
	Object.assign(Bun.env, originalEnv);
});

describe("ranking model configuration", () => {
	it("uses explicit model, host and key overrides", () => {
		Bun.env.OLLAMA_MODEL = "environment-model";
		Bun.env.OLLAMA_ENDPOINT = "http://environment.test";
		Bun.env.OLLAMA_API_KEY = "environment-key";

		expect(
			resolveModelConfig({
				model: "custom-model",
				host: "http://custom.test",
				apiKey: "custom-key",
			}),
		).toEqual({
			model: "custom-model",
			host: "http://custom.test",
			apiKey: "custom-key",
		});
	});

	it("uses environment values when explicit fields are omitted", () => {
		Bun.env.OLLAMA_MODEL = "environment-model";
		Bun.env.OLLAMA_ENDPOINT = "http://environment.test";
		Bun.env.OLLAMA_API_KEY = "environment-key";

		expect(resolveModelConfig()).toEqual({
			model: "environment-model",
			host: "http://environment.test",
			apiKey: "environment-key",
		});
	});
});
