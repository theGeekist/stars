"""Typed Stars MCP adapter for the local research API and operation runner.

The existing Fedora Rust Gateway owns Streamable HTTP. This stdio process
publishes fixed research and Stars operation tools; it accepts no raw SQL,
shell, filesystem path, GitHub token, or model endpoint from MCP callers.
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
    "Geekist Stars",
    instructions=(
        "Use Stars research tools to retrieve saved catalogue intelligence, summaries, metadata, "
        "topics, score history, discovery relationships and evidence. Use operation tools to fetch "
        "current GitHub list/star data, ingest it, summarise repositories, score them, or enrich topics. "
        "Fetch tools read GitHub without changing Stars. Ingest and topic enrichment write the local "
        "catalogue. Summary and score tools default to dry-run; set dry_run=false to persist results. "
        "Applying scores can also change GitHub List membership under the configured curation policy. "
        "Long operations return an id; poll stars_operation_status. Mutating jobs queue for the existing "
        "Stars run lock for up to 24 hours instead of failing when a scheduled job or S00 owns it. "
        "Cancel a queued job to remove it without side effects. Cancelling after a worker starts can leave "
        "already-applied local or external changes in place. Tool results are bounded and report truncation."
    ),
)

READ_ONLY = ToolAnnotations(
    readOnlyHint=True,
    destructiveHint=False,
    idempotentHint=True,
    openWorldHint=False,
)
REMOTE_READ = ToolAnnotations(
    readOnlyHint=True,
    destructiveHint=False,
    idempotentHint=True,
    openWorldHint=True,
)
LOCAL_WRITE = ToolAnnotations(
    readOnlyHint=False,
    destructiveHint=False,
    idempotentHint=False,
    openWorldHint=True,
)
MODEL_WRITE = ToolAnnotations(
    readOnlyHint=False,
    destructiveHint=False,
    idempotentHint=False,
    openWorldHint=True,
)
CONFIG_WRITE = ToolAnnotations(
    readOnlyHint=False,
    destructiveHint=True,
    idempotentHint=False,
    openWorldHint=False,
)
GITHUB_WRITE = ToolAnnotations(
    readOnlyHint=False,
    destructiveHint=True,
    idempotentHint=False,
    openWorldHint=True,
)
JOB_CONTROL = ToolAnnotations(
    readOnlyHint=False,
    destructiveHint=True,
    idempotentHint=False,
    openWorldHint=False,
)


def _compact(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


async def _request(method: str, path: str, *, params: dict[str, object] | None = None,
                   body: dict[str, object] | None = None) -> str:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, trust_env=False) as client:
            response = await client.request(method, f"{API_BASE}{path}", params=params, json=body)
        try:
            payload = response.json()
        except ValueError:
            payload = {"error": f"Stars API returned HTTP {response.status_code}"}
        if response.status_code >= 400:
            return _compact(payload)
        encoded = _compact(payload).encode("utf-8")
        if len(encoded) > MAX_RESPONSE_BYTES:
            return _compact({
                "error": "response_too_large",
                "message": "Narrow the query or request a smaller page; no evidence was discarded silently.",
                "responseBytes": len(encoded),
                "maximumBytes": MAX_RESPONSE_BYTES,
            })
        return encoded.decode("utf-8")
    except httpx.TimeoutException:
        return _compact({"error": "stars_api_timeout", "message": "The local Stars API did not respond within eight seconds."})
    except httpx.RequestError as error:
        return _compact({"error": "stars_api_unavailable", "message": type(error).__name__})


async def _get(path: str, params: dict[str, object] | None = None) -> str:
    return await _request("GET", path, params=params)


async def _start(operation: str, args: dict[str, object] | None = None) -> str:
    return await _request("POST", "/operations", params={"name": operation}, body=args or {})


@mcp.tool(annotations=READ_ONLY)
async def stars_overview() -> str:
    """Show catalogue size, list coverage, summaries, README and topic coverage, score freshness, and discovery availability. Counts describe saved Stars data and do not imply that missing research was attempted."""
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
    """Search saved repositories by text, curated list, topic, language, stars, saved score, archive/fork state, and research coverage. Results come only from the local catalogue; use the fetch or ingestion tools to refresh GitHub data."""
    values = {
        "q": q, "list": list, "topic": topic, "language": language,
        "minStars": min_stars, "minScore": min_score, "hasSummary": has_summary,
        "hasReadme": has_readme, "archived": archived, "fork": fork,
        "sort": sort, "limit": limit, "offset": offset,
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
    """Read one saved repository profile, including metadata, summary, topics, list membership, score history, discovery links and provenance. README and source evidence bodies are opt-in and bounded."""
    return await _get("/research/repository", {
        "key": key, "includeEvidence": include_evidence, "includeReadme": include_readme,
        "historyLimit": history_limit, "historyOffset": history_offset,
    })


@mcp.tool(annotations=READ_ONLY)
async def stars_explore_topics(
    topic: Annotated[str | None, Field(default=None, max_length=200, description="Canonical topic or known alias; omit to browse topics.")] = None,
    limit: Annotated[int, Field(ge=1, le=50)] = 20,
    offset: Annotated[int, Field(ge=0, le=1_000_000)] = 0,
) -> str:
    """Browse saved topic metadata or resolve a topic and its aliases, related topics, and repositories. This reports recorded relationships and does not infer missing links."""
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
    """Retrieve saved discovery targets, source references and previous research. Evidence bodies are opt-in; empty results mean no matching retained record was found."""
    values = {"status": status, "repo_node_id": repo_node_id, "source": source,
              "includeEvidence": include_evidence, "limit": limit, "offset": offset}
    return await _get("/research/discoveries", {key: value for key, value in values.items() if value is not None})


@mcp.tool(annotations=REMOTE_READ)
async def stars_fetch_lists() -> str:
    """Fetch the authenticated GitHub account's current list names and metadata without changing the local Stars catalogue or GitHub. Requires the host's configured GitHub CLI identity."""
    return await _start("stars:lists")


@mcp.tool(annotations=REMOTE_READ)
async def stars_fetch_list_repositories(
    list_name: Annotated[str, Field(min_length=1, max_length=200, description="Exact GitHub List name.")],
) -> str:
    """Fetch repositories currently assigned to one exact GitHub List. This reads GitHub and does not ingest or alter either system."""
    return await _start("stars:listRepos", {"listName": list_name})


@mcp.tool(annotations=REMOTE_READ)
async def stars_fetch_starred_repositories() -> str:
    """Fetch all starred repositories for the configured GitHub account. This is a remote read only; use a separate ingest tool to write fetched data into Stars."""
    return await _start("stars:stars")


@mcp.tool(annotations=READ_ONLY)
async def stars_get_unlisted_repositories() -> str:
    """List locally ingested starred repositories that are not members of any saved GitHub List. Reads the catalogue and does not fetch GitHub."""
    return await _start("stars:unlisted")


@mcp.tool(annotations=LOCAL_WRITE)
async def stars_ingest_all() -> str:
    """Fetch list-backed and unlisted repository data from GitHub and ingest it into the local Stars SQLite catalogue. This writes repository metadata and list memberships; it does not delete stale rows. Long-running work uses the shared Stars lock. Inspect active jobs before starting another ingest."""
    return await _start("ingest:all")


@mcp.tool(annotations=LOCAL_WRITE)
async def stars_ingest_list_repositories() -> str:
    """Fetch repositories from the configured GitHub Lists and write their metadata and memberships to the local Stars catalogue. It does not ingest unlisted stars or delete stale rows; the shared Stars lock prevents overlap with the active pipeline."""
    return await _start("ingest:lists")


@mcp.tool(annotations=LOCAL_WRITE)
async def stars_ingest_unlisted_repositories() -> str:
    """Fetch starred repositories outside configured GitHub Lists and ingest them into the local catalogue. This writes local repository data, does not change GitHub Lists, and uses the shared Stars lock."""
    return await _start("ingest:unlisted")


@mcp.tool(annotations=MODEL_WRITE)
async def stars_summarise_repositories(
    limit: Annotated[int, Field(ge=1, le=100, description="Maximum repositories to process.")] = 50,
    dry_run: bool = True,
    resummarise: bool = False,
) -> str:
    """Generate summaries for up to limit saved repositories using the host's configured model. dry_run=true (default) returns generated summaries without saving; dry_run=false persists them. resummarise=true includes repositories that already have summaries. Model/provider use follows the host configuration."""
    return await _start("summaries:all", {"limit": limit, "dryRun": dry_run, "resummarise": resummarise})


