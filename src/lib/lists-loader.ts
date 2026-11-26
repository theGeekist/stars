// src/lib/lists-loader.ts
import type { getAllListsStream as getAllListsStreamType } from "./lists";

type ListsModule = { getAllListsStream: typeof getAllListsStreamType };
type Loader = () => ListsModule;

const defaultLoader: Loader = () => require("./lists") as ListsModule;

let currentLoader: Loader = defaultLoader;

/** Resolve the lists module; tests can override via the setter. */
export function loadListsModule(): ListsModule {
	return currentLoader();
}

/** Test helper to inject a fake lists module. Pass `undefined` to reset. */
export function setListsModuleLoaderForTests(loader?: Loader): void {
	currentLoader = loader ?? defaultLoader;
}
