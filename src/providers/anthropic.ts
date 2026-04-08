import { zodToJsonSchema } from '../schema-builder.js';
import type { Provider, ToolCall } from '../types.js';

/**
 * Anthropic Messages adapter.
 *
 * - System prompt goes in the top-level `system` field (not as a message).
 * - Consecutive tool-result messages are batched into a single `user` message
 *   with `tool_result` content blocks (Anthropic requires alternating roles).
 * - No `strict` flag — Anthropic relies on descriptions for guidance.
 */
export function anthropic(): Provider {
  return {
    buildRequest({ model, messages, tools, apiKey, system }) {
      const formatted: unknown[] = [];

      // Collect system text
      const systemParts: string[] = [];
      if (system) systemParts.push(system);

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        if (msg.role === 'system') {
          systemParts.push(msg.content);
          continue;
        }

        if (msg.role === 'user') {
          formatted.push({ role: 'user', content: msg.content });
          continue;
        }

        if (msg.role === 'assistant') {
          if (msg.toolCalls?.length) {
            const content: unknown[] = [];
            if (msg.content) {
              content.push({ type: 'text', text: msg.content });
            }
            for (const tc of msg.toolCalls) {
              content.push({
                type: 'tool_use',
                id: tc.id,
                name: tc.name,
                input: tc.arguments,
              });
            }
            formatted.push({ role: 'assistant', content });
          } else {
            formatted.push({ role: 'assistant', content: msg.content });
          }
          continue;
        }

        if (msg.role === 'tool') {
          // Batch consecutive tool results into one user message
          const results: unknown[] = [];
          while (i < messages.length && messages[i].role === 'tool') {
            results.push({
              type: 'tool_result',
              tool_use_id: messages[i].toolCallId,
              content: messages[i].content,
            });
            i++;
          }
          i--; // compensate for outer loop increment
          formatted.push({ role: 'user', content: results });
        }
      }

      const body: Record<string, unknown> = {
        model,
        messages: formatted,
        max_tokens: 4096,
      };

      if (systemParts.length > 0) {
        body.system = systemParts.join('\n\n');
      }
      if (tools.length > 0) {
        body.tools = tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: zodToJsonSchema(t.input),
        }));
      }

      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body,
      };
    },

    parseResponse(data) {
      const d = data as any;
      const blocks: any[] = d.content ?? [];

      let text = '';
      const toolCalls: ToolCall[] = [];

      for (const block of blocks) {
        if (block.type === 'text') {
          text += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input,
          });
        }
      }

      return {
        role: 'assistant' as const,
        content: text,
        ...(toolCalls.length > 0 && { toolCalls }),
      };
    },
  };
}
