/**
 * Lightweight Zod → JSON Schema converter.
 *
 * Walks Zod's internal `_def.typeName` discriminator to produce a JSON Schema
 * compatible with OpenAI, Anthropic, and Gemini tool-calling APIs.
 *
 * When `strict` is true (OpenAI):
 *  - Every `object` gets `additionalProperties: false`
 *  - Every property is listed in `required`
 *  - Optional / default properties become nullable instead of omitted
 */
import type { z } from 'zod';

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  prefixItems?: JsonSchema[];
  minItems?: number;
  maxItems?: number;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function typeName(schema: z.ZodType): string {
  return (schema as any)._def?.typeName ?? '';
}

function desc(schema: z.ZodType): string | undefined {
  return (schema as any)._def?.description;
}

/**
 * Wrap a schema so it also accepts `null`.
 * Primitives use the compact `type: ["T", "null"]` form;
 * complex schemas use `anyOf` to stay compatible with OpenAI strict mode.
 */
function makeNullable(schema: JsonSchema): JsonSchema {
  if (
    typeof schema.type === 'string' &&
    !schema.properties &&
    !schema.items
  ) {
    return { ...schema, type: [schema.type, 'null'] };
  }
  // For complex schemas, hoist description to the wrapper
  const result: JsonSchema = { anyOf: [schema, { type: 'null' }] };
  if (schema.description) {
    result.description = schema.description;
    const { description: _desc, ...rest } = schema;
    result.anyOf = [rest, { type: 'null' }];
  }
  return result;
}

/**
 * Extract real values from a native TypeScript/JS enum object.
 * Numeric enums have reverse mappings (value→key) that must be filtered out.
 */
function nativeEnumValues(enumObj: Record<string, unknown>): (string | number)[] {
  return Object.keys(enumObj)
    .filter((k) => typeof enumObj[enumObj[k] as string] !== 'number')
    .map((k) => enumObj[k] as string | number);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function zodToJsonSchema(
  schema: z.ZodType,
  options: { strict?: boolean } = {},
): JsonSchema {
  return convert(schema, options);
}

// ---------------------------------------------------------------------------
// Recursive converter
// ---------------------------------------------------------------------------

function convert(
  schema: z.ZodType,
  opts: { strict?: boolean },
): JsonSchema {
  const tn = typeName(schema);
  const description = desc(schema);
  let result: JsonSchema;

  switch (tn) {
    // -- Primitives ----------------------------------------------------------
    case 'ZodString': {
      result = { type: 'string' };
      break;
    }
    case 'ZodNumber': {
      result = { type: 'number' };
      break;
    }
    case 'ZodBoolean': {
      result = { type: 'boolean' };
      break;
    }

    // -- Composite -----------------------------------------------------------
    case 'ZodObject': {
      const shape: Record<string, z.ZodType> =
        (schema as any).shape ?? (schema as any)._def?.shape?.() ?? {};

      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];

      for (const [key, field] of Object.entries(shape)) {
        const fieldTn = typeName(field);
        const isOptional = fieldTn === 'ZodOptional' || fieldTn === 'ZodDefault';

        if (isOptional) {
          const inner: z.ZodType = (field as any)._def.innerType;
          const converted = convert(inner, opts);
          // Carry description from the wrapper (.optional().describe(...))
          const fieldDesc = desc(field);
          if (fieldDesc && !converted.description) {
            converted.description = fieldDesc;
          }
          if (opts.strict) {
            // Strict mode: field is required but accepts null
            properties[key] = makeNullable(converted);
            required.push(key);
          } else {
            properties[key] = converted;
            // intentionally not in required
          }
        } else {
          properties[key] = convert(field, opts);
          required.push(key);
        }
      }

      result = { type: 'object', properties };
      if (required.length > 0) result.required = required;
      if (opts.strict) result.additionalProperties = false;
      break;
    }

    case 'ZodArray': {
      result = {
        type: 'array',
        items: convert((schema as any)._def.type, opts),
      };
      break;
    }

    case 'ZodEnum': {
      result = {
        type: 'string',
        enum: (schema as any)._def.values as string[],
      };
      break;
    }

    case 'ZodRecord': {
      const valueType: z.ZodType = (schema as any)._def.valueType;
      result = {
        type: 'object',
        additionalProperties: convert(valueType, opts),
      };
      // NOTE: strict mode's additionalProperties:false is NOT applied here —
      // records fundamentally require dynamic keys.
      break;
    }

    case 'ZodTuple': {
      const tupleItems: z.ZodType[] = (schema as any)._def.items;
      const rest: z.ZodType | null = (schema as any)._def.rest;
      result = {
        type: 'array',
        prefixItems: tupleItems.map((item) => convert(item, opts)),
      };
      if (rest) {
        result.items = convert(rest, opts);
      } else {
        // Fixed-length tuple: constrain with min/maxItems
        result.minItems = tupleItems.length;
        result.maxItems = tupleItems.length;
      }
      break;
    }

    // -- Unions & Intersections ----------------------------------------------
    case 'ZodUnion': {
      const unionOptions: z.ZodType[] = (schema as any)._def.options;
      result = { anyOf: unionOptions.map((o) => convert(o, opts)) };
      break;
    }

    case 'ZodDiscriminatedUnion': {
      const rawOptions = (schema as any)._def.options;
      // Zod v3.22+ uses an array; earlier versions used a Map
      const optionsArray: z.ZodType[] =
        rawOptions instanceof Map
          ? Array.from(rawOptions.values())
          : rawOptions;
      result = { anyOf: optionsArray.map((o) => convert(o, opts)) };
      break;
    }

    case 'ZodIntersection': {
      const left = convert((schema as any)._def.left, opts);
      const right = convert((schema as any)._def.right, opts);
      result = { allOf: [left, right] };
      break;
    }

    // -- Wrappers ------------------------------------------------------------
    case 'ZodOptional': {
      result = convert((schema as any)._def.innerType, opts);
      break;
    }

    case 'ZodDefault': {
      result = convert((schema as any)._def.innerType, opts);
      break;
    }

    case 'ZodNullable': {
      result = makeNullable(convert((schema as any)._def.innerType, opts));
      break;
    }

    case 'ZodLiteral': {
      result = { const: (schema as any)._def.value };
      break;
    }

    case 'ZodNativeEnum': {
      const values = nativeEnumValues((schema as any)._def.values);
      result = { enum: values };
      if (values.length > 0) {
        const allStrings = values.every((v) => typeof v === 'string');
        const allNumbers = values.every((v) => typeof v === 'number');
        if (allStrings) result.type = 'string';
        else if (allNumbers) result.type = 'number';
      }
      break;
    }

    case 'ZodEffects': {
      // .refine() / .transform() / .preprocess() — unwrap to the inner schema
      result = convert((schema as any)._def.schema, opts);
      break;
    }

    default: {
      // Fallback for unsupported Zod types — produce an empty schema
      result = {};
    }
  }

  if (description) result.description = description;
  return result;
}
