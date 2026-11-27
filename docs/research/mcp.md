# Stars research in ChatGPT

Stars is exposed through the existing Geekist MCP Hub. The owner-only route is
`https://mcp.geekist.co/mcp`; it remains protected by the shared Cloudflare
Access OAuth flow. No Stars-specific token is required. In ChatGPT web, open Plugins, select +, then Add custom MCP server. Enter the
URL and choose OAuth when prompted, then review the discovered read-only tools.
Custom MCP access depends on account and workspace permissions; see the [OpenAI
connection guide](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt). If the existing Hub
connection is already installed, reconnect or refresh it to discover the Stars
tools. The actual public unauthenticated request returns HTTP 401 with a Bearer
OAuth challenge. Internal Hub initialization, tool discovery, and WordPress /
spotDL calls passed. A signed-in ChatGPT browser call has not yet been verified
because the available browser-control host was unavailable in this session.

The Hub publishes the five tools under the `stars__` prefix:

- `stars__stars_overview` — catalogue counts, research coverage, score-run and
  discovery availability.
- `stars__stars_search_repositories` — text search and filters for list, topic,
  language, stars, saved score, archive/fork state and coverage.
- `stars__stars_repository_profile` — saved metadata, summary, latest scores,
  paged score history, topic relationships, curated overrides, provenance and
  discovery references. README and large evidence bodies are opt-in.
- `stars__stars_explore_topics` — browse topics or resolve a topic/alias with
  related topics and repositories.
- `stars__stars_search_discoveries` — page retained discovery targets,
  observation sources and previous research. Evidence bodies are opt-in.

Inputs have explicit length and page bounds. Empty results are returned as
empty results with coverage and availability fields; they are not filled with
new GitHub research. Source references and saved observation metadata are
returned when present. Evidence bodies are deliberately requested with
`include_evidence=true` and remain capped. Calls never invoke GitHub, ingestion,
scoring, or Stars mutation routes.

## Host path

The API listener is a separate read-only process bound to `127.0.0.1:8788`.
It opens `DB_FILE` read-only and serves only `/health` and `/research/*`; it
does not run schema setup or expose the Stars dashboard, `/run` routes, shell,
or filesystem access. The existing Fedora MCP SDK adapter calls those fixed
research routes over loopback using typed tool schemas. The shared Rust Gateway
bridges its stdio transport to Streamable HTTP. The existing Hub registers
that local Gateway as a read-only upstream. Public traffic still enters through
the established `mcp.geekist.co/mcp` Access, Worker and Tunnel route; the raw
Stars API and the new local Gateway are not public routes.

Operational checks:

```sh
systemctl --user status geekist-stars-research-api.service stars-research-mcp-gateway.service mcp-hub.service
curl --fail http://127.0.0.1:8788/health
curl -i https://mcp.geekist.co/mcp
```

The public unauthenticated request must receive the Cloudflare Access OAuth
challenge. After OAuth, initialize the MCP session, list tools and call
`stars__stars_overview` or `stars__stars_search_repositories` before relying on
the connection. Keep Gateway and Hub secrets in their existing private host
configuration; the Stars research services require no new credentials.
