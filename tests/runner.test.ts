import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { createRunner, defineTool, openai } from '../src/index.js';
import {
  UnifaiApiError,
  UnifaiNetworkError,
  UnifaiRateLimitError,
  UnifaiResponseParseError,
} from '../src/errors.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Build a minimal mock Response matching what the runner reads. */
function mockResponse(
  body: unknown,
  opts: {
    status?: number;
    ok?: boolean;
    headers?: Record<string, string>;
  } = {},
) {
  const status = opts.status ?? 200;
  return {
    ok: opts.ok ?? (status >= 200 && status < 300),
    status,
    text: async () =>
      typeof body === 'string' ? body : JSON.stringify(body),
    headers: new Headers(opts.headers),
  } as unknown as Response;
}

/** OpenAI-shaped response with plain text (no tool calls). */
function textResponse(content: string) {
  return mockResponse({
    choices: [{ message: { role: 'assistant', content, tool_calls: null } }],
  });
}

/** OpenAI-shaped response with one tool call. */
function toolCallResponse(
  id: string,
  name: string,
  args: Record<string, unknown>,
) {
  return mockResponse({
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id,
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  });
}

const greetTool = defineTool({
  name: 'greet',
  description: 'Greet someone',
  input: z.object({ name: z.string().describe('Name') }),
  execute: async ({ name }) => `Hello, ${name}!`,
});

const failTool = defineTool({
  name: 'fail',
  description: 'Always fails',
  input: z.object({}),
  execute: async () => {
    throw new Error('intentional failure');
  },
});

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Happy-path tests ─────────────────────────────────────────────────────