@mcp.tool(annotations=MODEL_WRITE)
async def stars_summarise_repository(
    selector: Annotated[str, Field(min_length=1, max_length=200, description="Exact owner/repository name already in the catalogue.")],
    dry_run: bool = True,
) -> str:
    """Generate a summary for one saved repository with the host's configured model. dry_run=true (default) returns it without persistence; dry_run=false saves it to the local catalogue."""
    return await _start("summaries:one", {"selector": selector, "dryRun": dry_run})


@mcp.tool(annotations=MODEL_WRITE)
async def stars_score_repositories(
    limit: Annotated[int, Field(ge=1, le=100, description="Maximum repositories to score.")] = 50,
    dry_run: bool = True,
) -> str:
    """Score up to limit eligible saved repositories against configured list criteria using the host's model. dry_run=true (default) plans results without persistence or GitHub changes. dry_run=false saves scores and may apply list-membership changes under the configured curation policy; that mode uses the shared Stars lock."""
    return await _start("ranking:all", {"limit": limit, "dryRun": dry_run})


@mcp.tool(annotations=MODEL_WRITE)
async def stars_score_repository(
    selector: Annotated[str, Field(min_length=1, max_length=200, description="Exact owner/repository name already in the catalogue.")],
    dry_run: bool = True,
) -> str:
    """Score one saved repository against configured list criteria using the host's model. dry_run=true (default) only plans; dry_run=false persists scores and may change GitHub List membership under the curation policy."""
    return await _start("ranking:one", {"selector": selector, "dryRun": dry_run})


