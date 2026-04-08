import { z } from 'zod';
import { defineTool, createRunner, openai, anthropic, gemini } from '../src/index.js';

// ── Define a tool once ─────────────────────────────────────────────────────
const searchTool = defineTool({
  name: 'search',
  description: 'Search the web for information on a given topic.',
  input: z.object({
    query: z.string().describe('The search query'),
    maxResults: z
      .number()
      .optional()
      .describe('Maximum number of results to return'),
  }),
  execute: async ({ query, maxResults }) => {
    // ↑ `query` is typed as string, `maxResults` as number | undefined
    console.log(`[search] query="${query}" maxResults=${maxResults ?? 10}`);
    return {
      results: [
        { title: `Result 1 for: ${query}`, url: 'https://example.com/1' },
        { title: `Result 2 for: ${query}`, url: 'https://example.com/2' },
      ],
      total: maxResults ?? 10,
    };
  },
});

// ── Pick a provider ────────────────────────────────────────────────────────
// Swap openai() → anthropic() → gemini() — the tool definition stays the same.

async function runWithOpenAI() {
  const runner = createRunner({
    provider: openai(),
    model: 'gpt-4o',
    tools: [searchTool],
    apiKey: process.env.OPENAI_API_KEY!,
    maxIterations: 5,
  });

  const result = await runner.run('Find me the best TypeScript tutorials.');
  console.log('\n=== OpenAI ===');
  console.log('Response:', result.content);
  console.log('Total messages:', result.messages.length);
}

async function runWithAnthropic() {
  const runner = createRunner({
    provider: anthropic(),
    model: 'claude-sonnet-4-20250514',
    tools: [searchTool],
    apiKey: process.env.ANTHROPIC_API_KEY!,
    maxIterations: 5,
  });

  const result = await runner.run('Find me the best TypeScript tutorials.');
  console.log('\n=== Anthropic ===');
  console.log('Response:', result.content);
  console.log('Total messages:', result.messages.length);
}

async function runWithGemini() {
  const runner = createRunner({
    provider: gemini(),
    model: 'gemini-2.0-flash',
    tools: [searchTool],
    apiKey: process.env.GEMINI_API_KEY!,
    maxIterations: 5,
  });

  const result = await runner.run('Find me the best TypeScript tutorials.');
  console.log('\n=== Gemini ===');
  console.log('Response:', result.content);
  console.log('Total messages:', result.messages.length);
}

// Run one of them (set the appropriate env var)
const provider = process.argv[2] ?? 'openai';
switch (provider) {
  case 'openai':
    runWithOpenAI().catch(console.error);
    break;
  case 'anthropic':
    runWithAnthropic().catch(console.error);
    break;
  case 'gemini':
    runWithGemini().catch(console.error);
    break;
  default:
    console.error(`Unknown provider: ${provider}. Use openai | anthropic | gemini`);
}
