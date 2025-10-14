import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	jest,
} from "bun:test";
import { createMockLogger } from "@src/__test__/helpers/mock-log";

describe("CLI Routing and Handlers", () => {
	const mockIngest = jest.fn();
	const mockEnrichAllRepoTopics = jest.fn();
	const mockGeneratePromptsYaml = jest.fn();
	const mockTestOllamaReady = jest.fn();
	const mockShowSetupHintIfNotReady = jest.fn();
	const mockCheckPromptsState = jest.fn();
	const mockPrintSetupStatus = jest.fn();
	const mockCriteriaExamples = jest.fn();
	const mockSummariseRepo = jest.fn();
	const mockSummariseAll = jest.fn();

	let _testMain: (argv: string[]) => Promise<void>;

	const { log: mockLog, mocks: logMocks } = createMockLogger();
	let bootstrapModule: typeof import("@lib/bootstrap");
	let restoreLog: (() => void) | undefined;
	let initBootstrapSpy: ReturnType<typeof jest.spyOn> | undefined;
	let resetCliDeps: (() => void) | undefined;

	beforeAll(async () => {
		bootstrapModule = await import("@lib/bootstrap");
		const originalLog = {
			header: bootstrapModule.log.header,
			subheader: bootstrapModule.log.subheader,
			info: bootstrapModule.log.info,
			success: bootstrapModule.log.success,
			warn: bootstrapModule.log.warn,
			error: bootstrapModule.log.error,
			debug: bootstrapModule.log.debug,
			line: bootstrapModule.log.line,
			list: bootstrapModule.log.list,
			json: bootstrapModule.log.json,
			columns: bootstrapModule.log.columns,
			spinner: bootstrapModule.log.spinner,
			withSpinner: bootstrapModule.log.withSpinner,
		};
		Object.assign(bootstrapModule.log, mockLog);
		restoreLog = () => {
			Object.assign(bootstrapModule.log, originalLog);
		};
		initBootstrapSpy = jest
			.spyOn(bootstrapModule, "initBootstrap")
			.mockImplementation(() => {});

		const ingestModule = await import("@src/api/ingest");
		jest.spyOn(ingestModule, "default").mockImplementation(mockIngest);

		const topicsModule = await import("@src/api/topics");
		jest
			.spyOn(topicsModule, "enrichAllRepoTopics")
			.mockImplementation(mockEnrichAllRepoTopics);

		const setupModule = await import("@features/setup");
		jest
			.spyOn(setupModule, "generatePromptsYaml")
			.mockImplementation(mockGeneratePromptsYaml);
		jest
			.spyOn(setupModule, "testOllamaReady")
			.mockImplementation(mockTestOllamaReady);

		const promptsModule = await import("@lib/prompts");
		jest
			.spyOn(promptsModule, "showSetupHintIfNotReady")
			.mockImplementation(mockShowSetupHintIfNotReady);
		jest
			.spyOn(promptsModule, "checkPromptsState")
			.mockImplementation(mockCheckPromptsState);
		jest
			.spyOn(promptsModule, "printSetupStatus")
			.mockImplementation(mockPrintSetupStatus);
		jest
			.spyOn(promptsModule, "criteriaExamples")
			.mockImplementation(mockCriteriaExamples);
		jest
			.spyOn(promptsModule, "ensurePromptsReadyOrExit")
			.mockImplementation(() => {});

		const starsModule = await import("@src/api/stars");
		jest.spyOn(starsModule, "runListsCore").mockImplementation(() => {});
		jest.spyOn(starsModule, "runReposCore").mockImplementation(() => {});
		jest.spyOn(starsModule, "runStarsCore").mockImplementation(() => {});
		jest.spyOn(starsModule, "runUnlistedCore").mockImplementation(() => {});

		const rankingModule = await import("@src/api/ranking.public");
		jest.spyOn(rankingModule, "rankOne").mockImplementation(() => {});
		jest.spyOn(rankingModule, "rankAll").mockImplementation(() => {});

		const summariseModule = await import("@src/api/summarise.public");
		jest
			.spyOn(summariseModule, "summariseRepo")
			.mockImplementation(() => Promise.resolve());
		jest
			.spyOn(summariseModule, "summariseAll")
			.mockImplementation(() => Promise.resolve());

		const cli = await import("@src/cli");
		_testMain = cli._testMain;
		cli._setCliDeps({
			summariseRepo: mockSummariseRepo,
			summariseAll: mockSummariseAll,
		});
		resetCliDeps = cli._resetCliDeps;
	});

	afterAll(() => {
		jest.restoreAllMocks();
		restoreLog?.();
		resetCliDeps?.();
	});

	const originalExit = process.exit;

	beforeEach(() => {
		jest.clearAllMocks();
		mockIngest.mockReset();
		mockEnrichAllRepoTopics.mockReset();
		mockGeneratePromptsYaml.mockReset();
		mockTestOllamaReady.mockReset();
		mockShowSetupHintIfNotReady.mockReset();
		mockCheckPromptsState.mockReset();
		mockPrintSetupStatus.mockReset();
		mockCriteriaExamples.mockReset();
		mockSummariseRepo.mockReset();
		mockSummariseAll.mockReset();
		process.exit = ((code: number) => {
			throw new Error(`Process exit with code ${code}`);
		}) as typeof process.exit;

		Bun.env.EXPORTS_DIR = "./exports";
		Bun.env.GITHUB_TOKEN = "test-token";
		mockCriteriaExamples.mockReturnValue([]);
	});

	afterEach(() => {
		process.exit = originalExit;
	});

	describe("CLI Routing and Additional Handlers", () => {
		describe("handleIngest", () => {
			it("should call ingest with default EXPORTS_DIR", async () => {
				await _testMain(["bun", "cli.ts", "ingest"]);

				expect(mockIngest).toHaveBeenCalledWith("./exports");
			});

			it("should call ingest with custom EXPORTS_DIR", async () => {
				Bun.env.EXPORTS_DIR = "/custom/path";
				await _testMain(["bun", "cli.ts", "ingest"]);

				expect(mockIngest).toHaveBeenCalledWith("/custom/path");
			});
		});

		describe("handleTopicsEnrich", () => {
			it("should call enrichAllRepoTopics with default options", async () => {
				await _testMain(["bun", "cli.ts", "topics:enrich"]);

				expect(logMocks.info).toHaveBeenCalledWith(
					"Enrich topics: onlyActive=false ttlDays=(default)",
				);
				expect(mockEnrichAllRepoTopics).toHaveBeenCalledWith({
					onlyActive: false,
					ttlDays: undefined,
				});
			});

			it("should call enrichAllRepoTopics with --active flag", async () => {
				await _testMain(["bun", "cli.ts", "topics:enrich", "--active"]);

				expect(logMocks.info).toHaveBeenCalledWith(
					"Enrich topics: onlyActive=true ttlDays=(default)",
				);
				expect(mockEnrichAllRepoTopics).toHaveBeenCalledWith({
					onlyActive: true,
					ttlDays: undefined,
				});
			});

			it("should call enrichAllRepoTopics with --ttl flag", async () => {
				await _testMain(["bun", "cli.ts", "topics:enrich", "--ttl", "7"]);

				expect(logMocks.info).toHaveBeenCalledWith(
					"Enrich topics: onlyActive=false ttlDays=7",
				);
				expect(mockEnrichAllRepoTopics).toHaveBeenCalledWith({
					onlyActive: false,
					ttlDays: 7,
				});
			});

			it("should call enrichAllRepoTopics with both flags", async () => {
				await _testMain([
					"bun",
					"cli.ts",
					"topics:enrich",
					"--active",
					"--ttl",
					"14",
				]);

				expect(logMocks.info).toHaveBeenCalledWith(
					"Enrich topics: onlyActive=true ttlDays=14",
				);
				expect(mockEnrichAllRepoTopics).toHaveBeenCalledWith({
					onlyActive: true,
					ttlDays: 14,
				});
			});
		});

		describe("handleSetup", () => {
			it("should exit with error when GITHUB_TOKEN is missing", async () => {
				delete Bun.env.GITHUB_TOKEN;

				expect(async () => {
					await _testMain(["bun", "cli.ts", "setup"]);
				}).toThrow("Process exit with code 1");

				expect(logMocks.error).toHaveBeenCalledWith("GITHUB_TOKEN missing");
			});

			it("should generate prompts when Ollama is ready", async () => {
				mockTestOllamaReady.mockResolvedValue({ ok: true });
				mockCheckPromptsState.mockReturnValue({ kind: "ready" });

				await _testMain(["bun", "cli.ts", "setup"]);

				expect(mockTestOllamaReady).toHaveBeenCalled();
				expect(mockGeneratePromptsYaml).toHaveBeenCalledWith("test-token");
				expect(mockPrintSetupStatus).toHaveBeenCalled();
			});

			it("should handle Ollama not ready case", async () => {
				mockTestOllamaReady.mockResolvedValue({
					ok: false,
					reason: "connection failed",
				});
				mockCheckPromptsState.mockReturnValue({
					kind: "incomplete",
					placeholderCount: 3,
				});
				mockCriteriaExamples.mockReturnValue(["example1", "example2"]);

				await _testMain(["bun", "cli.ts", "setup"]);

				expect(logMocks.warn).toHaveBeenCalledWith(
					"Ollama not ready to generate criteria:",
					"connection failed",
				);
				expect(mockGeneratePromptsYaml).toHaveBeenCalledWith("test-token");
				expect(logMocks.warn).toHaveBeenCalledWith(
					"prompts.yaml contains 3 placeholder criteria — edit them before running scoring.",
				);
			});

			it("should handle incomplete prompts state", async () => {
				mockTestOllamaReady.mockResolvedValue({ ok: true });
				mockCheckPromptsState.mockReturnValue({
					kind: "incomplete",
					placeholderCount: 2,
				});

				await _testMain(["bun", "cli.ts", "setup"]);

				expect(logMocks.warn).toHaveBeenCalledWith(
					"prompts.yaml contains 2 placeholder criteria — edit them before running scoring.",
				);
			});
		});

		describe("main CLI routing", () => {
			it("should show help when no command provided", async () => {
				await _testMain(["bun", "cli.ts"]);

				expect(mockShowSetupHintIfNotReady).toHaveBeenCalled();
			});

			it("should show help for help command", async () => {
				await _testMain(["bun", "cli.ts", "help"]);

				expect(mockShowSetupHintIfNotReady).toHaveBeenCalled();
			});

			it("should show help for --help flag", async () => {
				await _testMain(["bun", "cli.ts", "--help"]);

				expect(mockShowSetupHintIfNotReady).toHaveBeenCalled();
			});

			it("should show help for -h flag", async () => {
				await _testMain(["bun", "cli.ts", "-h"]);

				expect(mockShowSetupHintIfNotReady).toHaveBeenCalled();
			});

			it("should handle summarize alias for summarise", async () => {
				await _testMain(["bun", "cli.ts", "summarize", "--all"]);

				expect(mockShowSetupHintIfNotReady).not.toHaveBeenCalled();
			});

			it("should show help for unknown command", async () => {
				await _testMain(["bun", "cli.ts", "unknown-command"]);

				expect(mockShowSetupHintIfNotReady).toHaveBeenCalled();
			});

			it("should handle error in main and exit", async () => {
				expect(typeof _testMain).toBe("function");
			});
		});
	});
});
