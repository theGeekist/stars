import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllLists } from "@lib/lists";
import { log } from "@lib/bootstrap";

function herePath(p: string): string {
	const here = dirname(fileURLToPath(import.meta.url));
	return resolve(here, p);
}

export async function generatePromptsYaml(
	token: string,
	outFile = herePath("./prompts.yaml"),
) {
	const tmplPath = herePath("./.prompts.tmpl.yaml");
	if (!existsSync(tmplPath))
		throw new Error("template .prompts.tmpl.yaml not found");
	const tmpl = readFileSync(tmplPath, "utf-8");

	// Fetch lists and generate criteria block
	const lists = await getAllLists(token);
	const items = lists
		.slice()
		.sort((a, b) => a.name.localeCompare(b.name))
		.map(
			(l) =>
				`  - slug: ${l.slug || l.name.toLowerCase().replace(/\s+/g, "-")}
    name: ${JSON.stringify(l.name)}
    description: ${JSON.stringify(
			`TODO: define criteria for “${l.name}” (when should a repo score > 0?)`,
		)}`,
		)
		.join("\n");

	// Append or replace criteria section
	const content = tmpl.replace(
		/(^|\n)scoring:\n([\s\S]*?)\nsummary:/m,
		(match) => match,
	); // keep as-is
	// Find the criteria section anchor and inject below it
	const anchor = /\ncriteria:\n([\s\S]*?)\n\nsummary:/m;
	let out = content;
	if (anchor.test(content)) {
		out = content.replace(anchor, `\ncriteria:\n${items}\n\nsummary:`);
	} else {
		// Fallback: append at end under scoring
		out = content + `\nscoring:\n  criteria:\n${items}\n`;
	}

	writeFileSync(outFile, out, "utf-8");
	log.success(`Wrote prompts → ${outFile}`);
}
