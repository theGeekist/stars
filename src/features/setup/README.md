# Setup Feature

Generates `prompts.yaml` criteria from your GitHub Lists and validates Ollama readiness.

## Public API

- `generatePromptsYaml(token: string, outFile?: string, opts?: { forcePlaceholder?: boolean }, deps?)` – writes/updates the `scoring.criteria` block in `prompts.yaml`. Accepts DI for tests (`deps.lists`, `deps.llm`). When `forcePlaceholder` is true, skips network and writes example placeholders.
- `testOllamaReady(): Promise<{ ok: boolean, reason?: string }>` – verifies that the configured model can be reached.

## Usage (programmatic)

```ts
import { generatePromptsYaml, testOllamaReady } from "@features/setup";

const ready = await testOllamaReady();
if (!ready.ok) console.warn("Ollama not ready:", ready.reason);
await generatePromptsYaml(process.env.GITHUB_TOKEN ?? "");
```

## CLI

- `gk-stars setup` – generates `prompts.yaml`. Uses Ollama when available, otherwise writes placeholders and prints examples.

Environment:

- `GITHUB_TOKEN` – required
- `OLLAMA_MODEL` – recommended for automatic criteria generation

