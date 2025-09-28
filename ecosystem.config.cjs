module.exports = {
	apps: [
		{
			name: "stars-orchestrator",
			script: "./scripts/orchestrator.ts",
			interpreter: "bun",
			cwd: __dirname,
			env: {
				PATH: process.env.HOME + "/.bun/bin:" + process.env.PATH,

				// Added environment variables
				GITHUB_TOKEN: process.env.GITHUB_TOKEN,
				DEBUG: "true",
				LISTS_CONCURRENCY: "1",
				MAX_RETRIES: "2",
				BASE_DELAY_MS: "2000",
				GITHUB_API_VERSION: "2022-11-28",
				GQL_USER_AGENT: "geek-stars/0.1 (+https://github.com/theGeekist/stars)",
				OLLAMA_ENDPOINT: "http://localhost:11434",
				OLLAMA_API_KEY: "some-key",
				OLLAMA_MODEL: "llama3.1:latest",
				OLLAMA_EMBEDDING_MODEL: "nomic-embed-text",
				GH_EXPLORE_PATH: "/Users/jasonnathan/Repos/gh_explore",
			},
			// Run every 3 hours at minute 0
			cron_restart: "0 */3 * * *",
			autorestart: false,
			merge_logs: true,
			time: true,
			max_restarts: 1,
			out_file: "logs/orchestrator.out.log",
			error_file: "logs/orchestrator.err.log",
		},
	],
};
