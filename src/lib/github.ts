// Minimal GraphQL client using fetch; no external deps.
// Bun.env auto-loads .env
export type GraphQLResponse<T> = { data?: T; errors?: { message: string }[] };

const GITHUB_GQL = "https://api.github.com/graphql";

async function githubGraphQL<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(GITHUB_GQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json"
    },
    body: JSON.stringify({ query, variables })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub GraphQL HTTP ${res.status}: ${text}`);
  }

  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors && json.errors.length) {
    throw new Error(`GitHub GraphQL error: ${json.errors.map(e => e.message).join("; ")}`);
  }
  if (!json.data) {
    throw new Error("GitHub GraphQL: empty data");
  }
  return json.data;
}

export const gql = String.raw;
export { githubGraphQL };
