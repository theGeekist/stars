"""Read-only MCP adapter for the Stars research HTTP API.

Run this with the already installed Fedora shared MCP virtual environment. The
Rust MCP Gateway owns the Streamable HTTP transport; this process only exposes
typed tools over stdio and calls the loopback Stars API.
"""

from __future__ import annotations

import json
import os
from typing import Annotated, Literal
from urllib.parse import urlsplit

import httpx
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from pydantic import Field


API_BASE = os.environ.get("STARS_API_URL", "http://127.0.0.1:8788").rstrip("/")
API_ORIGIN = urlsplit(API_BASE)
if API_ORIGIN.scheme != "http" or API_ORIGIN.hostname != "127.0.0.1" or API_ORIGIN.path:
    raise RuntimeError("STARS_API_URL must be an HTTP origin on 127.0.0.1")
MAX_RESPONSE_BYTES = 60_000
TIMEOUT_SECONDS = 8.0

mcp = FastMCP(
    "Geekist Stars Research",
    instructions=(
        "Search the retained Geekist Stars catalogue and research only. Results may be empty or incomplete; "
        "report their coverage and evidence references accurately. Search and read tools do not fetch GitHub, "
        "run ingestion, or change the catalogue. Use stars_repository_profile for a repository's saved "
        "summary, metadata, topics, scores, relationships, and provenance. Evidence bodies are opt-in and bounded."
    ),
)
READ_ONLY = ToolAnnotations(
	readOnlyHint=True,
	destructiveHint=False,
	idempotentHint=True,
	openWorldHint=False,
)


async def _get(path: str, params: dict[str, object] | None = None) -> str:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, trust_env=False) as client:
            response = await client.get(f"{API_BASE}{path}", params=params)
        if response.status_code >= 400:
            try:
                payload = response.json()
            except ValueError:
                payload = {"error": f"Stars API returned HTTP {response.status_code}"}
            return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        if len(response.content) > MAX_RESPONSE_BYTES:
            return json.dumps(
                {
                    "error": "response_too_large",
                    "message": "Narrow the query or request a smaller page; no evidence was discarded silently.",
                    "responseBytes": len(response.content),
                    "maximumBytes": MAX_RESPONSE_BYTES,
                },
                separators=(",", ":"),
            )
        return json.dumps(response.json(), ensure_ascii=False, separators=(",", ":"))
    except httpx.TimeoutException:
        return json.dumps({"error": "stars_api_timeout", "message": "The local Stars research API did not respond within eight seconds."})
    except httpx.RequestError as error:
        return json.dumps({"error": "stars_api_unavailable", "message": type(error).__name__})


@mcp.tool(annotations=READ_ONLY)
async def stars_overview() -> str:
    """Show catalogue counts, saved research coverage, score freshness and discovery availability."""
    return await _get("/research/overview")


@mcp.tool(annotations=READ_ONLY)
async def stars_search_repositories(
    q: Annotated[str | None, Field(default=None, max_length=200, description="Words or an owner/repository name to search.")] = None,
    list: Annotated[str | None, Field(default=None, max_length=200, description="Exact curated list slug.")] = None,
    topic: Annotated[str | None, Field(default=None, max_length=200, description="Repository topic or enriched topic.")] = None,
    language: Annotated[str | None, Field(default=None, max_length=100)] = None,
    min_stars: Annotated[int | None, Field(default=None, ge=0)] = None,
    min_score: Annotated[float | None, Field(default=None, ge=0, le=1, description="Minimum latest saved repository score.")] = None,
    has_summary: bool | None = None,
    has_readme: bool | None = None,
    archived: bool | None = None,
    fork: bool | None = None,
    sort: Literal["popularity", "stars", "freshness", "activeness", "updated", "name"] = "popularity",
    limit: Annotated[int, Field(ge=1, le=50)] = 20,
    offset: Annotated[int, Field(ge=0, le=1_000_000)] = 0,
) -> str:
    """Search saved repositories using text, list, topic, language, score and catalogue filters."""
    values = {
        "q": q,
        "list": list,
        "topic": topic,
        "language": language,
        "minStars": min_stars,
        "minScore": min_score,
        "hasSummary": has_summary,
        "hasReadme": has_readme,
        "archived": archived,
        "fork": fork,
        "sort": sort,
        "limit": limit,
        "offset": offset,
    }
    return await _get("/research/repositories", {key: value for key, value in values.items() if value is not None})


@mcp.tool(annotations=READ_ONLY)
async def stars_repository_profile(
    key: Annotated[str, Field(min_length=1, max_length=300, description="Owner/repository, GitHub node ID, or local repository ID.")],
    include_evidence: bool = False,
    include_readme: bool = False,
    history_limit: Annotated[int, Field(ge=1, le=50)] = 20,
    history_offset: Annotated[int, Field(ge=0, le=1_000_000)] = 0,
) -> str:
    """Read one repository's saved profile, relationships, score history and provenance."""
    return await _get(
        "/research/repository",
        {
            "key": key,
            "includeEvidence": include_evidence,
            "includeReadme": include_readme,
            "historyLimit": history_limit,
            "historyOffset": history_offset,
        },
    )


@mcp.tool(annotations=READ_ONLY)
async def stars_explore_topics(
    topic: Annotated[str | None, Field(default=None, max_length=200, description="Canonical topic or known alias; omit to browse topics.")] = None,
    limit: Annotated[int, Field(ge=1, le=50)] = 20,
    offset: Annotated[int, Field(ge=0, le=1_000_000)] = 0,
) -> str:
    """Browse saved topics or resolve a topic and its aliases, related topics and repositories."""
    params: dict[str, object] = {"limit": limit, "offset": offset}
    if topic is not None:
        params["topic"] = topic
    return await _get("/research/topics", params)


@mcp.tool(annotations=READ_ONLY)
async def stars_search_discoveries(
    status: Annotated[str | None, Field(default=None, max_length=100)] = None,
    repo_node_id: Annotated[str | None, Field(default=None, max_length=200)] = None,
    source: Annotated[str | None, Field(default=None, max_length=200, description="Exact source/collection identifier.")] = None,
    include_evidence: bool = False,
    limit: Annotated[int, Field(ge=1, le=20)] = 10,
    offset: Annotated[int, Field(ge=0, le=1_000_000)] = 0,
) -> str:
    """Retrieve saved discovery targets, source references and prior research; bodies are opt-in."""
    values = {
        "status": status,
        "repo_node_id": repo_node_id,
        "source": source,
        "includeEvidence": include_evidence,
        "limit": limit,
        "offset": offset,
    }
    return await _get("/research/discoveries", {key: value for key, value in values.items() if value is not None})


if __name__ == "__main__":
    mcp.run(transport="stdio")
