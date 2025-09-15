import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generatePromptsYaml, testOllamaReady } from "@features/setup/service";
import { log } from "@lib/bootstrap";
import { checkPromptsState, promptsConfig } from "@lib/prompts";

// NOTE: location of persisted local model configuration
const MODEL_RC = resolve(process.cwd(), ".modelrc.json");

/** Minimal on-disk model configuration read from .modelrc.json */
export type ModelConfig = {
	model?: string;
	host?: string;
};

/** Return the static prompts configuration object loaded at startup. */
export function getPrompts() {
	return promptsConfig;
}

/** Evaluate the current prompts directory state (missing, outdated, etc.). */
export function getPromptsState() {
	return checkPromptsState();
}

/** Generate or refresh prompts.yaml from the internal template. */
export async function updatePromptsFromTemplate(
	token: string,
	opts?: { forcePlaceholder?: boolean },
) {
	await generatePromptsYaml(token, undefined, opts);
	return { ok: true };
}

/** Read .modelrc.json if present; returns empty object on absence or parse failure. */
export function readModelConfig(): ModelConfig {
	if (!existsSync(MODEL_RC)) return {};
	try {
		const text = readFileSync(MODEL_RC, "utf-8");
		return JSON.parse(text) as ModelConfig;
	} catch (_e) {
		log.warn("Failed to read .modelrc.json");
		return {};
	}
}

/** Persist model configuration to .modelrc.json (overwrites). */
export function writeModelConfig(cfg: ModelConfig) {
	try {
		writeFileSync(MODEL_RC, JSON.stringify(cfg, null, 2), "utf-8");
		return { ok: true };
	} catch (e) {
		return { ok: false, reason: e instanceof Error ? e.message : String(e) };
	}
}

/** Probe LLM connectivity / readiness (e.g., Ollama status). */
export async function testModelConnectivity() {
	return await testOllamaReady();
}

export default {
	getPrompts,
	getPromptsState,
	updatePromptsFromTemplate,
	readModelConfig,
	writeModelConfig,
	testModelConnectivity,
};
