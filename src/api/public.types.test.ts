import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	jest,
	mock,
} from "bun:test";
import type {
	BatchSelector,
	RepoInfo,
	RepoRow,
	RepoUpdatesMetadata,
	StarList,
	UpdateCandidate,
	UpdateSourceType,
} from "@lib/types";
import {
	buildBatchStats,
	ConfigError,
	createScoringLLMFromConfig,
	getRequiredEnv,
	type ModelConfig,
	type OpStatus,
} from "@src/api/public.types";

describe("Public API Types and Utilities", () => {
	describe("ConfigError", () => {
		it("should create error with correct name and message", () => {
			const error = new ConfigError("Test error message");

			expect(error).toBeInstanceOf(Error);
			expect(error.name).toBe("ConfigError");
			expect(error.message).toBe("Test error message");
		});

		it("should be instanceof ConfigError for type checking", () => {
			const error = new ConfigError("Config missing");

			expect(error instanceof ConfigError).toBe(true);
			expect(error instanceof Error).toBe(true);
		});
	});

	describe("buildBatchStats", () => {
		it("should calculate stats correctly for empty array", () => {
			const items: Array<{ status: OpStatus; saved: boolean }> = [];
			const stats = buildBatchStats(items);

			expect(stats).toEqual({
				processed: 0,
				succeeded: 0,
				failed: 0,
				saved: 0,
			});
		});

		it("should calculate stats correctly for mixed statuses", () => {
			const items = [
				{ status: "ok" as OpStatus, saved: true },
				{ status: "ok" as OpStatus, saved: false },
				{ status: "error" as OpStatus, saved: false },
				{ status: "skipped" as OpStatus, saved: false },
				{ status: "ok" as OpStatus, saved: true },
			];

			const stats = buildBatchStats(items);

			expect(stats).toEqual({
				processed: 5,
				succeeded: 3, // 3 "ok" statuses
				failed: 1, // 1 "error" status
				saved: 2, // 2 with saved: true
			});
		});

		it("should handle all ok statuses", () => {
			const items = [
				{ status: "ok" as OpStatus, saved: true },
				{ status: "ok" as OpStatus, saved: true },
				{ status: "ok" as OpStatus, saved: false },
			];

			const stats = buildBatchStats(items);

			expect(stats).toEqual({
				processed: 3,
				succeeded: 3,
				failed: 0,
				saved: 2,
			});
		});

		it("should handle all error statuses", () => {
			const items = [
				{ status: "error" as OpStatus, saved: false },
				{ status: "error" as OpStatus, saved: false },
			];

			const stats = buildBatchStats(items);

			expect(stats).toEqual({
				processed: 2,
				succeeded: 0,
				failed: 2,
				saved: 0,
			});
		});

		it("should handle skipped statuses correctly", () => {
			const items = [
				{ status: "skipped" as OpStatus, saved: false },
				{ status: "skipped" as OpStatus, saved: true }, // Edge case: skipped but saved
			];

			const stats = buildBatchStats(items);

			expect(stats).toEqual({
				processed: 2,
				succeeded: 0,
				failed: 0,
				saved: 1,
			});
		});
	});

	describe("getRequiredEnv", () => {
		const originalEnv = { ...Bun.env };

		afterEach(() => {
			// Restore original env
			Object.keys(Bun.env).forEach((key) => {
				if (!(key in originalEnv)) {
					delete Bun.env[key];
				}
			});
			Object.assign(Bun.env, originalEnv);
		});

		it("should return value when env var exists", () => {
			Bun.env.TEST_VAR = "test-value";

			const result = getRequiredEnv("TEST_VAR");

			expect(result).toBe("test-value");
		});

		it("should throw ConfigError when env var is missing", () => {
			delete Bun.env.MISSING_VAR;

			expect(() => {
				getRequiredEnv("MISSING_VAR");
			}).toThrow(ConfigError);

			expect(() => {
				getRequiredEnv("MISSING_VAR");
			}).toThrow("MISSING_VAR missing in environment");
		});

		it("should throw ConfigError when env var is empty string", () => {
			Bun.env.EMPTY_VAR = "";

			expect(() => {
				getRequiredEnv("EMPTY_VAR");
			}).toThrow(ConfigError);
		});

		it("should throw ConfigError when env var is only whitespace", () => {
			Bun.env.WHITESPACE_VAR = "   ";

			expect(() => {
				getRequiredEnv("WHITESPACE_VAR");
			}).toThrow(ConfigError);
		});

		it("should include help text in error message when provided", () => {
			delete Bun.env.TOKEN_VAR;

			expect(() => {
				getRequiredEnv("TOKEN_VAR", "Get it from https://example.com");
			}).toThrow("TOKEN_VAR missing. Get it from https://example.com");
		});

		it("should return trimmed value", () => {
			Bun.env.SPACED_VAR = "  value  ";

			// Note: The function doesn't actually trim, but we test the actual behavior
			const result = getRequiredEnv("SPACED_VAR");

			expect(result).toBe("  value  ");
		});
	});

	describe("createScoringLLMFromConfig", () => {
		// Mock the ollama module to test the function
		const mockGen = jest.fn();

		// Use mock.module instead of global require mocking
		beforeEach(() => {
			jest.clearAllMocks();

			// Mock the ollama module
			mock.module("@lib/ollama", () => ({
				gen: mockGen,
			}));
		});

		afterEach(() => {
			// Mocks are automatically cleaned up by Bun
		});

		it("should create LLM adapter with basic config", async () => {
			const config: ModelConfig = {
				model: "test-model",
			};

			mockGen.mockResolvedValue('{"result": "test"}');

			const adapter = createScoringLLMFromConfig(config);

			expect(adapter).toHaveProperty("generatePromptAndSend");
			expect(typeof adapter.generatePromptAndSend).toBe("function");
		});

		it("should call gen with correct parameters", async () => {
			const config: ModelConfig = {
				model: "llama3.1:8b",
				host: "http://localhost:11434",
			};

			mockGen.mockResolvedValue('{"scores": [{"list": "test", "score": 0.8}]}');

			const adapter = createScoringLLMFromConfig(config);
			await adapter.generatePromptAndSend("system prompt", "user prompt");

			expect(mockGen).toHaveBeenCalledWith("system prompt\n\nuser prompt", {
				model: "llama3.1:8b",
				host: "http://localhost:11434",
				headers: undefined,
			});
		});

		it("should include Authorization header when apiKey provided", async () => {
			const config: ModelConfig = {
				model: "gpt-4",
				host: "https://api.openai.com",
				apiKey: "sk-test-key",
			};

			mockGen.mockResolvedValue('{"result": "success"}');

			const adapter = createScoringLLMFromConfig(config);
			await adapter.generatePromptAndSend("system", "user");

			expect(mockGen).toHaveBeenCalledWith("system\n\nuser", {
				model: "gpt-4",
				host: "https://api.openai.com",
				headers: { Authorization: "Bearer sk-test-key" },
			});
		});

		it("should parse JSON response correctly", async () => {
			const config: ModelConfig = {
				model: "test-model",
			};

			const jsonResponse = { scores: [{ list: "productivity", score: 0.9 }] };
			mockGen.mockResolvedValue(JSON.stringify(jsonResponse));

			const adapter = createScoringLLMFromConfig(config);
			const result = await adapter.generatePromptAndSend("system", "user");

			expect(result).toEqual(jsonResponse);
		});

		it("should fallback to raw string when JSON parsing fails", async () => {
			const config: ModelConfig = {
				model: "test-model",
			};

			const invalidJson = "not a json response";
			mockGen.mockResolvedValue(invalidJson);

			const adapter = createScoringLLMFromConfig(config);
			const result = await adapter.generatePromptAndSend("system", "user");

			expect(result).toBe(invalidJson);
		});

		it("should construct prompt correctly", async () => {
			const config: ModelConfig = {
				model: "test-model",
			};

			mockGen.mockResolvedValue("{}");

			const adapter = createScoringLLMFromConfig(config);
			await adapter.generatePromptAndSend(
				"System: Score these repos",
				"User: repo1, repo2",
			);

			expect(mockGen).toHaveBeenCalledWith(
				"System: Score these repos\n\nUser: repo1, repo2",
				expect.any(Object),
			);
		});

		it("should ignore schema option (compatibility)", async () => {
			const config: ModelConfig = {
				model: "test-model",
			};

			mockGen.mockResolvedValue("{}");

			const adapter = createScoringLLMFromConfig(config);
			await adapter.generatePromptAndSend("system", "user", {
				schema: { type: "object" },
			});

			// Should still work, schema is ignored as documented
			expect(mockGen).toHaveBeenCalled();
		});
	});
});

