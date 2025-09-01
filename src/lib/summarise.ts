// src/lib/summarise.ts
import { gen } from "./ollama";
import { fetchAndChunkReadmeCached } from "./readme";

type Metrics = { popularity?: number; freshness?: number; activeness?: number };
type Meta = {
  repoId?: number;               // ← add this
  nameWithOwner: string;
  url: string;
  description?: string | null;
  primaryLanguage?: string | null;
  topics?: string[];
  metrics?: Metrics;
};

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function enforceWordCap(s: string, cap = 100): string {
  const words = s.trim().split(/\s+/);
  if (words.length <= cap) return s.trim();
  return words
    .slice(0, cap)
    .join(" ")
    .replace(/[.,;:!?-]*$/, ".");
}

export async function summariseRepoOneParagraph(meta: Meta): Promise<string> {
  // 1) chunk the README (sentence-aware)
  const chunks = await fetchAndChunkReadmeCached(
    meta.repoId ?? 0,
    meta.nameWithOwner,
    { chunkSizeTokens: 768, chunkOverlapTokens: 80, mode: "sentence" }
  );

  // Base hints from metadata
  const baseHints = [
    meta.description ?? "",
    meta.primaryLanguage ? `Primary language: ${meta.primaryLanguage}` : "",
    meta.topics?.length ? `Topics: ${meta.topics.join(", ")}` : "",
    meta.metrics
      ? `Signals: popularity=${meta.metrics.popularity ?? 0}, freshness=${
          meta.metrics.freshness ?? 0
        }, activeness=${meta.metrics.activeness ?? 0}`
      : "",
  ]
    .filter(Boolean)
    .join(" | ");

  // If no README, do single-shot
  if (chunks.length === 0) {
    const prompt = `
Write ONE paragraph (<=100 words) that summarises the project for an experienced engineer.
Include purpose, core tech, standout capability, maturity/activity signal (if any), ideal use case.
No bullet points or headings. Neutral tone. Do not invent facts. You must base activity on last update and scores.

Project: ${meta.nameWithOwner}
URL: ${meta.url}
Hints: ${baseHints || "(none)"}
`.trim();
    return enforceWordCap(await gen(prompt, { temperature: 0.2 }), 100);
  }

  // 2) MAP: extract short bullets from a few chunks (keep reducer size small)
  const mapHeader = `
From the following text, extract 2–3 concise bullets (10–18 words each), no fluff.
Focus on: purpose, core tech/architecture, standout capabilities, maturity/activity signals. You must base activity on last update and scores.
Return only bullets prefixed with "- ".
`.trim();

  const bullets: string[] = [];
  const MAX_MAP_CHARS = 7000;
  let used = 0;

  for (const chunk of chunks) {
    if (used > MAX_MAP_CHARS) break;
    const resp = await gen(`${mapHeader}\n\n${chunk}`, { temperature: 0.2 });
    const lines = resp
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- "))
      .slice(0, 3);
    bullets.push(...lines);
    used += chunk.length;
    if (bullets.length >= 18) break;
  }

  if (baseHints) bullets.push(`- ${baseHints}`);

  // 3) REDUCE: final paragraph ≤100 words
  const reducePrompt = `
Write ONE paragraph (≤100 words) for an experienced engineer.
Include: purpose, core tech/approach, one standout capability, maturity/activity signal (if present), ideal use case.
No marketing language. Present tense. If something isn’t in the notes, omit it, do not guess. You must base activity on last update and scores.
Return only the paragraph. British English.

Example:
Bullets:
- Full-stack React framework with file-system routing and hybrid SSR/SSG.
- Built on React Server Components, bundling and dev server tooling included.
- Strong docs, large ecosystem, active development by Vercel; widely adopted in production.

Output:
Next.js is a full-stack React framework that combines server- and client-rendered pages with file-system routing and modern bundling. It builds on React Server Components and ships cohesive tooling for routing, data fetching, and performance optimisation. Its edge is a hybrid SSR/SSG model with seamless API routes and deployment integrations. Backed by strong documentation, active development, and broad production use, it suits teams who want predictable React rendering, fast iteration, and straightforward deployment from prototypes to large-scale apps.

Now summarise these notes as one paragraph (≤100 words):
Bullets:
${bullets.join("\n")}
`.trim();

  const paragraph = await gen(reducePrompt, { temperature: 0.2 });
  return enforceWordCap(paragraph, 100);
}

// --- CLI: run one repo: `bun run src/lib/summarise.ts owner/repo`
if (import.meta.main) {
  const repo = Bun.argv[2];
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
    console.error("Usage: bun run src/lib/summarise.ts <owner/repo>");
    process.exit(1);
  }
  const url = `https://github.com/${repo}`;
  summariseRepoOneParagraph({ nameWithOwner: repo, url })
    .then((p) => {
      console.log(p);
      console.log(`\n(${wordCount(p)} words)`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
