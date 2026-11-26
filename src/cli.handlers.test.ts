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

describe("CLI Command Handlers", () => {
	const mockRunListsCore = jest.fn();
	const mockRunReposCore = jest.fn();
	const mockRunStarsCore = jest.fn();
	const mockRunUnlistedCore = jest.fn();
	const mockRankOne = jest.fn();
	const mockRankAll = jest.fn();
	const mockSummariseRepo = jest.fn();
	const mockSummariseAll = jest.fn();

	let _testMain: (argv: string[]) => Promise<void>;
	let _setCliDepsImpl: (
		overrides: Parameters<typeof import("@src/cli")._setCliDeps>[0],
	) => void;
	let _resetCliDepsImpl: () => void;

	let bootstrapModule: typeof import("@lib/bootstrap");
	const { log: mockLog, mocks: logMocks } = createMockLogger();
	let restoreLog: (() => void) | undefined;
	let initBootstrapSpy: ReturnType<typeof jest.spyOn> | undefined;

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

		const cli = await import("@src/cli");
		_testMain = cli._testMain;
		_setCliDepsImpl = cli._setCliDeps;
		_resetCliDepsImpl = cli._resetCliDeps;
	});

	afterAll(() => {
		initBootstrapSpy?.mockRestore();
		restoreLog?.();
	});

	const originalExit = process.exit;

	beforeEach(() => {
		jest.clearAllMocks();
		_setCliDepsImpl({
			runLists: mockRunListsCore,
			runRepos: mockRunReposCore,
			runStars: mockRunStarsCore,
			runUnlisted: mockRunUnlistedCore,
			rankOne: mockRankOne,
			rankAll: mockRankAll,
			summariseRepo: mockSummariseRepo,
			summariseAll: mockSummariseAll,
		});

		process.exit = ((code: number) => {
			throw new Error(`Process exit with code ${code}`);
		}) as typeof process.exit;

		Bun.env.EXPORTS_DIR = "./exports";
	});

	afterEach(() => {
		process.exit = originalExit;
		_resetCliDepsImpl();
	});

	describe("handleLists", () => {
		it("should call runListsCore with default options when no flags", async () => {
			await _testMain(["bun", "cli.ts", "lists"]);

			expect(mockRunListsCore).toHaveBeenCalledWith(
				false,
				undefined,
				"./exports",
				expect.objectContaining({ error: logMocks.error }),
			);
		});

		it("should call runListsCore with json=true when --json flag", async () => {
			await _testMain(["bun", "cli.ts", "lists", "--json"]);

			expect(mockRunListsCore).toHaveBeenCalledWith(
				true,
				undefined,
				"./exports",
				expect.objectContaining({ error: logMocks.error }),
			);
		});

		it("should call runListsCore with output file when --out specified", async () => {
			await _testMain(["bun", "cli.ts", "lists", "--out", "custom.json"]);

			expect(mockRunListsCore).toHaveBeenCalledWith(
				false,
				"custom.json",
				"./exports",
				expect.objectContaining({ error: logMocks.error }),
			);
		});

		it("should call runListsCore with both json and output when both flags specified", async () => {
			await _testMain([
				"bun",
				"cli.ts",
				"lists",
				"--json",
				"--out",
				"output.json",
			]);

			expect(mockRunListsCore).toHaveBeenCalledWith(
				true,
				"output.json",
				"./exports",
				expect.objectContaining({ error: logMocks.error }),
			);
		});

		it("should use custom EXPORTS_DIR when env var set", async () => {
			Bun.env.EXPORTS_DIR = "/custom/exports";
			await _testMain(["bun", "cli.ts", "lists"]);

			expect(mockRunListsCore).toHaveBeenCalledWith(
				false,
				undefined,
				"/custom/exports",
				expect.objectContaining({ error: logMocks.error }),
			);
		});
	});

	describe("handleRepos", () => {
		it("should throw error when --list is missing", async () => {
			expect(async () => {
				await _testMain(["bun", "cli.ts", "repos"]);
			}).toThrow("Process exit with code 1");

			expect(logMocks.error).toHaveBeenCalledWith("--list <name> is required");
		});

		it("should call runRepos with list name when --list specified", async () => {
			await _testMain(["bun", "cli.ts", "repos", "--list", "productivity"]);

			expect(mockRunReposCore).toHaveBeenCalledWith(
				"productivity",
				false,
				expect.objectContaining({ error: logMocks.error }),
			);
		});

		it("should call runRepos with json=true when --json flag", async () => {
			await _testMain(["bun", "cli.ts", "repos", "--list", "ai", "--json"]);

			expect(mockRunReposCore).toHaveBeenCalledWith(
				"ai",
				true,
				expect.objectContaining({ error: logMocks.error }),
			);
		});

		it("should handle flags in different order", async () => {
			await _testMain([
				"bun",
				"cli.ts",
				"repos",
				"--json",
				"--list",
				"blockchain",
			]);

			expect(mockRunReposCore).toHaveBeenCalledWith(
				"blockchain",
				true,
				expect.objectContaining({ error: logMocks.error }),
			);
		});
	});

	describe("handleStars", () => {
		it("should call runStars with default options when no flags", async () => {
			await _testMain(["bun", "cli.ts", "stars"]);

			expect(mockRunStarsCore).toHaveBeenCalledWith(
				false,
				undefined,
				"./exports",
				expect.objectContaining({ error: logMocks.error }),
			);
		});

		it("should call runStars with json=true when --json flag", async () => {
			await _testMain(["bun", "cli.ts", "stars", "--json"]);

			expect(mockRunStarsCore).toHaveBeenCalledWith(
				true,
				undefined,
				"./exports",
				expect.objectContaining({ error: logMocks.error }),
			);
		});

		it("should call runStars with output file when --out specified", async () => {
			await _testMain(["bun", "cli.ts", "stars", "--out", "stars.json"]);

			expect(mockRunStarsCore).toHaveBeenCalledWith(
				false,
				"stars.json",
				"./exports",
				expect.objectContaining({ error: logMocks.error }),
			);
		});

		it("should call runStars with both json and output when both flags specified", async () => {
			await _testMain([
				"bun",
				"cli.ts",
				"stars",
				"--json",
				"--out",
				"all-stars.json",
			]);

			expect(mockRunStarsCore).toHaveBeenCalledWith(
				true,
				"all-stars.json",
				"./exports",
				expect.objectContaining({ error: logMocks.error }),
			);
		});
	});

	describe("handleUnlisted", () => {
		it("should call runUnlisted with default options when no flags", async () => {
			await _testMain(["bun", "cli.ts", "unlisted"]);

			expect(mockRunUnlistedCore).toHaveBeenCalledWith(
				false,
				undefined,
				"./exports",
				undefined,
				expect.objectContaining({ error: logMocks.error }),
			);
		});

		it("should call runUnlisted with json=true when --json flag", async () => {
			await _testMain(["bun", "cli.ts", "unlisted", "--json"]);

			expect(mockRunUnlistedCore).toHaveBeenCalledWith(
				true,
				undefined,
				"./exports",
				undefined,
				expect.objectContaining({ error: logMocks.error }),
			);
		});

		it("should call runUnlisted with output file when --out specified", async () => {
			await _testMain(["bun", "cli.ts", "unlisted", "--out", "unlisted.json"]);

			expect(mockRunUnlistedCore).toHaveBeenCalledWith(
				false,
				"unlisted.json",
				"./exports",
				undefined,
				expect.objectContaining({ error: logMocks.error }),
			);
		});

		it("should call runUnlisted with both json and output when both flags specified", async () => {
			await _testMain([
				"bun",
				"cli.ts",
				"unlisted",
				"--json",
				"--out",
				"unlisted-repos.json",
			]);

			expect(mockRunUnlistedCore).toHaveBeenCalledWith(
				true,
				"unlisted-repos.json",
				"./exports",
				undefined,
				expect.objectContaining({ error: logMocks.error }),
			);
		});
	});

	describe("handleScore", () => {
		it("should call rankOne when --one flag specified", async () => {
			await _testMain(["bun", "cli.ts", "score", "--one", "owner/repo"]);

			expect(mockRankOne).toHaveBeenCalledWith({
				selector: "owner/repo",
				dry: false,
				policy: {},
			});
		});

		it("should call rankAll when --all flag specified", async () => {
			await _testMain(["bun", "cli.ts", "score", "--all"]);

			expect(mockRankAll).toHaveBeenCalledWith({
				dry: false,
				limit: 999999999,
				policy: {},
			});
		});

		it("should call rankAll with limit when --limit specified", async () => {
			await _testMain(["bun", "cli.ts", "score", "--all", "--limit", "50"]);

			expect(mockRankAll).toHaveBeenCalledWith({
				dry: false,
				limit: 50,
				policy: {},
			});
		});

		it("should set dry=true when --dry flag specified", async () => {
			await _testMain([
				"bun",
				"cli.ts",
				"score",
				"--one",
				"owner/repo",
				"--dry",
			]);

			expect(mockRankOne).toHaveBeenCalledWith({
				selector: "owner/repo",
				dry: true,
				policy: {},
			});
		});

		it("should set custom curation threshold when --curation-threshold specified", async () => {
			await _testMain([
				"bun",
				"cli.ts",
				"score",
				"--all",
				"--curation-threshold",
				"0.8",
			]);

			expect(mockRankAll).toHaveBeenCalledWith(
				expect.objectContaining({
					dry: false,
					limit: 999999999,
					policy: expect.objectContaining({
						curationRemoveThreshold: 0.8,
					}),
				}),
			);
		});

		it("should handle --fresh flag for rank all mode", async () => {
			await _testMain(["bun", "cli.ts", "score", "--all", "--fresh"]);

			expect(mockRankAll).toHaveBeenCalledWith(
				expect.objectContaining({
					dry: false,
					limit: 999999999,
					policy: expect.objectContaining({}),
				}),
			);
			expect(logMocks.info).toHaveBeenCalledWith(
				expect.stringContaining("fresh=true"),
			);
		});

		it("should handle multiple flags together", async () => {
			await _testMain([
				"bun",
				"cli.ts",
				"score",
				"--one",
				"test/repo",
				"--dry",
				"--curation-threshold",
				"0.7",
			]);

			expect(mockRankOne).toHaveBeenCalledWith({
				selector: "test/repo",
				dry: true,
				policy: { curationRemoveThreshold: 0.7 },
			});
		});
	});

	describe("handleSummarise", () => {
		it("should call summariseOne when --one flag specified", async () => {
			await _testMain(["bun", "cli.ts", "summarise", "--one", "owner/repo"]);

			expect(mockSummariseRepo).toHaveBeenCalledWith({
				selector: "owner/repo",
				dry: false,
				logger: expect.objectContaining({ error: logMocks.error }),
			});
		});

		it("should call summariseAll when --all flag specified", async () => {
			await _testMain(["bun", "cli.ts", "summarise", "--all"]);

			expect(mockSummariseAll).toHaveBeenCalledWith({
				dry: false,
				limit: 999999999,
				logger: expect.objectContaining({ error: logMocks.error }),
				resummarise: false,
			});
		});

		it("should call summariseAll with limit when --limit specified", async () => {
			await _testMain(["bun", "cli.ts", "summarise", "--all", "--limit", "25"]);

			expect(mockSummariseAll).toHaveBeenCalledWith({
				dry: false,
				limit: 25,
				logger: expect.objectContaining({ error: logMocks.error }),
				resummarise: false,
			});
		});

		it("should set dry=true when --dry flag specified", async () => {
			await _testMain([
				"bun",
				"cli.ts",
				"summarise",
				"--one",
				"owner/repo",
				"--dry",
			]);

			expect(mockSummariseRepo).toHaveBeenCalledWith({
				selector: "owner/repo",
				dry: true,
				logger: expect.objectContaining({ error: logMocks.error }),
			});
		});

		it("should set resummarise=true when --resummarise flag specified", async () => {
			await _testMain(["bun", "cli.ts", "summarise", "--all", "--resummarise"]);

			expect(mockSummariseAll).toHaveBeenCalledWith({
				dry: false,
				limit: 999999999,
				logger: expect.objectContaining({ error: logMocks.error }),
				resummarise: true,
			});
		});

		it("should handle --resummarize alias for --resummarise", async () => {
			await _testMain(["bun", "cli.ts", "summarise", "--all", "--resummarize"]);

			expect(mockSummariseAll).toHaveBeenCalledWith({
				dry: false,
				limit: 999999999,
				logger: expect.objectContaining({ error: logMocks.error }),
				resummarise: true,
			});
		});

		it("should handle multiple summarise flags together", async () => {
			await _testMain([
				"bun",
				"cli.ts",
				"summarise",
				"--all",
				"--limit",
				"10",
				"--dry",
				"--resummarise",
			]);

			expect(mockSummariseAll).toHaveBeenCalledWith({
				dry: true,
				limit: 10,
				logger: expect.objectContaining({ error: logMocks.error }),
				resummarise: true,
			});
		});
	});
});
