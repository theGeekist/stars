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

describe("CLI Command Handlers", () => {
	// Mock variables - declared here so they're accessible in all tests
	const mockLogError = jest.fn();
	const mockRunLists = jest.fn();
	const mockRunRepos = jest.fn();
	const mockRunStars = jest.fn();
	const mockRunUnlisted = jest.fn();
	const mockRankOne = jest.fn();
	const mockRankAll = jest.fn();
	const mockSummariseOne = jest.fn();
	const mockSummariseBatchAll = jest.fn();
	const mockEnsurePromptsReadyOrExit = jest.fn();

	// Set up mocks within the describe block to isolate them
	mock.module("@lib/bootstrap", () => ({
		initBootstrap: () => {},
		log: {
			error: mockLogError,
			info: () => {},
			line: () => {},
			header: () => {},
			subheader: () => {},
			list: () => {},
		},
	}));

	mock.module("@src/api/stars", () => ({
		runLists: mockRunLists,
		runRepos: mockRunRepos,
		runStars: mockRunStars,
		runUnlisted: mockRunUnlisted,
	}));

	mock.module("@src/api/ranking.public", () => ({
		rankOne: mockRankOne,
		rankAll: mockRankAll,
		CURATION_POLICY: { curationRemoveThreshold: 0.5 },
	}));

	mock.module("@src/api/summarise", () => ({
		summariseOne: mockSummariseOne,
		summariseBatchAll: mockSummariseBatchAll,
	}));

	mock.module("@lib/prompts", () => ({
		ensurePromptsReadyOrExit: mockEnsurePromptsReadyOrExit,
		checkPromptsState: () => ({ ready: true }),
		criteriaExamples: () => [],
		printSetupStatus: () => {},
		showSetupHintIfNotReady: () => {},
	}));

	// Import after mocks are set up
	let _testMain: (argv: string[]) => Promise<void>;

	beforeAll(async () => {
		const cli = await import("@src/cli");
		_testMain = cli._testMain;
	});

	const originalExit = process.exit;

	beforeEach(() => {
		jest.clearAllMocks();

		// Mock process.exit to throw so we can test error paths without actually exiting
		process.exit = ((code: number) => {
			throw new Error(`Process exit with code ${code}`);
		}) as typeof process.exit;

		// Set default env
		Bun.env.EXPORTS_DIR = "./exports";
	});

	afterEach(() => {
		process.exit = originalExit;
	});
	describe("handleLists", () => {
		it("should call runLists with default options when no flags", async () => {
			await _testMain(["bun", "cli.ts", "lists"]);

			expect(mockRunLists).toHaveBeenCalledWith(false, undefined, "./exports");
		});

		it("should call runLists with json=true when --json flag", async () => {
			await _testMain(["bun", "cli.ts", "lists", "--json"]);

			expect(mockRunLists).toHaveBeenCalledWith(true, undefined, "./exports");
		});

		it("should call runLists with output file when --out specified", async () => {
			await _testMain(["bun", "cli.ts", "lists", "--out", "custom.json"]);

			expect(mockRunLists).toHaveBeenCalledWith(
				false,
				"custom.json",
				"./exports",
			);
		});

		it("should call runLists with both json and output when both flags specified", async () => {
			await _testMain([
				"bun",
				"cli.ts",
				"lists",
				"--json",
				"--out",
				"output.json",
			]);

			expect(mockRunLists).toHaveBeenCalledWith(
				true,
				"output.json",
				"./exports",
			);
		});

		it("should use custom EXPORTS_DIR when env var set", async () => {
			Bun.env.EXPORTS_DIR = "/custom/exports";
			await _testMain(["bun", "cli.ts", "lists"]);

			expect(mockRunLists).toHaveBeenCalledWith(
				false,
				undefined,
				"/custom/exports",
			);
		});
	});

	describe("handleRepos", () => {
		it("should throw error when --list is missing", async () => {
			expect(async () => {
				await _testMain(["bun", "cli.ts", "repos"]);
			}).toThrow("Process exit with code 1");

			expect(mockLogError).toHaveBeenCalledWith("--list <name> is required");
		});

		it("should call runRepos with list name when --list specified", async () => {
			await _testMain(["bun", "cli.ts", "repos", "--list", "productivity"]);

			expect(mockRunRepos).toHaveBeenCalledWith("productivity", false);
		});

		it("should call runRepos with json=true when --json flag", async () => {
			await _testMain(["bun", "cli.ts", "repos", "--list", "ai", "--json"]);

			expect(mockRunRepos).toHaveBeenCalledWith("ai", true);
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

			expect(mockRunRepos).toHaveBeenCalledWith("blockchain", true);
		});
	});

	describe("handleStars", () => {
		it("should call runStars with default options when no flags", async () => {
			await _testMain(["bun", "cli.ts", "stars"]);

			expect(mockRunStars).toHaveBeenCalledWith(false, undefined, "./exports");
		});

		it("should call runStars with json=true when --json flag", async () => {
			await _testMain(["bun", "cli.ts", "stars", "--json"]);

			expect(mockRunStars).toHaveBeenCalledWith(true, undefined, "./exports");
		});

		it("should call runStars with output file when --out specified", async () => {
			await _testMain(["bun", "cli.ts", "stars", "--out", "stars.json"]);

			expect(mockRunStars).toHaveBeenCalledWith(
				false,
				"stars.json",
				"./exports",
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

			expect(mockRunStars).toHaveBeenCalledWith(
				true,
				"all-stars.json",
				"./exports",
			);
		});
	});

	describe("handleUnlisted", () => {
		it("should call runUnlisted with default options when no flags", async () => {
			await _testMain(["bun", "cli.ts", "unlisted"]);

			expect(mockRunUnlisted).toHaveBeenCalledWith(
				false,
				undefined,
				"./exports",
			);
		});

		it("should call runUnlisted with json=true when --json flag", async () => {
			await _testMain(["bun", "cli.ts", "unlisted", "--json"]);

			expect(mockRunUnlisted).toHaveBeenCalledWith(
				true,
				undefined,
				"./exports",
			);
		});

		it("should call runUnlisted with output file when --out specified", async () => {
			await _testMain(["bun", "cli.ts", "unlisted", "--out", "unlisted.json"]);

			expect(mockRunUnlisted).toHaveBeenCalledWith(
				false,
				"unlisted.json",
				"./exports",
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

			expect(mockRunUnlisted).toHaveBeenCalledWith(
				true,
				"unlisted-repos.json",
				"./exports",
			);
		});
	});

	describe("handleScore", () => {
		it("should call rankOne when --one flag specified", async () => {
			await _testMain(["bun", "cli.ts", "score", "--one", "owner/repo"]);

			expect(mockRankOne).toHaveBeenCalledWith({
				selector: "owner/repo",
				dry: false,
				policy: undefined,
			});
		});

		it("should call rankAll when --all flag specified", async () => {
			await _testMain(["bun", "cli.ts", "score", "--all"]);

			expect(mockRankAll).toHaveBeenCalledWith({
				limit: 999999999,
				dry: false,
				policy: undefined,
			});
		});

		it("should call rankAll with limit when --limit specified", async () => {
			await _testMain(["bun", "cli.ts", "score", "--all", "--limit", "50"]);

			expect(mockRankAll).toHaveBeenCalledWith({
				limit: 50,
				dry: false,
				policy: undefined,
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
				policy: undefined,
			});
		});

		it("should build curation policy when --respect-curation flag specified", async () => {
			await _testMain([
				"bun",
				"cli.ts",
				"score",
				"--all",
				"--respect-curation",
			]);

			expect(mockRankAll).toHaveBeenCalledWith({
				limit: 999999999,
				dry: false,
				policy: { curationRemoveThreshold: 0.5 },
			});
		});

		it("should set custom curation threshold when --curation-threshold specified", async () => {
			await _testMain([
				"bun",
				"cli.ts",
				"score",
				"--all",
				"--respect-curation",
				"--curation-threshold",
				"0.8",
			]);

			expect(mockRankAll).toHaveBeenCalledWith({
				limit: 999999999,
				dry: false,
				policy: { curationRemoveThreshold: 0.8 },
			});
		});

		it("should handle --curation alias for --respect-curation", async () => {
			await _testMain(["bun", "cli.ts", "score", "--all", "--curation"]);

			expect(mockRankAll).toHaveBeenCalledWith({
				limit: 999999999,
				dry: false,
				policy: { curationRemoveThreshold: 0.5 },
			});
		});

		it("should handle --fresh flag for rank all mode", async () => {
			await _testMain(["bun", "cli.ts", "score", "--all", "--fresh"]);

			expect(mockRankAll).toHaveBeenCalledWith({
				limit: 999999999,
				dry: false,
				policy: undefined,
			});
		});

		it("should handle multiple flags together", async () => {
			await _testMain([
				"bun",
				"cli.ts",
				"score",
				"--one",
				"test/repo",
				"--dry",
				"--respect-curation",
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

			expect(mockSummariseOne).toHaveBeenCalledWith("owner/repo", false);
		});

		it("should call summariseBatchAll when --all flag specified", async () => {
			await _testMain(["bun", "cli.ts", "summarise", "--all"]);

			expect(mockSummariseBatchAll).toHaveBeenCalledWith(
				999999999,
				false,
				undefined,
				{ resummarise: false },
			);
		});

		it("should call summariseBatchAll with limit when --limit specified", async () => {
			await _testMain(["bun", "cli.ts", "summarise", "--all", "--limit", "25"]);

			expect(mockSummariseBatchAll).toHaveBeenCalledWith(25, false, undefined, {
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

			expect(mockSummariseOne).toHaveBeenCalledWith("owner/repo", true);
		});

		it("should set resummarise=true when --resummarise flag specified", async () => {
			await _testMain(["bun", "cli.ts", "summarise", "--all", "--resummarise"]);

			expect(mockSummariseBatchAll).toHaveBeenCalledWith(
				999999999,
				false,
				undefined,
				{ resummarise: true },
			);
		});

		it("should handle --resummarize alias for --resummarise", async () => {
			await _testMain(["bun", "cli.ts", "summarise", "--all", "--resummarize"]);

			expect(mockSummariseBatchAll).toHaveBeenCalledWith(
				999999999,
				false,
				undefined,
				{ resummarise: true },
			);
		});

		it("should handle multiple flags together", async () => {
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

			expect(mockSummariseBatchAll).toHaveBeenCalledWith(10, true, undefined, {
				resummarise: true,
			});
		});
	});
});
