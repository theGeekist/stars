/**
 * stepResolveRepoSha
 * Resolves HEAD commit SHA and a web base URL for permalink generation.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Step, WikiOutput, WithRevision } from "../types.ts";

const pexec = promisify(execFile);

function deriveWebBase(ownerRepo: string): string {
	// Basic GitHub form; extend if you support GitLab/Bitbucket in ResolvedRepo in future.
	return `https://github.com/${ownerRepo}`;
}

export function stepResolveRepoSha(): Step<WikiOutput, WithRevision> {
	return () => async (doc) => {
		const { stdout } = await pexec("git", [
			"-C",
			doc.repoRoot,
			"rev-parse",
			"HEAD",
		]);
		const commitSha = stdout.trim();
		const webBaseUrl = deriveWebBase(doc.ownerRepo);
		return { ...doc, commitSha, webBaseUrl };
	};
}