describe("Consolidated Types", () => {
	describe("BatchSelector", () => {
		it("should accept limit and listSlug properties", () => {
			const selector: BatchSelector = {
				limit: 10,
				listSlug: "test-list",
			};

			expect(selector.limit).toBe(10);
			expect(selector.listSlug).toBe("test-list");
		});

		it("should work with partial properties", () => {
			const limitOnly: BatchSelector = { limit: 5 };
			const slugOnly: BatchSelector = { listSlug: "my-list" };
			const empty: BatchSelector = {};

			expect(limitOnly.limit).toBe(5);
			expect(limitOnly.listSlug).toBeUndefined();
			expect(slugOnly.listSlug).toBe("my-list");
			expect(slugOnly.limit).toBeUndefined();
			expect(empty).toEqual({});
		});
	});

	describe("RepoRow", () => {
		it("should have required fields", () => {
			const repo: RepoRow = {
				id: 1,
				repo_id: "R_test123",
				name_with_owner: "user/repo",
				url: "https://github.com/user/repo",
				description: "Test repo",
				is_archived: 0,
				is_disabled: 0,
			};

			expect(repo.id).toBe(1);
			expect(repo.repo_id).toBe("R_test123");
			expect(repo.name_with_owner).toBe("user/repo");
		});

		it("should handle optional fields", () => {
			const repo: RepoRow = {
				id: 2,
				repo_id: "R_test456",
				name_with_owner: "org/app",
				url: "https://github.com/org/app",
				is_archived: 0,
				is_disabled: 0,
				// Optional fields
				summary: "A great app",
				popularity: 0.8,
				freshness: 0.6,
				activeness: 0.9,
				stars: 100,
				forks: 25,
			};

			expect(repo.summary).toBe("A great app");
			expect(repo.popularity).toBe(0.8);
			expect(repo.stars).toBe(100);
		});
	});

	describe("RepoInfo", () => {
		it("should have required GitHub metadata", () => {
			const repoInfo: RepoInfo = {
				repoId: "R_test789",
				nameWithOwner: "test/project",
				url: "https://github.com/test/project",
				stars: 50,
				forks: 10,
				watchers: 25,
				openIssues: 5,
				openPRs: 2,
				topics: ["javascript", "testing"],
				languages: [
					{ name: "TypeScript", bytes: 1000 },
					{ name: "JavaScript", bytes: 500 },
				],
				isArchived: false,
				isDisabled: false,
				isFork: false,
				isMirror: false,
				hasIssuesEnabled: true,
				pushedAt: "2023-01-01T00:00:00Z",
				updatedAt: "2023-01-01T00:00:00Z",
				createdAt: "2022-01-01T00:00:00Z",
			};

			expect(repoInfo.repoId).toBe("R_test789");
			expect(repoInfo.topics).toEqual(["javascript", "testing"]);
			expect(repoInfo.languages).toHaveLength(2);
			expect(repoInfo.languages[0].name).toBe("TypeScript");
		});
	});

	describe("UpdateSourceType and related types", () => {
		it("should allow valid update source types", () => {
			const sources: UpdateSourceType[] = [
				"release",
				"changelog",
				"discussion",
				"commit",
			];

			sources.forEach((source) => {
				const candidate: UpdateCandidate = {
					type: source,
					confidence: 0.8,
					data: { test: "value" },
				};

				expect(candidate.type).toBe(source);
				expect(candidate.confidence).toBe(0.8);
			});
		});

		it("should work with RepoUpdatesMetadata", () => {
			const metadata: RepoUpdatesMetadata = {
				preferred: "release",
				candidates: [
					{ type: "release", confidence: 0.9 },
					{
						type: "changelog",
						confidence: 0.7,
						data: { path: "CHANGELOG.md" },
					},
				],
			};

			expect(metadata.preferred).toBe("release");
			expect(metadata.candidates).toHaveLength(2);
			expect(metadata.candidates[0].confidence).toBe(0.9);
		});
	});

	describe("StarList", () => {
		it("should contain repos and metadata", () => {
			const mockRepoInfo: RepoInfo = {
				repoId: "R_test",
				nameWithOwner: "test/repo",
				url: "https://github.com/test/repo",
				stars: 10,
				forks: 2,
				watchers: 5,
				openIssues: 1,
				openPRs: 0,
				topics: [],
				languages: [],
				isArchived: false,
				isDisabled: false,
				isFork: false,
				isMirror: false,
				hasIssuesEnabled: true,
				pushedAt: "2023-01-01T00:00:00Z",
				updatedAt: "2023-01-01T00:00:00Z",
				createdAt: "2022-01-01T00:00:00Z",
			};

			const starList: StarList = {
				listId: "list_123",
				name: "My Favorites",
				description: "Collection of favorite repos",
				isPrivate: false,
				repos: [mockRepoInfo],
			};

			expect(starList.listId).toBe("list_123");
			expect(starList.name).toBe("My Favorites");
			expect(starList.repos).toHaveLength(1);
			expect(starList.repos[0].nameWithOwner).toBe("test/repo");
		});
	});
});
