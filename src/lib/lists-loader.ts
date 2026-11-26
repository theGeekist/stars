import type { getAllListsStream as getAllListsStreamType } from "./lists";

type ListsModule = { getAllListsStream: typeof getAllListsStreamType };
type Loader = () => ListsModule;

const defaultLoader: Loader = () => require("./lists") as ListsModule;
let currentLoader: Loader = defaultLoader;

export function loadListsModule(): ListsModule {
	return currentLoader();
}

export function setListsModuleLoaderForTests(loader?: Loader): void {
	currentLoader = loader ?? defaultLoader;
}