describe('createRunner — happy path', () => {
  it('returns text when the LLM responds without tool calls', async () => {
    mockFetch.mockResolvedValueOnce(textResponse('Hi there!'));

    const runner = createRunner({
      provider: openai(),
      model: 'gpt-4o',
      tools: [],
      apiKey: 'sk-test',
    });

    const result = await runner.run('Hello');
    expect(result.content).toBe('Hi there!');
    expect(result.messages).toHaveLength(2); // user + assistant
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('executes a tool call and loops back for the final response', async () => {
    mockFetch
      .mockResolvedValueOnce(
        toolCallResponse('call_1', 'greet', { name: 'World' }),
      )
      .mockResolvedValueOnce(textResponse('Done greeting!'));

    const runner = createRunner({
      provider: openai(),
      model: 'gpt-4o',
      tools: [greetTool],
      apiKey: 'sk-test',
    });

    const result = await runner.run('Say hi to World');
    expect(result.content).toBe('Done greeting!');
    // user, assistant+tool_call, tool_result, assistant
    expect(result.messages).toHaveLength(4);
    expect(result.messages[2].role).toBe('tool');
    expect(result.messages[2].content).toBe('Hello, World!');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('supports RunInput with system prompt', async () => {
    mockFetch.mockResolvedValueOnce(textResponse('I am helpful'));

    const runner = createRunner({
      provider: openai(),
      model: 'gpt-4o',
      tools: [],
      apiKey: 'sk-test',
    });

    await runner.run({
      messages: [{ role: 'user', content: 'Hi' }],
      system: 'You are helpful.',
    });

    // Verify system message was included in the request
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.messages[0]).toEqual({
      role: 'system',
      content: 'You are helpful.',
    });
  });
});

// ─── Edge cases ────────────────────────────────────────────────────────────

describe('createRunner — edge cases', () => {
  it('respects maxIterations and returns last assistant content', async () => {
    // LLM always requests a tool call — should stop after maxIterations
    mockFetch
      .mockResolvedValueOnce(
        toolCallResponse('c1', 'greet', { name: 'A' }),
      )
      .mockResolvedValueOnce(
        toolCallResponse('c2', 'greet', { name: 'B' }),
      )
      .mockResolvedValueOnce(
        toolCallResponse('c3', 'greet', { name: 'C' }),
      );

    const runner = createRunner({
      provider: openai(),
      model: 'gpt-4o',
      tools: [greetTool],
      apiKey: 'sk-test',
      maxIterations: 2,
    });

    const result = await runner.run('Loop forever');
    // Only 2 iterations, so 2 fetch calls
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Last assistant message has empty content (tool-call-only)
    expect(result.content).toBe('');
  });

  it('sends error message for unknown tool names', async () => {
    mockFetch
      .mockResolvedValueOnce(
        toolCallResponse('call_x', 'nonexistent', {}),
      )
      .mockResolvedValueOnce(textResponse('OK'));

    const runner = createRunner({
      provider: openai(),
      model: 'gpt-4o',
      tools: [greetTool],
      apiKey: 'sk-test',
    });

    const result = await runner.run('Call something weird');
    const toolResult = result.messages.find((m) => m.role === 'tool');
    expect(toolResult?.content).toContain('unknown tool');
    expect(toolResult?.content).toContain('nonexistent');
  });

  it('catches tool execution errors and feeds them back', async () => {
    mockFetch
      .mockResolvedValueOnce(toolCallResponse('call_f', 'fail', {}))
      .mockResolvedValueOnce(textResponse('I see the error'));

    const runner = createRunner({
      provider: openai(),
      model: 'gpt-4o',
      tools: [failTool],
      apiKey: 'sk-test',
    });

    const result = await runner.run('Do the failing thing');
    const toolResult = result.messages.find((m) => m.role === 'tool');
    expect(toolResult?.content).toContain('intentional failure');
  });
});

// ─── Error handling ────────────────────────────────────────────────────────

describe('createRunner — error handling', () => {
  it('throws UnifaiRateLimitError on HTTP 429', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ error: 'rate limited' }, {
        status: 429,
        headers: { 'retry-after': '30' },
      }),
    );

    const runner = createRunner({
      provider: openai(),
      model: 'gpt-4o',
      tools: [],
      apiKey: 'sk-test',
    });

    const err = await runner.run('hi').catch((e) => e);
    expect(err).toBeInstanceOf(UnifaiRateLimitError);
    expect(err.status).toBe(429);
    expect(err.retryAfter).toBe(30);
  });

  it('throws UnifaiApiError on HTTP 500', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse('Internal Server Error', { status: 500 }),
    );

    const runner = createRunner({
      provider: openai(),
      model: 'gpt-4o',
      tools: [],
      apiKey: 'sk-test',
    });

    const err = await runner.run('hi').catch((e) => e);
    expect(err).toBeInstanceOf(UnifaiApiError);
    expect(err.status).toBe(500);
  });

  it('throws UnifaiNetworkError when fetch itself fails', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    const runner = createRunner({
      provider: openai(),
      model: 'gpt-4o',
      tools: [],
      apiKey: 'sk-test',
    });

    const err = await runner.run('hi').catch((e) => e);
    expect(err).toBeInstanceOf(UnifaiNetworkError);
    expect(err.cause).toBeInstanceOf(TypeError);
  });

  it('throws UnifaiResponseParseError on malformed JSON body', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse('<html>not json</html>', { status: 200 }),
    );

    const runner = createRunner({
      provider: openai(),
      model: 'gpt-4o',
      tools: [],
      apiKey: 'sk-test',
    });

    const err = await runner.run('hi').catch((e) => e);
    expect(err).toBeInstanceOf(UnifaiResponseParseError);
    expect(err.rawData).toContain('not json');
  });

  it('throws UnifaiResponseParseError when provider cannot parse response', async () => {
    // Valid JSON but not a valid OpenAI response shape
    mockFetch.mockResolvedValueOnce(
      mockResponse({ totally: 'wrong shape' }),
    );

    const runner = createRunner({
      provider: openai(),
      model: 'gpt-4o',
      tools: [],
      apiKey: 'sk-test',
    });

    const err = await runner.run('hi').catch((e) => e);
    expect(err).toBeInstanceOf(UnifaiResponseParseError);
  });
});
