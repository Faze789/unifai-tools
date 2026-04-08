import type { z } from 'zod';

/** A single tool call requested by the LLM. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Unified message format used internally by the runner. */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Tool-result messages: the ID of the tool call this result corresponds to. */
  toolCallId?: string;
  /** Tool-result messages: the name of the tool (needed by Gemini). */
  toolName?: string;
  /** Assistant messages: tool calls the LLM wants to execute. */
  toolCalls?: ToolCall[];
}

/**
 * A strongly-typed tool definition.
 * `TInput` is a Zod schema whose inferred type flows into `execute`.
 */
export interface Tool<
  TInput extends z.ZodType = z.ZodType,
  TOutput = unknown,
> {
  name: string;
  description: string;
  input: TInput;
  execute: (input: z.infer<TInput>) => Promise<TOutput>;
}

/** Provider adapter — converts between unifai's internal format and a specific LLM API. */
export interface Provider {
  buildRequest(config: {
    model: string;
    messages: Message[];
    tools: Tool[];
    apiKey: string;
    system?: string;
  }): {
    url: string;
    headers: Record<string, string>;
    body: unknown;
  };

  parseResponse(data: unknown): Message;
}

/** Configuration for `createRunner`. */
export interface RunnerOptions {
  provider: Provider;
  model: string;
  tools: Tool[];
  apiKey: string;
  /** Maximum agentic loop iterations (default: 10). */
  maxIterations?: number;
}

/** Input accepted by `runner.run()`. */
export interface RunInput {
  messages: Message[];
  system?: string;
}

/** Value returned by `runner.run()`. */
export interface RunResult {
  /** The final text content from the assistant. */
  content: string;
  /** Full conversation history including tool calls and results. */
  messages: Message[];
}
