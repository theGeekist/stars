module.exports = {
	apps: [
		{
			name: "stars-orchestrator",
			script: "./scripts/orchestrator.ts",
			interpreter: "bun",
			cwd: __dirname,
			env: {
				PATH: process.env.HOME + "/.bun/bin:" + process.env.PATH,
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
