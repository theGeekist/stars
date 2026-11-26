import type { gen as genType } from "./ollama";

type OllamaModule = { gen: typeof genType };
type Loader = () => OllamaModule;

const defaultLoader: Loader = () => require("./ollama") as OllamaModule;
let currentLoader: Loader = defaultLoader;

export function loadOllamaModule(): OllamaModule {
	return currentLoader();
}

export function setOllamaModuleLoaderForTests(loader?: Loader): void {
	currentLoader = loader ?? defaultLoader;
}