@mcp.tool(annotations=LOCAL_WRITE)
async def stars_enrich_topics() -> str:
    """Refresh repository topics, topic metadata, aliases, and related-topic records from GitHub into the local catalogue. This makes remote reads and local database writes, does not create research discoveries, and respects the shared Stars lock."""
    return await _start("topics:enrich")


@mcp.tool(annotations=READ_ONLY)
async def stars_get_prompts() -> str:
    """Read the current fixed Stars summarisation and scoring prompt configuration. This returns prompt content only; it does not expose credentials or arbitrary files."""
    return await _start("setup:prompts")


@mcp.tool(annotations=READ_ONLY)
async def stars_get_prompt_state() -> str:
    """Check whether the installed Stars prompt files are present and current relative to their built-in templates."""
    return await _start("setup:promptsState")


@mcp.tool(annotations=LOCAL_WRITE)
async def stars_update_prompts(force_placeholder: bool = False) -> str:
    """Generate or refresh the fixed Stars prompt files from the repository template, using the host's authenticated GitHub CLI identity when needed. This writes local configuration; force_placeholder controls whether placeholder prompts may be written when remote setup is unavailable."""
    return await _start("setup:updatePrompts", {"forcePlaceholder": force_placeholder})


@mcp.tool(annotations=READ_ONLY)
async def stars_get_model_config() -> str:
    """Read the configured model name and endpoint used by Stars setup. The response omits API keys and does not include process environment values."""
    return await _start("setup:modelConfig")


@mcp.tool(annotations=CONFIG_WRITE)
async def stars_set_model_config(
    model: Annotated[str | None, Field(default=None, max_length=200, description="Model identifier; omit to clear the saved model field.")] = None,
    host: Annotated[str | None, Field(default=None, max_length=500, description="Absolute HTTP(S) model endpoint without embedded credentials; omit to clear the saved host field.")] = None,
    clear: bool = False,
) -> str:
    """Replace the saved Stars model configuration with a model and/or endpoint; omitted fields are cleared. Use clear=true explicitly to remove the whole configuration. The endpoint must be HTTP or HTTPS without embedded username/password credentials. This does not accept or reveal API keys."""
    values = {key: value for key, value in {"model": model, "host": host, "clear": clear}.items() if value is not None}
    return await _start("setup:writeModelConfig", values)


@mcp.tool(annotations=REMOTE_READ)
async def stars_test_model_connectivity() -> str:
    """Probe readiness of the currently configured model service. This sends a connectivity request to the configured endpoint without changing the Stars catalogue or model configuration."""
    return await _start("setup:testModelConnectivity")


@mcp.tool(annotations=READ_ONLY)
async def stars_operation_status(
    operation_id: Annotated[int | None, Field(default=None, ge=1, description="Job id returned when an operation starts; omit to list retained jobs.")] = None,
) -> str:
    """Inspect a queued, running, or completed Stars operation. Supply an id returned by an operation tool to retrieve its state and bounded result; omit it to list jobs held by this API process."""
    if operation_id is None:
        return await _get("/operations/jobs")
    return await _get(f"/operations/jobs/{operation_id}")


@mcp.tool(annotations=JOB_CONTROL)
async def stars_cancel_operation(
    operation_id: Annotated[int, Field(ge=1, description="Job id returned when an operation starts.")],
) -> str:
    """Cancel a Stars operation. A job still queued on the shared run lock is removed before it starts; a running worker is terminated abruptly, so local writes and GitHub changes already completed remain. Check status first."""
    return await _request("POST", f"/operations/jobs/{operation_id}/cancel", body={})


if __name__ == "__main__":
    mcp.run(transport="stdio")
