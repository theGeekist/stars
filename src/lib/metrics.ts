export function scorePopularity(stars = 0, forks = 0, watchers = 0): number {
  const base = Math.log10(1 + stars + 2 * forks + 0.5 * watchers);
  return Number(base.toFixed(4));
}

export function scoreFreshness(iso?: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  const days = (Date.now() - t) / 86_400_000;
  const s = Math.max(0, 1 - days / 365);
  return Number(s.toFixed(4));
}

export function scoreActiveness(
  openIssues = 0,
  openPrs = 0,
  pushedAt?: string | null
): number {
  const load = Math.log10(1 + openIssues + 2 * openPrs);
  const pushBoost = scoreFreshness(pushedAt) * 0.7;
  return Number((Math.min(1, load / 2) * 0.6 + pushBoost).toFixed(4));
}

export function deriveTags(input: {
  topics?: string[];
  primary_language?: string | null;
  license?: string | null;
  is_archived?: boolean;
  is_fork?: boolean;
  is_mirror?: boolean;
}): string[] {
  const t = new Set<string>();
  (input.topics ?? []).forEach((x) => x && t.add(x));
  if (input.primary_language)
    t.add(`lang:${input.primary_language.toLowerCase()}`);
  if (input.license) t.add(`license:${input.license.toLowerCase()}`);
  if (input.is_archived) t.add("archived");
  if (input.is_fork) t.add("fork");
  if (input.is_mirror) t.add("mirror");
  return Array.from(t);
}
