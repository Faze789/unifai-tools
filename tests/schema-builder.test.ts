import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from '../src/schema-builder.js';

// ─── Primitives ────────────────────────────────────────────────────────────

describe('primitives', () => {
  it('converts z.string()', () => {
    expect(zodToJsonSchema(z.string())).toEqual({ type: 'string' });
  });

  it('converts z.number()', () => {
    expect(zodToJsonSchema(z.number())).toEqual({ type: 'number' });
  });

  it('converts z.boolean()', () => {
    expect(zodToJsonSchema(z.boolean())).toEqual({ type: 'boolean' });
  });
});

// ─── Composites ────────────────────────────────────────────────────────────

describe('z.object', () => {
  it('converts a flat object with required fields', () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    expect(zodToJsonSchema(schema)).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name', 'age'],
    });
  });

  it('excludes optional fields from required', () => {
    const schema = z.object({
      name: z.string(),
      nick: z.string().optional(),
    });
    const result = zodToJsonSchema(schema);
    expect(result.required).toEqual(['name']);
  });

  it('excludes default fields from required', () => {
    const schema = z.object({
      count: z.number().default(10),
    });
    const result = zodToJsonSchema(schema);
    expect(result.required).toBeUndefined();
  });

  it('handles nested objects', () => {
    const schema = z.object({
      address: z.object({
        street: z.string(),
        city: z.string(),
      }),
    });
    const result = zodToJsonSchema(schema);
    expect(result.properties!.address).toEqual({
      type: 'object',
      properties: {
        street: { type: 'string' },
        city: { type: 'string' },
      },
      required: ['street', 'city'],
    });
  });
});

describe('z.array', () => {
  it('converts an array of strings', () => {
    expect(zodToJsonSchema(z.array(z.string()))).toEqual({
      type: 'array',
      items: { type: 'string' },
    });
  });

  it('converts an array of objects', () => {
    const schema = z.array(z.object({ id: z.number() }));
    expect(zodToJsonSchema(schema)).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'number' } },
        required: ['id'],
      },
    });
  });
});

describe('z.enum', () => {
  it('converts a string enum', () => {
    expect(zodToJsonSchema(z.enum(['a', 'b', 'c']))).toEqual({
      type: 'string',
      enum: ['a', 'b', 'c'],
    });
  });
});

describe('z.record', () => {
  it('converts a record with string values', () => {
    expect(zodToJsonSchema(z.record(z.string(), z.number()))).toEqual({
      type: 'object',
      additionalProperties: { type: 'number' },
    });
  });

  it('does NOT inject additionalProperties:false in strict mode', () => {
    const result = zodToJsonSchema(z.record(z.string(), z.boolean()), {
      strict: true,
    });
    // additionalProperties should be the value schema, not false
    expect(result.additionalProperties).toEqual({ type: 'boolean' });
  });
});

describe('z.tuple', () => {
  it('converts a fixed-length tuple', () => {
    const result = zodToJsonSchema(
      z.tuple([z.string(), z.number(), z.boolean()]),
    );
    expect(result).toEqual({
      type: 'array',
      prefixItems: [
        { type: 'string' },
        { type: 'number' },
        { type: 'boolean' },
      ],
      minItems: 3,
      maxItems: 3,
    });
  });

  it('converts a tuple with rest element', () => {
    const result = zodToJsonSchema(z.tuple([z.string()]).rest(z.number()));
    expect(result).toEqual({
      type: 'array',
      prefixItems: [{ type: 'string' }],
      items: { type: 'number' },
    });
  });
});

// ─── Unions & Intersections ────────────────────────────────────────────────

describe('z.union', () => {
  it('converts a union to anyOf', () => {
    const result = zodToJsonSchema(z.union([z.string(), z.number()]));
    expect(result).toEqual({
      anyOf: [{ type: 'string' }, { type: 'number' }],
    });
  });
});

describe('z.discriminatedUnion', () => {
  it('converts a discriminated union to anyOf', () => {
    const schema = z.discriminatedUnion('type', [
      z.object({ type: z.literal('circle'), radius: z.number() }),
      z.object({ type: z.literal('square'), side: z.number() }),
    ]);
    const result = zodToJsonSchema(schema);
    expect(result.anyOf).toHaveLength(2);
    expect(result.anyOf![0]).toEqual({
      type: 'object',
      properties: {
        type: { const: 'circle' },
        radius: { type: 'number' },
      },
      required: ['type', 'radius'],
    });
    expect(result.anyOf![1]).toEqual({
      type: 'object',
      properties: {
        type: { const: 'square' },
        side: { type: 'number' },
      },
      required: ['type', 'side'],
    });
  });

  it('applies strict mode to each branch', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), x: z.number() }),
      z.object({ kind: z.literal('b'), y: z.string() }),
    ]);
    const result = zodToJsonSchema(schema, { strict: true });
    for (const branch of result.anyOf!) {
      expect(branch.additionalProperties).toBe(false);
    }
  });
});

