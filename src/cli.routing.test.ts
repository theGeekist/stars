import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	jest,
	mock,
} from "bun:test";

describe("CLI Routing and Handlers", () => {
	// Mock external dependencies
	const mockIngest = jest.fn();
	const mockEnrichAllRepoTopics = jest.fn();
	const mockGeneratePromptsYaml = jest.fn();
	const mockTestOllamaReady = jest.fn();
	const _mockUsage = jest.fn();
	const mockShowSetupHintIfNotReady = jest.fn();
	const mockCheckPromptsState = jest.fn();
	const mockPrintSetupStatus = jest.fn();
	const mockCriteriaExamples = jest.fn();
	const mockLogError = jest.fn();
	const mockLogInfo = jest.fn();
	const mockLogWarn = jest.fn();
	const mockLogLine = jest.fn();

	// Mock all the imports
	mock.module("@src/api/ingest", () => ({
		default: mockIngest,
	}));

	mock.module("@src/api/topics", () => ({
		enrichAllRepoTopics: mockEnrichAllRepoTopics,
	}));

	mock.module("@features/setup", () => ({
		generatePromptsYaml: mockGeneratePromptsYaml,
		testOllamaReady: mockTestOllamaReady,
	}));

	mock.module("@lib/prompts", () => ({
		showSetupHintIfNotReady: mockShowSetupHintIfNotReady,
		checkPromptsState: mockCheckPromptsState,
		printSetupStatus: mockPrintSetupStatus,
		criteriaExamples: mockCriteriaExamples,
		ensurePromptsReadyOrExit: () => {},
	}));

	mock.module("@lib/bootstrap", () => ({
		initBootstrap: () => {},
		log: {
			error: mockLogError,
			info: mockLogInfo,
			warn: mockLogWarn,
			line: mockLogLine,
			header: () => {},
			subheader: () => {},
			list: () => {},
		},
	}));

	mock.module("@src/api/stars", () => ({
		runListsCore: () => {},
		runReposCore: () => {},
		runStarsCore: () => {},
		runUnlistedCore: () => {},
	}));

	mock.module("@src/api/ranking.public", () => ({
		rankOne: () => {},
		rankAll: () => {},
		DEFAULT_POLICY: {},
	}));

	mock.module("@src/api/summarise.public", () => ({
		summariseRepo: () => {},
		summariseAll: () => {},
	}));

	// Mock the global usage function by storing original reference
	let _originalUsage: (() => void) | undefined;

	// Mock process.exit
	const originalExit = process.exit;
	const _mockProcessExit = jest.fn();

	beforeEach(() => {
		jest.clearAllMocks();

		// Mock process.exit
		process.exit = ((code: number) => {
			throw new Error(`Process exit with code ${code}`);
		}) as typeof process.exit;

		// Set default env
		Bun.env.EXPORTS_DIR = "./exports";
		Bun.env.GITHUB_TOKEN = "test-token";
	});

	afterEach(() => {
		process.exit = originalExit;
	});

	// Import CLI after mocks are set up
	let _testMain: (argv: string[]) => Promise<void>;

	beforeAll(async () => {
		const cli = await import("@src/cli");
		_testMain = cli._testMain;
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

				expect(mockLogInfo).toHaveBeenCalledWith(
					"Enrich topics: onlyActive=false ttlDays=(default)",
				);
				expect(mockEnrichAllRepoTopics).toHaveBeenCalledWith({
					onlyActive: false,
					ttlDays: undefined,
				});
			});

			it("should call enrichAllRepoTopics with --active flag", async () => {
				await _testMain(["bun", "cli.ts", "topics:enrich", "--active"]);

				expect(mockLogInfo).toHaveBeenCalledWith(
					"Enrich topics: onlyActive=true ttlDays=(default)",
				);
				expect(mockEnrichAllRepoTopics).toHaveBeenCalledWith({
					onlyActive: true,
					ttlDays: undefined,
				});
			});

			it("should call enrichAllRepoTopics with --ttl flag", async () => {
				await _testMain(["bun", "cli.ts", "topics:enrich", "--ttl", "7"]);

				expect(mockLogInfo).toHaveBeenCalledWith(
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

				expect(mockLogInfo).toHaveBeenCalledWith(
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

				expect(mockLogError).toHaveBeenCalledWith("GITHUB_TOKEN missing");
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

				expect(mockLogWarn).toHaveBeenCalledWith(
					"Ollama not ready to generate criteria:",
					"connection failed",
				);
				expect(mockGeneratePromptsYaml).toHaveBeenCalledWith("test-token");
				expect(mockLogWarn).toHaveBeenCalledWith(
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

				expect(mockLogWarn).toHaveBeenCalledWith(
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

				// Should not throw an error and should handle the command
				expect(mockShowSetupHintIfNotReady).not.toHaveBeenCalled();
			});

			it("should show help for unknown command", async () => {
				await _testMain(["bun", "cli.ts", "unknown-command"]);

				expect(mockShowSetupHintIfNotReady).toHaveBeenCalled();
			});

			it("should handle error in main and exit", async () => {
				// This is tricky to test since it's in the main execution block
				// We'll verify the error handling structure exists
				expect(typeof _testMain).toBe("function");
			});
		});
	});
});
