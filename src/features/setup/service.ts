import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OllamaService } from "@jasonnathan/llm-core";
import { log } from "@lib/bootstrap";
import { getAllLists } from "@lib/lists";
import { slugify } from "@lib/utils";
import tmpl from "./.prompts.tmpl.yaml";

// Slugs we never want criteria for
const EXCLUDE = new Set(["valuable-resources", "interesting-to-explore"]);

/** Replace the entire `criteria:` section with a block scalar body. */
function replaceCriteriaBlock(tmplStr: string, bodyLines: string): string {
	// Find the start of the criteria node robustly (start of line, 2-space indent)
	const m = /(\n|^)\s{2}criteria:\s*(\n|$)/.exec(tmplStr);
	// Heuristic: next top-level key is 'summarise:' (column 0). If not found, cut to EOF.
	const findNextTop = (from: number) => {
		const i = tmplStr.indexOf("\nsummarise:", from);
		return i === -1 ? tmplStr.length : i;
	};

	let head: string;
	let tail: string;
	if (!m) {
		// Fallback: inject criteria block just before next top-level 'summarise:'
		const end = findNextTop(0);
		head = `${tmplStr.slice(0, end)}\n`;
		tail = tmplStr.slice(end);
	} else {
		const start = m.index + (m[1] ? m[1].length : 0); // beginning of '  criteria:' line
		const criteriaLineEnd = tmplStr.indexOf("\n", start) + 1; // end of line
		const end = findNextTop(criteriaLineEnd);
		head = `${tmplStr.slice(0, start)}  criteria: |\n`;
		tail = tmplStr.slice(end);
	}

	// Body must be indented by 4 spaces to live under the block scalar
	const indented = bodyLines
		.split("\n")
		.map((l) => (l.length ? `    ${l}` : ""))
		.join("\n");

	return `${head + indented}\n${tail}`;
}

export async function generatePromptsYaml(
	token: string,
	outFile = resolve(process.cwd(), "prompts.yaml"),
	opts: { forcePlaceholder?: boolean } = {},
	// Optional dependency injection for tests
	deps?: {
		lists?: Array<{ name: string }>;
		llm?: () => Promise<{
			criteria?: Array<{ slug?: string; description?: string }>;
		}>;
	},
) {
	// Ensure we have raw template text even if Bun imported YAML as an object
	const here = dirname(fileURLToPath(import.meta.url));
	const tmplPath = resolve(here, ".prompts.tmpl.yaml");
	// Bun may import YAML as an object or, depending on config, a stringified path.
	// Prefer the imported string only if it looks like template content; else read file.
	const imported = typeof tmpl === "string" ? (tmpl as string) : "";
	const tmplStr: string = /\bscoring:\b/.test(imported)
		? imported
		: readFileSync(tmplPath, "utf-8");

	// Fetch lists and prepare slugs (skip network if forcing placeholders)
	const lists = opts.forcePlaceholder
		? []
		: (deps?.lists ?? (await getAllLists(token)));
	const sorted = lists.slice().sort((a, b) => a.name.localeCompare(b.name));

	// Build criteria map, optionally via LLM
	const bySlug = new Map<string, string>();

	try {
		if (opts.forcePlaceholder) throw new Error("forced placeholder");
		const slugs = sorted.map((l) => slugify(l.name));
		const names = sorted.map((l) => l.name);

		const examples = `
Examples of criteria style:
  productivity = only score if the repo saves time or automates repetitive tasks in any domain (e.g. work, study, daily life).
  monetise = only score if the repo explicitly helps generate revenue, enable payments, or provide monetisation strategies (business, commerce, content, services).
  networking = only score if the repo explicitly builds or supports communities, connections, or collaboration (social, professional, or technical).
  ai = only score if the repo’s primary focus is AI/ML models, frameworks, applications, or tooling.
  blockchain-finance = only score if the repo is about blockchain, crypto, DeFi, financial systems, or digital assets.
  learning = only score if the repo explicitly teaches through courses, tutorials, exercises, or curricula (any subject, not just programming).
  self-marketing = only score if the repo explicitly promotes an individual (portfolio, profile, blogging, personal branding, analytics).
  team-management = only score if the repo explicitly helps manage, scale, or structure teams (onboarding, communication, rituals, project or workforce management).
`.trim();

		const system = `You are defining exact, concise scoring criteria for GitHub list categories. Return strict JSON following the schema. Do not add extra fields. Criterion must start with 'only score if ...' and be singular, explicit, non-marketing.`;

		const user = `
Generate criteria for the following lists. Follow the style in the examples exactly. For each slug, return a single sentence string that begins with 'only score if'.

Lists:
${slugs.map((s, i) => `- ${names[i]} (${s})`).join("\n")}

Return JSON.
`.trim();

		const schema = {
			type: "object",
			required: ["criteria"],
			properties: {
				criteria: {
					type: "array",
					items: {
						type: "object",
						required: ["slug", "description"],
						properties: {
							slug: { type: "string", enum: slugs },
							description: { type: "string" },
						},
						additionalProperties: false,
					},
				},
			},
			additionalProperties: false,
		} as const;

		const resp = deps?.llm
			? await deps.llm()
			: ((await new OllamaService(
					Bun.env.OLLAMA_MODEL ?? "",
				).generatePromptAndSend(system, `${examples}\n\n${user}`, {
					schema,
				})) as unknown as {
					criteria?: Array<{ slug?: string; description?: string }>;
				});

		if (resp?.criteria) {
			for (const c of resp.criteria) {
				if (c?.slug && c?.description) bySlug.set(c.slug, c.description);
			}
		}
	} catch (e) {
		log.warn(
			`LLM generation failed, using placeholders: ${
				e instanceof Error ? e.message : String(e)
			}`,
		);
	}

	// Build final body lines (exclude unwanted slugs)
	const lines: string[] = [];
	for (const l of sorted) {
		const slug = slugify(l.name);
		if (EXCLUDE.has(slug)) continue;
		const desc =
			bySlug.get(slug) ??
			`only score if the repo clearly fits the “${l.name}” category.`;
		lines.push(`${slug} = ${desc}`);
	}

	const out = replaceCriteriaBlock(tmplStr, lines.join("\n"));
	writeFileSync(outFile, out, "utf-8");
	log.success(`Wrote prompts → ${outFile}`);
}

export async function testOllamaReady(): Promise<{
	ok: boolean;
	reason?: string;
}> {
	const model = Bun.env.OLLAMA_MODEL ?? "";
	if (!model) return { ok: false, reason: "OLLAMA_MODEL not set" };
	try {
		const svc = new OllamaService(model);
		// Minimal noop call to verify we can reach the model
		const schema = { type: "object", additionalProperties: true } as const;
		await svc.generatePromptAndSend("system", "ok", { schema });
		return { ok: true };
	} catch (e) {
		return { ok: false, reason: e instanceof Error ? e.message : String(e) };
	}
}
