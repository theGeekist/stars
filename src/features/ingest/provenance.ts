import { makeCreateService } from "@lib/create-service";

/** A source's observation of a research target; additional source fields are retained. */
export type DiscoveryObservation = {
	target: string;
	context_topics?: string[];
	[key: string]: unknown;
};

type ProvenanceRow = { source: string; details_json: string };

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).sort(
			([a], [b]) => a.localeCompare(b),
		);
		return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

function readDetails(row: ProvenanceRow): Record<string, unknown> {
	const value: unknown = JSON.parse(row.details_json);
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Provenance for ${row.source} is not a JSON object`);
	}
	return value as Record<string, unknown>;
}

/** Source-keyed discovery evidence, independent of GitHub List membership and topic reconciliation. */
export const createProvenanceService = makeCreateService(({ db }) => {
	const select = db.query<ProvenanceRow, [string]>(
		"SELECT source, details_json FROM recovery_provenance WHERE source = ?",
	);
	const all = db.query<ProvenanceRow, []>(
		"SELECT source, details_json FROM recovery_provenance ORDER BY source",
	);
	const save = db.query<unknown, [string, string]>(
		"INSERT INTO recovery_provenance(source, details_json) VALUES (?, ?) ON CONFLICT(source) DO UPDATE SET details_json = excluded.details_json",
	);

	function observations(
		details: Record<string, unknown>,
	): DiscoveryObservation[] {
		const value = details.discovery_observations;
		if (value === undefined) return [];
		if (!Array.isArray(value))
			throw new Error("discovery_observations is not an array");
		return value as DiscoveryObservation[];
	}

	return {
		/** Append a source observation; exact replay is idempotent. Preserves unrelated JSON keys. */
		record(source: string, observation: DiscoveryObservation): boolean {
			if (!source.trim() || !observation.target?.trim())
				throw new Error("Source and target are required");
			// Round-trip into plain JSON, rejecting unserialisable payloads before any write.
			const item = JSON.parse(
				JSON.stringify(observation),
			) as DiscoveryObservation;
			return db
				.transaction(() => {
					const row = select.get(source);
					const details = row ? readDetails(row) : {};
					const entries = observations(details);
					const key = canonical(item);
					if (entries.some((entry) => canonical(entry) === key)) return false;
					details.discovery_observations = [...entries, item];
					save.run(source, JSON.stringify(details));
					return true;
				})
				.immediate();
		},
		forSource(source: string): DiscoveryObservation[] {
			const row = select.get(source);
			return row ? observations(readDetails(row)) : [];
		},
		forTopic(
			topic: string,
		): Array<{ source: string; observation: DiscoveryObservation }> {
			return all.all().flatMap((row) =>
				observations(readDetails(row))
					.filter(
						(observation) =>
							Array.isArray(observation.context_topics) &&
							observation.context_topics.includes(topic),
					)
					.map((observation) => ({ source: row.source, observation })),
			);
		},
		forTarget(
			target: string,
		): Array<{ source: string; observation: DiscoveryObservation }> {
			return all.all().flatMap((row) =>
				observations(readDetails(row))
					.filter((observation) => observation.target === target)
					.map((observation) => ({ source: row.source, observation })),
			);
		},
	};
});
