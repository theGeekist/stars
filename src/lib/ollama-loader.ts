// src/lib/ollama-loader.ts
import type { gen as genType } from "./ollama";

type OllamaModule = { gen: typeof genType };
type Loader = () => OllamaModule;

const defaultLoader: Loader = () => require("./ollama") as OllamaModule;

let currentLoader: Loader = defaultLoader;

/**
 * Resolve the Ollama module. Allows tests to inject a fake implementation
 * without relying on Bun's module mocking (which can leak across files under CI).
 */
export function loadOllamaModule(): OllamaModule {
	return currentLoader();
}

/**
 * Test-only helper to replace the Ollama module loader. Pass `undefined` to reset.
 */
export function setOllamaModuleLoaderForTests(loader?: Loader): void {
	currentLoader = loader ?? defaultLoader;
}
