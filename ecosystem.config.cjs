module.exports = {
	apps: [
		{
			name: "stars-cron",
			script: "./scripts/stars-cron.zsh",
			interpreter: "/bin/zsh",
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
			out_file: "logs/stars-cron.out.log",
			error_file: "logs/stars-cron.err.log",
		},
	],
};
