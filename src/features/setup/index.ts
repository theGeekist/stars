import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllLists } from "@lib/lists";
import { log } from "@lib/bootstrap";
import { OllamaService } from "@jasonnathan/llm-core";

function herePath(p: string): string {
	const here = dirname(fileURLToPath(import.meta.url));
	return resolve(here, p);
}

export async function generatePromptsYaml(
	token: string,
	outFile = resolve(process.cwd(), "prompts.yaml"),
) {
	const tmplPath = herePath("./.prompts.tmpl.yaml");
	if (!existsSync(tmplPath))
		throw new Error("template .prompts.tmpl.yaml not found");
	const tmpl = readFileSync(tmplPath, "utf-8");

	// Fetch lists and generate criteria block
	const lists = await getAllLists(token);
	const sorted = lists.slice().sort((a, b) => a.name.localeCompare(b.name));

	// Attempt to generate precise criteria via LLM
	let items = "";
	try {
		const svc = new OllamaService(Bun.env.OLLAMA_MODEL ?? "");
		const slugs = sorted.map(
			(l) => l.slug || l.name.toLowerCase().replace(/\s+/g, "-"),
		);
		const names = sorted.map((l) => l.name);

		const system = `You are defining exact, concise scoring criteria for GitHub list categories. Return strict JSON following the schema. Do not add extra fields. Criteria must start with 'only score if ...' and be singular, explicit, and non-marketing.`;
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

		// @ts-expect-error generatePromptAndSend is supported
		const resp: any = await svc.generatePromptAndSend(
			system,
			`${examples}\n\n${user}`,
			{ schema },
		);
		const bySlug = new Map<string, string>();
		if (resp && Array.isArray(resp.criteria)) {
			for (const c of resp.criteria) {
				if (
					c &&
					typeof c.slug === "string" &&
					typeof c.description === "string"
				) {
					bySlug.set(c.slug, c.description);
				}
			}
		}

		items = sorted
			.map((l) => {
				const slug = l.slug || l.name.toLowerCase().replace(/\s+/g, "-");
				const desc =
					bySlug.get(slug) ??
					`only score if the repo clearly fits the “${l.name}” category.`;
				return `  - slug: ${slug}\n    name: ${JSON.stringify(l.name)}\n    description: ${JSON.stringify(desc)}`;
			})
			.join("\n");
	} catch (e) {
		log.warn(
			`LLM generation failed, falling back to TODOs: ${e instanceof Error ? e.message : String(e)}`,
		);
		items = sorted
			.map((l) => {
				const slug = l.slug || l.name.toLowerCase().replace(/\s+/g, "-");
				return `  - slug: ${slug}\n    name: ${JSON.stringify(l.name)}\n    description: ${JSON.stringify(
					`TODO: define criteria for “${l.name}” (when should a repo score > 0?)`,
				)}`;
			})
			.join("\n");
	}

	// Insert criteria directly after the criteria: marker under scoring
	const marker = "\n  criteria:\n";
	const idx = tmpl.indexOf(marker);
	let out = tmpl;
	if (idx !== -1) {
		const insertPos = idx + marker.length;
		out = tmpl.slice(0, insertPos) + items + "\n" + tmpl.slice(insertPos);
	} else {
		out = tmpl + `\nscoring:\n  criteria:\n${items}\n`;
	}

	writeFileSync(outFile, out, "utf-8");
	log.success(`Wrote prompts → ${outFile}`);
}
