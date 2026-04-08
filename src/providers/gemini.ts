import { zodToJsonSchema } from '../schema-builder.js';
import type { Provider, ToolCall } from '../types.js';

/**
 * Gemini (generativelanguage.googleapis.com) adapter.
 *
 * - Auth via `?key=` query parameter.
 * - System prompt uses the `systemInstruction` field.
 * - Tool results use `role: "function"` with `functionResponse` parts.
 * - Consecutive tool-result messages are batched into a single function content.
 * - Gemini does not provide tool-call IDs; synthetic IDs are generated on parse.
 */
export function gemini(): Provider {
  return {
    buildRequest({ model, messages, tools, apiKey, system }) {
      const contents: unknown[] = [];

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
          contents.push({
            role: 'user',
            parts: [{ text: msg.content }],
          });
          continue;
        }

        if (msg.role === 'assistant') {
          const parts: unknown[] = [];
          if (msg.content) parts.push({ text: msg.content });
          if (msg.toolCalls?.length) {
            for (const tc of msg.toolCalls) {
              parts.push({
                functionCall: { name: tc.name, args: tc.arguments },
              });
            }
          }
          if (parts.length > 0) {
            contents.push({ role: 'model', parts });
          }
          continue;
        }

        if (msg.role === 'tool') {
          // Batch consecutive tool results into one function content
          const parts: unknown[] = [];
          while (i < messages.length && messages[i].role === 'tool') {
            let responseData: unknown;
            try {
              responseData = JSON.parse(messages[i].content);
            } catch {
              responseData = { result: messages[i].content };
            }
            parts.push({
              functionResponse: {
                name: messages[i].toolName ?? '',
                response: responseData,
              },
            });
            i++;
          }
          i--; // compensate for outer loop increment
          contents.push({ role: 'function', parts });
        }
      }

      const body: Record<string, unknown> = { contents };

      if (tools.length > 0) {
        body.tools = [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: zodToJsonSchema(t.input),
            })),
          },
        ];
      }

      if (systemParts.length > 0) {
        body.systemInstruction = {
          parts: [{ text: systemParts.join('\n\n') }],
        };
      }

      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        headers: { 'Content-Type': 'application/json' },
        body,
      };
    },

    parseResponse(data) {
      const d = data as any;
      const parts: any[] = d.candidates?.[0]?.content?.parts ?? [];

      let text = '';
      const toolCalls: ToolCall[] = [];

      for (const part of parts) {
        if (part.text) text += part.text;
        if (part.functionCall) {
          toolCalls.push({
            id: `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            name: part.functionCall.name,
            arguments: part.functionCall.args ?? {},
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
