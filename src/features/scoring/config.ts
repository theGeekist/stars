import type { ApplyPolicy, Thresholds } from "./types";

export const DEFAULT_PRESERVE = new Set<string>([
	"valuable-resources",
	"interesting-to-explore",
]);

export const DEFAULT_THRESHOLDS: Thresholds = {
	addBySlug: {
		ai: 0.8,
		monetise: 0.7,
		productivity: 0.7,
		networking: 0.7,
		learning: 0.75,
		"blockchain-finance": 0.8,
		"self-marketing": 0.7,
		"team-management": 0.7,
	},
	defaultAdd: 0.7,
	remove: 0.3,
	preserve: DEFAULT_PRESERVE,
};

export const DEFAULT_POLICY: ApplyPolicy = {
	thresholds: DEFAULT_THRESHOLDS,
	avoidListless: true,
	minStars: 50,
};
