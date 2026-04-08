import { zodToJsonSchema } from '../schema-builder.js';
import type { Provider, ToolCall } from '../types.js';

/**
 * OpenAI Chat Completions adapter.
 *
 * - Tools use `strict: true` with `additionalProperties: false`.
 * - Tool call arguments arrive as a JSON **string** and are parsed here.
 * - Tool results are individual messages with `role: "tool"`.
 * - System messages are consolidated at the top of the message array.
 */
export function openai(): Provider {
  return {
    buildRequest({ model, messages, tools, apiKey, system }) {
      const formatted: unknown[] = [];

      // ── System messages first (OpenAI requires them at the top) ───────
      const systemParts: string[] = [];
      if (system) systemParts.push(system);
      for (const msg of messages) {
        if (msg.role === 'system') systemParts.push(msg.content);
      }
      if (systemParts.length > 0) {
        formatted.push({ role: 'system', content: systemParts.join('\n\n') });
      }

      // ── Non-system messages in order ──────────────────────────────────
      for (const msg of messages) {
        if (msg.role === 'system') continue;

        switch (msg.role) {
          case 'user':
            formatted.push({ role: 'user', content: msg.content });
            break;

          case 'assistant':
            if (msg.toolCalls?.length) {
              formatted.push({
                role: 'assistant',
                content: msg.content || null,
                tool_calls: msg.toolCalls.map((tc) => ({
                  id: tc.id,
                  type: 'function' as const,
                  function: {
                    name: tc.name,
                    arguments: JSON.stringify(tc.arguments),
                  },
                })),
              });
            } else {
              formatted.push({ role: 'assistant', content: msg.content });
            }
            break;

          case 'tool':
            formatted.push({
              role: 'tool',
              tool_call_id: msg.toolCallId,
              content: msg.content,
            });
            break;
        }
      }

      const body: Record<string, unknown> = {
        model,
        messages: formatted,
      };

      if (tools.length > 0) {
        body.tools = tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: zodToJsonSchema(t.input, { strict: true }),
            strict: true,
          },
        }));
      }

      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body,
      };
    },

    parseResponse(data) {
      const d = data as any;
      const choice = d.choices?.[0]?.message;
      if (!choice) throw new Error('Invalid OpenAI response: no choices');

      const toolCalls: ToolCall[] = (choice.tool_calls ?? []).map(
        (tc: any) => {
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            // Malformed arguments — pass empty; Zod validation will catch it
            args = {};
          }
          return {
            id: tc.id,
            name: tc.function.name,
            arguments: args,
          };
        },
      );

      return {
        role: 'assistant',
        content: choice.content ?? '',
        ...(toolCalls.length > 0 && { toolCalls }),
      };
    },
  };
}
