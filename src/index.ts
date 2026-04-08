import type { z } from 'zod';
import type { Tool } from './types.js';

/**
 * Define a strongly-typed tool whose `execute` callback receives the exact
 * TypeScript type inferred from the Zod `input` schema.
 */
export function defineTool<
  TInput extends z.ZodObject<any>,
  TOutput = unknown,
>(config: {
  name: string;
  description: string;
  input: TInput;
  execute: (input: z.infer<TInput>) => Promise<TOutput>;
}): Tool<TInput, TOutput> {
  return config;
}

// Re-export everything the consumer needs
export { createRunner } from './runner.js';
export { openai } from './providers/openai.js';
export { anthropic } from './providers/anthropic.js';
export { gemini } from './providers/gemini.js';
export { zodToJsonSchema } from './schema-builder.js';
export {
  UnifaiError,
  UnifaiApiError,
  UnifaiRateLimitError,
  UnifaiNetworkError,
  UnifaiResponseParseError,
} from './errors.js';
export type {
  Tool,
  Provider,
  Message,
  ToolCall,
  RunnerOptions,
  RunInput,
  RunResult,
} from './types.js';
export type { JsonSchema } from './schema-builder.js';
