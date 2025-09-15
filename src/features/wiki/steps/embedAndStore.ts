// src/features/wiki/steps/embedAndStore.ts

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { OllamaService } from "@jasonnathan/llm-core";
import type {
	ChunkOutput,
	Doc,
	RetrieverHit,
	Step,
	StoreOutput,
} from "../types.ts";

export function stepEmbedAndStore(
	embedModel: string,
): Step<ChunkOutput, StoreOutput> {
	return (log) => async (doc) => {
		const svc = new OllamaService(embedModel);
		const vecs = await svc.embedTexts(doc.chunks.map((c) => c.text));
		const embedded: Doc[] = doc.chunks.map((c, i) => ({
			...c,
			embedding: vecs[i],
		}));

		await mkdir(dirname(doc.dbFile), { recursive: true });
		await writeFile(doc.dbFile, JSON.stringify(embedded), "utf8");
		log.impt?.(`Vector store saved → ${doc.dbFile} (${embedded.length} vecs)`);
		return { ...doc, storePath: doc.dbFile };
	};
}

// tiny search helper (cosine over JSON file)
export async function searchStore(
	storePath: string,
	qv: number[],
	k: number,
): Promise<RetrieverHit[]> {
	const raw = await readFile(storePath, "utf8").catch(() => "[]");
	const docs: Doc[] = JSON.parse(raw);
	const scored = docs
		.filter(
			(d) => Array.isArray(d.embedding) && d.embedding?.length === qv.length,
		)
		.map((d) => {
			let dot = 0,
				na = 0,
				nb = 0;
			const a = d.embedding as number[];
			const b = qv;
			for (let i = 0; i < b.length; i++) {
				dot += a[i] * b[i];
				na += a[i] * a[i];
				nb += b[i] * b[i];
			}
			return { ...d, score: dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9) };
		})
		.sort((x, y) => y.score - x.score)
		.slice(0, k);
	return scored;
}
