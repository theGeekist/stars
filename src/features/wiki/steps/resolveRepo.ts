// src/pipeline/steps/resolveRepo.ts
import { exec } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PipelineStep, RepoInput, ResolvedRepo } from "../types.ts";

const sh = promisify(exec);

function normaliseRemote(u: string): string {
	try {
		// strip credentials, trailing .git; normalise scheme/host case
		const url = new URL(u);
		url.username = "";
		url.password = "";
		url.hash = "";
		url.search = "";
		url.pathname = url.pathname.replace(/\.git$/i, "");
		url.protocol = url.protocol.replace(/^git\+?/, "https:");
		url.host = url.host.toLowerCase();
		return url.toString();
	} catch {
		// fallback for scp-like syntax: git@github.com:owner/repo.git
		return u
			.replace(/^git@([^:]+):/i, "https://$1/")
			.replace(/\.git$/i, "")
			.toLowerCase();
	}
}

async function exists(path: string) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export function stepResolveRepo(
	rootDir: string,
): PipelineStep<RepoInput, ResolvedRepo> {
	return (log) => async (doc) => {
		const dbFile = join(doc.dbDir, `${doc.dbName}.json`);
		await mkdir(doc.dbDir, { recursive: true });

		let repoRoot = doc.repoUrlOrPath;

		if (/^https?:\/\//.test(doc.repoUrlOrPath)) {
			const target = join(rootDir, "repos", doc.dbName);
			await mkdir(join(rootDir, "repos"), { recursive: true });

			const gitDir = join(target, ".git");
			const targetExists = await exists(target);
			const isGitRepo = targetExists && (await exists(gitDir));

			if (!targetExists) {
				log.impt?.(`Cloning shallow repo -> ${target}`);
				await sh(
					`git clone --depth=1 --single-branch "${doc.repoUrlOrPath}" "${target}"`,
				);
			} else if (!isGitRepo) {
				log.warn?.(
					`Destination exists but is not a git repo, recloning -> ${target}`,
				);
				await sh(`rm -rf "${target}"`);
				await sh(
					`git clone --depth=1 --single-branch "${doc.repoUrlOrPath}" "${target}"`,
				);
			} else {
				// Update existing repo
				log.impt?.(`Updating existing repo -> ${target}`);

				// Ensure origin URL matches
				try {
					const { stdout } = await sh(
						`git -C "${target}" remote get-url origin`,
					);
					const current = normaliseRemote(stdout.trim());
					const desired = normaliseRemote(doc.repoUrlOrPath);
					if (current !== desired) {
						log.warn?.(`origin URL mismatch. resetting origin -> ${desired}`);
						await sh(
							`git -C "${target}" remote set-url origin "${doc.repoUrlOrPath}"`,
						);
					}
				} catch (_e) {
					log.warn?.(`No origin remote; adding one.`);
					await sh(
						`git -C "${target}" remote add origin "${doc.repoUrlOrPath}"`,
					);
				}

				// Discover default branch: origin/HEAD → origin/<branch>
				let branch = "main";
				try {
					const { stdout } = await sh(
						`git -C "${target}" symbolic-ref --quiet --short refs/remotes/origin/HEAD || echo origin/main`,
					);
					const m = stdout.trim().match(/^origin\/(.+)$/);
					if (m?.[1]) branch = m[1];
				} catch {
					try {
						const { stdout } = await sh(
							`git -C "${target}" rev-parse --abbrev-ref HEAD`,
						);
						if (stdout.trim() && stdout.trim() !== "HEAD")
							branch = stdout.trim();
					} catch {
						/* keep default */
					}
				}

				// Shallow update to default branch
				try {
					await sh(`git -C "${target}" fetch --depth=1 origin ${branch}`);
					await sh(`git -C "${target}" reset --hard origin/${branch}`);
					// Optional: clean untracked files to keep index deterministic
					await sh(`git -C "${target}" clean -fdx`);
				} catch (_e) {
					log.warn?.(
						`Shallow update failed, attempting one-time unshallow fetch of branch ${branch}`,
					);
					await sh(`git -C "${target}" fetch --depth=50 origin ${branch}`);
					await sh(`git -C "${target}" reset --hard origin/${branch}`);
				}
			}

			repoRoot = target;
		}

		return { ...doc, repoRoot, dbFile };
	};
}
