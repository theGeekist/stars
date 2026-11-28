import { describe, expect, it } from "bun:test";
import {
	OPERATION_NAMES,
	operationRequiresSharedLock,
	validateOperationInput,
} from "./research-operations";

describe("research MCP operation validation", () => {
	it("covers every existing public dispatcher operation plus topic enrichment", () => {
		expect(OPERATION_NAMES).toEqual([
			"stars:lists",
			"stars:listRepos",
			"stars:stars",
			"stars:unlisted",
			"ingest:all",
			"ingest:lists",
			"ingest:unlisted",
			"summaries:all",
			"summaries:one",
			"ranking:all",
			"ranking:one",
			"topics:enrich",
			"setup:prompts",
			"setup:promptsState",
			"setup:updatePrompts",
			"setup:modelConfig",
			"setup:writeModelConfig",
			"setup:testModelConnectivity",
		]);
	});

	it("defaults summaries and scoring to dry-run and bounds batch sizes", () => {
		expect(validateOperationInput("summaries:all", {})).toEqual({
			operation: "summaries:all",
			args: { limit: 50, dry: true, resummarise: false },
		});
		expect(
			validateOperationInput("ranking:all", { limit: 100, dryRun: false }),
		).toEqual({
			operation: "ranking:all",
			args: { limit: 100, dry: false },
		});
	});

	it("queues only operations that write shared Stars state", () => {
		expect(operationRequiresSharedLock("ingest:all", {})).toBe(true);
		expect(operationRequiresSharedLock("topics:enrich", {})).toBe(true);
		expect(
			operationRequiresSharedLock("setup:writeModelConfig", { model: "local" }),
		).toBe(true);
		expect(operationRequiresSharedLock("summaries:all", { dry: true })).toBe(
			false,
		);
		expect(operationRequiresSharedLock("summaries:all", { dry: false })).toBe(
			true,
		);
		expect(operationRequiresSharedLock("ranking:one", { dry: true })).toBe(
			false,
		);
		expect(operationRequiresSharedLock("ranking:one", { dry: false })).toBe(
			true,
		);
		expect(operationRequiresSharedLock("stars:lists", {})).toBe(false);
	});

	it("requires a repository selector for single-repository actions", () => {
		expect(() => validateOperationInput("summaries:one", {})).toThrow(
			"selector",
		);
		expect(
			validateOperationInput("ranking:one", {
				selector: "spotDL/spotify-downloader",
			}),
		).toEqual({
			operation: "ranking:one",
			args: { selector: "spotDL/spotify-downloader", dry: true },
		});
	});

	it("rejects arbitrary options, paths, credentials, invalid limits, and unknown operations", () => {
		expect(() =>
			validateOperationInput("ingest:all", { db: "/tmp/db" }),
		).toThrow("Unknown operation argument");
		expect(() =>
			validateOperationInput("stars:lists", { GITHUB_TOKEN: "secret" }),
		).toThrow("Unknown operation argument");
		expect(() =>
			validateOperationInput("summaries:all", { limit: 101 }),
		).toThrow("limit");
		expect(() => validateOperationInput("stars:execute", {})).toThrow(
			"Unknown Stars operation",
		);
	});

	it("validates fixed model configuration without accepting embedded credentials", () => {
		expect(
			validateOperationInput("setup:writeModelConfig", {
				model: "qwen2.5:0.5b",
				host: "http://127.0.0.1:11434",
			}),
		).toEqual({
			operation: "setup:writeModelConfig",
			args: { model: "qwen2.5:0.5b", host: "http://127.0.0.1:11434" },
		});
		expect(() =>
			validateOperationInput("setup:writeModelConfig", {
				host: "https://user:password@example.com",
			}),
		).toThrow("embedded credentials");
		expect(() =>
			validateOperationInput("setup:writeModelConfig", {
				host: "file:///etc/passwd",
			}),
		).toThrow("HTTP or HTTPS");
		expect(() => validateOperationInput("setup:writeModelConfig", {})).toThrow(
			"Provide model or host",
		);
		expect(
			validateOperationInput("setup:writeModelConfig", { clear: true }),
		).toEqual({
			operation: "setup:writeModelConfig",
			args: { clear: true },
		});
	});
});
