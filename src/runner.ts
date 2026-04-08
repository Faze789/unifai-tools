import {
  UnifaiApiError,
  UnifaiNetworkError,
  UnifaiRateLimitError,
  UnifaiResponseParseError,
} from './errors.js';
import type { Message, RunInput, RunResult, RunnerOptions, Tool } from './types.js';

/**
 * Create an agentic runner that sends messages to an LLM, auto-executes any
 * tool calls, feeds results back, and repeats until the model returns plain
 * text or `maxIterations` is reached.
 */
export function createRunner(options: RunnerOptions) {
  const { provider, model, tools, apiKey, maxIterations = 10 } = options;

  const toolMap = new Map<string, Tool>();
  for (const tool of tools) {
    toolMap.set(tool.name, tool);
  }

  async function run(input: string | RunInput): Promise<RunResult> {
    const { messages: initial, system } =
      typeof input === 'string'
        ? { messages: [{ role: 'user' as const, content: input }], system: undefined }
        : input;

    const messages: Message[] = [...initial];

    for (let iter = 0; iter < maxIterations; iter++) {
      const { url, headers, body } = provider.buildRequest({
        model,
        messages,
        tools,
        apiKey,
        system,
      });

      const cleanUrl = url.split('?')[0];

      // ── 1. Fetch with network error handling ──────────────────────────
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
      } catch (err) {
        throw new UnifaiNetworkError(
          `Network error calling ${cleanUrl}`,
          err instanceof Error ? err : undefined,
        );
      }

      // ── 2. Handle HTTP errors ─────────────────────────────────────────
      if (!res.ok) {
        const errorBody = await res.text().catch(() => '(unreadable response body)');
        if (res.status === 429) {
          const raw = res.headers.get('retry-after');
          const retryAfter =
            raw != null && isFinite(Number(raw)) ? Number(raw) : undefined;
          throw new UnifaiRateLimitError(res.status, errorBody, cleanUrl, retryAfter);
        }
        throw new UnifaiApiError(res.status, errorBody, cleanUrl);
      }

      // ── 3. Parse response body ────────────────────────────────────────
      let responseText: string;
      try {
        responseText = await res.text();
      } catch (err) {
        throw new UnifaiNetworkError(
          `Failed to read response body from ${cleanUrl}`,
          err instanceof Error ? err : undefined,
        );
      }

      let data: unknown;
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new UnifaiResponseParseError(
          `Invalid JSON in response from ${cleanUrl}`,
          responseText,
        );
      }

      // ── 4. Parse provider-specific response ───────────────────────────
      let assistant: Message;
      try {
        assistant = provider.parseResponse(data);
      } catch (err) {
        throw new UnifaiResponseParseError(
          `Failed to parse response from ${cleanUrl}: ${err instanceof Error ? err.message : String(err)}`,
          data,
        );
      }

      messages.push(assistant);

      // No tool calls → we're done
      if (!assistant.toolCalls?.length) {
        return { content: assistant.content, messages };
      }

      // ── 5. Execute tool calls ─────────────────────────────────────────
      for (const tc of assistant.toolCalls) {
        const tool = toolMap.get(tc.name);
        let resultContent: string;

        if (!tool) {
          resultContent = `Error: unknown tool "${tc.name}"`;
        } else {
          try {
            const parsed = tool.input.parse(tc.arguments);
            const result = await tool.execute(parsed);
            resultContent =
              typeof result === 'string' ? result : JSON.stringify(result);
          } catch (err) {
            resultContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }
        }

        messages.push({
          role: 'tool',
          content: resultContent,
          toolCallId: tc.id,
          toolName: tc.name,
        });
      }
    }

    // Max iterations exhausted — return the last assistant content we have
    let lastAssistant: Message | undefined;
    for (let j = messages.length - 1; j >= 0; j--) {
      if (messages[j].role === 'assistant') {
        lastAssistant = messages[j];
        break;
      }
    }
    return {
      content: lastAssistant?.content ?? '',
      messages,
    };
  }

  return { run };
}
