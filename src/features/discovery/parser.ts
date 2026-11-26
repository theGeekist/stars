import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type {
	Root,
	RootContent,
	Link,
	LinkReference,
	Definition,
	Nodes,
} from "mdast";

export interface CollectionMention {
	url: string;
	label: string;
	line: number;
	section: string[];
	column?: string;
	role: "item" | "author" | "other";
	context: string;
	related_links?: Array<{
		url: string;
		label: string;
		column?: string;
		role: "item" | "author" | "other";
	}>;
}

/** Extract attributed mentions, not verified targets. Table columns retain their roles. */
export function extractMarkdownMentions(
	markdown: string,
	baseUrl: string,
): CollectionMention[] {
	const tree = unified()
		.use(remarkParse)
		.use(remarkGfm)
		.parse(markdown) as Root;
	const definitions = new Map<string, string>();
	const walk = (node: Nodes, visit: (n: Nodes) => void) => {
		visit(node);
		if ("children" in node)
			for (const child of node.children) walk(child as Nodes, visit);
	};
	walk(tree, (node) => {
		if (node.type === "definition") {
			const def = node as Definition;
			definitions.set(def.identifier.toLowerCase(), def.url);
		}
	});
	const textOf = (node: Nodes): string => {
		if ("value" in node && typeof node.value === "string") return node.value;
		return "children" in node
			? node.children.map((child) => textOf(child as Nodes)).join("")
			: "";
	};
	const sections: string[] = [];
	const mentions: CollectionMention[] = [];
	const collect = (node: Nodes, context: string, column?: string) => {
		walk(node, (child) => {
			if (child.type !== "link" && child.type !== "linkReference") return;
			const raw =
				child.type === "link"
					? (child as Link).url
					: definitions.get((child as LinkReference).identifier.toLowerCase());
			if (!raw || raw.startsWith("#")) return;
			let url: URL;
			try {
				url = new URL(raw, baseUrl);
			} catch {
				return;
			}
			if (url.protocol !== "https:" && url.protocol !== "http:") return;
			const col = column?.trim().toLowerCase() ?? "";
			const role =
				/^(author|authors|user|users|owner|creator|maintainer)s?$/.test(col)
					? "author"
					: column &&
							!/^(name|title|item|resource|repository|repo|project|cookbook|link|website|site)s?$/.test(
								col,
							)
						? "other"
						: "item";
			mentions.push({
				url: url.href,
				label: textOf(child),
				line: child.position?.start.line ?? node.position?.start.line ?? 0,
				section: [...sections],
				...(column ? { column } : {}),
				role,
				context,
			});
		});
	};
	const visitBlocks = (nodes: RootContent[]) => {
		for (const node of nodes) {
			if (node.type === "heading") {
				sections.length = node.depth - 1;
				sections[node.depth - 1] = textOf(node);
			} else if (node.type === "table") {
				const [header, ...rows] = node.children;
				const columns =
					header?.children.map((cell) => textOf(cell).trim()) ?? [];
				for (const row of rows) {
					const context = row.children
						.map((cell) => textOf(cell).trim())
						.join(" | ");
					const start = mentions.length;
					row.children.forEach((cell, index) => {
						collect(cell, context, columns[index]);
					});
					const rowMentions = mentions.slice(start);
					const related = rowMentions.map(({ url, label, column, role }) => ({
						url,
						label,
						...(column ? { column } : {}),
						role,
					}));
					for (const mention of rowMentions) mention.related_links = related;
				}
			} else if (node.type === "list") {
				for (const item of node.children) {
					const own = item.children.filter((child) => child.type !== "list");
					const context = own
						.map((child) => textOf(child))
						.join(" ")
						.trim();
					for (const child of own) collect(child, context);
					for (const child of item.children)
						if (child.type === "list") visitBlocks([child]);
				}
			}
		}
	};
	visitBlocks(tree.children);
	return mentions;
}