describe('z.intersection', () => {
  it('converts an intersection to allOf', () => {
    const schema = z.intersection(
      z.object({ name: z.string() }),
      z.object({ age: z.number() }),
    );
    const result = zodToJsonSchema(schema);
    expect(result).toEqual({
      allOf: [
        {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
        {
          type: 'object',
          properties: { age: { type: 'number' } },
          required: ['age'],
        },
      ],
    });
  });
});

// ─── Wrappers ──────────────────────────────────────────────────────────────

describe('z.nullable', () => {
  it('makes a primitive nullable with type array', () => {
    expect(zodToJsonSchema(z.string().nullable())).toEqual({
      type: ['string', 'null'],
    });
  });

  it('makes an object nullable with anyOf', () => {
    const result = zodToJsonSchema(
      z.object({ x: z.number() }).nullable(),
    );
    expect(result).toEqual({
      anyOf: [
        {
          type: 'object',
          properties: { x: { type: 'number' } },
          required: ['x'],
        },
        { type: 'null' },
      ],
    });
  });
});

describe('z.literal', () => {
  it('converts a string literal', () => {
    expect(zodToJsonSchema(z.literal('hello'))).toEqual({ const: 'hello' });
  });

  it('converts a numeric literal', () => {
    expect(zodToJsonSchema(z.literal(42))).toEqual({ const: 42 });
  });
});

describe('z.nativeEnum', () => {
  it('converts a string nativeEnum', () => {
    enum Color {
      Red = 'red',
      Blue = 'blue',
    }
    const result = zodToJsonSchema(z.nativeEnum(Color));
    expect(result).toEqual({ enum: ['red', 'blue'], type: 'string' });
  });

  it('converts a numeric nativeEnum (filtering reverse mappings)', () => {
    enum Status {
      Active = 0,
      Inactive = 1,
    }
    const result = zodToJsonSchema(z.nativeEnum(Status));
    expect(result.enum).toEqual([0, 1]);
    expect(result.type).toBe('number');
  });
});

describe('z.effects (.refine / .transform)', () => {
  it('unwraps effects to the inner schema', () => {
    const schema = z.string().refine((s) => s.length > 0);
    expect(zodToJsonSchema(schema)).toEqual({ type: 'string' });
  });
});

// ─── Strict mode ───────────────────────────────────────────────────────────

describe('strict mode (OpenAI)', () => {
  it('injects additionalProperties: false on every object', () => {
    const schema = z.object({
      outer: z.object({ inner: z.string() }),
    });
    const result = zodToJsonSchema(schema, { strict: true });
    expect(result.additionalProperties).toBe(false);
    expect(
      (result.properties!.outer as any).additionalProperties,
    ).toBe(false);
  });

  it('puts all fields (including optional) in required', () => {
    const schema = z.object({
      name: z.string(),
      nick: z.string().optional(),
    });
    const result = zodToJsonSchema(schema, { strict: true });
    expect(result.required).toEqual(['name', 'nick']);
  });

  it('makes optional primitive fields nullable', () => {
    const schema = z.object({
      nick: z.string().optional(),
    });
    const result = zodToJsonSchema(schema, { strict: true });
    expect(result.properties!.nick).toEqual({
      type: ['string', 'null'],
    });
  });

  it('makes optional object fields nullable via anyOf', () => {
    const schema = z.object({
      meta: z.object({ key: z.string() }).optional(),
    });
    const result = zodToJsonSchema(schema, { strict: true });
    const meta = result.properties!.meta;
    expect(meta.anyOf).toBeDefined();
    expect(meta.anyOf).toHaveLength(2);
    expect(meta.anyOf![1]).toEqual({ type: 'null' });
  });
});

// ─── Descriptions ──────────────────────────────────────────────────────────

describe('descriptions', () => {
  it('carries .describe() through to the schema', () => {
    const result = zodToJsonSchema(z.string().describe('A name'));
    expect(result.description).toBe('A name');
  });

  it('carries description from optional wrapper', () => {
    const schema = z.object({
      nick: z.string().optional().describe('Optional nickname'),
    });
    const result = zodToJsonSchema(schema);
    expect(result.properties!.nick.description).toBe('Optional nickname');
  });

  it('carries description from optional wrapper in strict mode', () => {
    const schema = z.object({
      nick: z.string().optional().describe('Optional nickname'),
    });
    const result = zodToJsonSchema(schema, { strict: true });
    // The description should be on the nullable wrapper
    expect(result.properties!.nick.description).toBe('Optional nickname');
  });
});
