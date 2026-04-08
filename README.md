<p align="center">
  <h1 align="center">unifai-tools</h1>
  <p align="center">
    <strong>Define AI tools once with Zod. Run them on OpenAI, Anthropic, and Gemini.</strong>
  </p>
  <p align="center">
    <a href="https://www.npmjs.com/package/unifai-tools"><img src="https://img.shields.io/npm/v/unifai-tools.svg" alt="npm version"></a>
    <a href="https://www.npmjs.com/package/unifai-tools"><img src="https://img.shields.io/npm/dm/unifai-tools.svg" alt="npm downloads"></a>
    <a href="https://github.com/Faze789/unifai-tools/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/unifai-tools.svg" alt="license"></a>
    <a href="https://github.com/Faze789/unifai-tools"><img src="https://img.shields.io/badge/TypeScript-first-blue.svg" alt="TypeScript"></a>
  </p>
</p>

---

## The Problem

Every LLM provider has its own tool-calling format. OpenAI needs `tools[].function` with `strict: true`. Anthropic needs `tools[].input_schema`. Gemini needs `tools[].functionDeclarations`. You end up writing the same tool three different ways, maintaining three different JSON Schema formats, and building your own agentic loop every single time.

**unifai-tools** fixes this. Define your tools once with [Zod](https://zod.dev), and the library handles schema conversion, request formatting, response parsing, and automatic tool execution across all three providers.

---

## Key Features

- **One definition, three providers** — Write your tool once, swap `openai()` / `anthropic()` / `gemini()` with a single line
- **Type-safe from schema to execution** — Zod schemas flow directly into your `execute` callback with full TypeScript inference
- **Built-in agentic loop** — Automatic tool call execution with configurable `maxIterations`
- **Zero runtime dependencies** — Only `zod` as a peer dependency
- **Hand-rolled Zod-to-JSON-Schema** — Lightweight converter handles 17 Zod types, including OpenAI's strict mode requirements
- **Structured error hierarchy** — Catch rate limits, network failures, and parse errors with dedicated error classes
- **Tiny footprint** — ~19 KB ESM bundle (unminified), dual ESM/CJS output

---

## Why unifai-tools?

| | **unifai-tools** | **Raw Provider SDKs** |
|---|---|---|
| Tool definition | Once, with Zod | Rewrite per provider |
| Schema format | Auto-converted per provider | Hand-roll JSON Schema for each API |
| Agentic loop | Built-in, configurable | Build from scratch every time |
| Runtime deps | `zod` only | SDK + transitive deps per provider |
| Bundle size | ~19 KB | 100 KB+ per SDK |
| TypeScript | Full Zod inference end-to-end | Varies by SDK |

---

## Installation

```bash
npm install unifai-tools zod
```

> **Requires Node.js 18+** (uses native `fetch`).

---

## Quick Start

```typescript
import { z } from 'zod';
import { defineTool, createRunner, openai } from 'unifai-tools';

// 1. Define a tool — fully typed from your Zod schema
const searchTool = defineTool({
  name: 'search',
  description: 'Search the web for information.',
  input: z.object({
    query: z.string().describe('The search query'),
    maxResults: z.number().optional().describe('Maximum results to return'),
  }),
  execute: async ({ query, maxResults }) => {
    // query: string, maxResults: number | undefined — inferred from Zod
    const results = await mySearchAPI(query, maxResults ?? 10);
    return results;
  },
});

// 2. Create a runner — swap providers freely
const runner = createRunner({
  provider: openai(),
  model: 'gpt-4o',
  tools: [searchTool],
  apiKey: process.env.OPENAI_API_KEY!,
});

// 3. Run — tool calls are handled automatically
const { content } = await runner.run('Find the best TypeScript tutorials');
console.log(content);
```

That's it. The runner sends your prompt, detects tool calls in the response, executes them, feeds results back to the LLM, and repeats until it gets a final text answer.

---

## Providers

Swap one line to change providers. Your tool definitions stay identical.

### OpenAI

```typescript
import { openai } from 'unifai-tools';

const runner = createRunner({
  provider: openai(),
  model: 'gpt-4o',  // gpt-4o-mini, o3, etc.
  tools: [searchTool],
  apiKey: process.env.OPENAI_API_KEY!,
});
```

- Enforces `strict: true` with `additionalProperties: false` on all schemas
- Optional Zod fields become nullable + required (OpenAI strict mode requirement)
- System messages are consolidated at the top of the message array

### Anthropic

```typescript
import { anthropic } from 'unifai-tools';

const runner = createRunner({
  provider: anthropic(),
  model: 'claude-sonnet-4-20250514',
  tools: [searchTool],
  apiKey: process.env.ANTHROPIC_API_KEY!,
});
```

- Uses `input_schema` format with standard JSON Schema
- System prompt sent via the top-level `system` field
- Tool results batched into single `user` messages (Anthropic requires alternating roles)

### Gemini

```typescript
import { gemini } from 'unifai-tools';

const runner = createRunner({
  provider: gemini(),
  model: 'gemini-2.0-flash',
  tools: [searchTool],
  apiKey: process.env.GEMINI_API_KEY!,
});
```

- Uses `functionDeclarations` format
- Auth via `?key=` query parameter
- System prompt sent via `systemInstruction`

---

## The Agentic Loop

When the LLM responds with tool calls, the runner automatically:

1. Parses the tool call arguments
2. Validates them against your Zod schema
3. Executes your `execute` function
4. Sends results back to the LLM
5. Repeats until the LLM responds with plain text (or `maxIterations` is hit)

```typescript
const runner = createRunner({
  provider: openai(),
  model: 'gpt-4o',
  tools: [searchTool, calculatorTool, weatherTool],
  apiKey: process.env.OPENAI_API_KEY!,
  maxIterations: 5,  // safety limit, default: 10
});

// String shorthand
const result = await runner.run('What is the weather in Paris?');

// Or with a system prompt
const result = await runner.run({
  messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
  system: 'You are a helpful travel assistant.',
});
```

If a tool throws during execution, the error message is sent back to the LLM as the tool result — giving the model a chance to self-correct or inform the user gracefully.

---

## Error Handling

unifai-tools throws structured, catchable errors:

```typescript
import {
  UnifaiError,              // Base — catch-all for any unifai error
  UnifaiApiError,           // HTTP 4xx/5xx from the provider API
  UnifaiRateLimitError,     // HTTP 429 with optional retryAfter
  UnifaiNetworkError,       // DNS, connection, timeout failures
  UnifaiResponseParseError, // Malformed JSON or unexpected response shape
} from 'unifai-tools';

try {
  await runner.run('Hello');
} catch (err) {
  if (err instanceof UnifaiRateLimitError) {
    console.log(`Rate limited. Retry after ${err.retryAfter}s`);
  } else if (err instanceof UnifaiApiError) {
    console.log(`API error ${err.status}: ${err.body}`);
  } else if (err instanceof UnifaiNetworkError) {
    console.log(`Network failure: ${err.message}`);
  }
}
```

Inheritance: `UnifaiRateLimitError` → `UnifaiApiError` → `UnifaiError` → `Error`

---

## Production Use Cases

### Multi-tool agent

```typescript
const agent = createRunner({
  provider: anthropic(),
  model: 'claude-sonnet-4-20250514',
  tools: [searchTool, databaseTool, emailTool],
  apiKey: process.env.ANTHROPIC_API_KEY!,
  maxIterations: 10,
});

const result = await agent.run({
  messages: [{ role: 'user', content: 'Find overdue invoices and email reminders' }],
  system: 'You are a billing assistant. Use the tools available to complete tasks.',
});
```

### Provider failover

```typescript
async function runWithFailover(prompt: string) {
  const providers = [
    { factory: openai(), model: 'gpt-4o', key: process.env.OPENAI_API_KEY! },
    { factory: anthropic(), model: 'claude-sonnet-4-20250514', key: process.env.ANTHROPIC_API_KEY! },
  ];

  for (const { factory, model, key } of providers) {
    try {
      const runner = createRunner({ provider: factory, model, tools, apiKey: key });
      return await runner.run(prompt);
    } catch (err) {
      if (err instanceof UnifaiRateLimitError) continue;
      throw err;
    }
  }
  throw new Error('All providers exhausted');
}
```

### Direct schema conversion

```typescript
import { zodToJsonSchema } from 'unifai-tools';

// Use the converter standalone for custom integrations
const schema = zodToJsonSchema(
  z.object({ query: z.string(), limit: z.number().optional() }),
  { strict: true } // OpenAI mode
);
```

---

## Supported Zod Types

| Zod Type | JSON Schema Output |
|---|---|
| `z.string()` | `{ type: "string" }` |
| `z.number()` | `{ type: "number" }` |
| `z.boolean()` | `{ type: "boolean" }` |
| `z.object({})` | `{ type: "object", properties, required }` |
| `z.array()` | `{ type: "array", items }` |
| `z.enum()` | `{ type: "string", enum: [...] }` |
| `z.nativeEnum()` | `{ enum: [...] }` with type inference |
| `z.record()` | `{ type: "object", additionalProperties }` |
| `z.tuple()` | `{ type: "array", prefixItems, minItems, maxItems }` |
| `z.union()` | `{ anyOf: [...] }` |
| `z.discriminatedUnion()` | `{ anyOf: [...] }` |
| `z.intersection()` | `{ allOf: [...] }` |
| `z.literal()` | `{ const: value }` |
| `z.nullable()` | `type: ["T", "null"]` or `anyOf` with null |
| `z.optional()` | Excluded from `required` (nullable in strict mode) |
| `z.default()` | Same as optional |
| `.refine() / .transform()` | Unwrapped to inner schema |

All types support `.describe()` — descriptions are carried through to JSON Schema.

---

## API Reference

### `defineTool(config)`

```typescript
const tool = defineTool({
  name: string;
  description: string;
  input: z.ZodObject<any>;
  execute: (input: z.infer<typeof input>) => Promise<T>;
});
```

### `createRunner(options)`

```typescript
const runner = createRunner({
  provider: Provider;       // openai(), anthropic(), or gemini()
  model: string;
  tools: Tool[];
  apiKey: string;
  maxIterations?: number;   // default: 10
});

const result = await runner.run(prompt);
// result.content  — final assistant text
// result.messages — full conversation history
```

### `zodToJsonSchema(schema, options?)`

```typescript
const jsonSchema = zodToJsonSchema(zodSchema, { strict: true });
```

---

## Security Considerations

- API keys are passed at runner creation and sent only to the configured provider endpoint
- Gemini API keys are sent as a URL query parameter (`?key=...`) per Google's API design
- Tool execution is sandboxed to your `execute` functions — unifai-tools never runs arbitrary code
- Always validate and sanitize data returned from tools before acting on it in production

---

## Contributing

Contributions are welcome! Here's how to get started:

```bash
git clone https://github.com/Faze789/unifai-tools.git
cd unifai-tools
npm install
npm run test        # Run tests
npm run typecheck   # Type-check
npm run lint        # Lint
npm run build       # Build ESM + CJS
```

Please open an issue before submitting large PRs so we can discuss the approach.

---

## License

[MIT](./LICENSE)
