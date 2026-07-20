import { describe, expect, test } from "bun:test";
import { validateJsonSchema, toStandard, type JSONSchema } from "./jsonSchema.ts";
import { validateStandard } from "../StandardSchema.ts";

describe("type keyword", () => {
  test("primitives accept matching values", () => {
    expect(validateJsonSchema({ type: "string" }, "hi").ok).toBe(true);
    expect(validateJsonSchema({ type: "number" }, 3.14).ok).toBe(true);
    expect(validateJsonSchema({ type: "integer" }, 7).ok).toBe(true);
    expect(validateJsonSchema({ type: "boolean" }, false).ok).toBe(true);
    expect(validateJsonSchema({ type: "object" }, {}).ok).toBe(true);
    expect(validateJsonSchema({ type: "array" }, []).ok).toBe(true);
    expect(validateJsonSchema({ type: "null" }, null).ok).toBe(true);
  });

  test("integer rejects a float, number accepts it", () => {
    expect(validateJsonSchema({ type: "integer" }, 1.5).ok).toBe(false);
    expect(validateJsonSchema({ type: "number" }, 1.5).ok).toBe(true);
  });

  test("mismatched type reports an issue", () => {
    const result = validateJsonSchema({ type: "string" }, 42);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.message).toContain("Expected type string");
      expect(result.issues[0]!.path).toEqual([]);
    }
  });

  test("array of types (nullable via type array)", () => {
    const schema: JSONSchema = { type: ["string", "null"] };
    expect(validateJsonSchema(schema, "x").ok).toBe(true);
    expect(validateJsonSchema(schema, null).ok).toBe(true);
    expect(validateJsonSchema(schema, 5).ok).toBe(false);
  });

  test("nullable flag lets null through", () => {
    const schema: JSONSchema = { type: "string", nullable: true };
    expect(validateJsonSchema(schema, null).ok).toBe(true);
    expect(validateJsonSchema(schema, "x").ok).toBe(true);
  });
});

describe("object properties + required + additionalProperties", () => {
  const schema: JSONSchema = {
    type: "object",
    properties: { name: { type: "string" }, age: { type: "integer" } },
    required: ["name"],
    additionalProperties: false,
  };

  test("valid object", () => {
    expect(validateJsonSchema(schema, { name: "ada", age: 36 }).ok).toBe(true);
  });

  test("missing required property", () => {
    const result = validateJsonSchema(schema, { age: 36 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.message).toContain("required");
      expect(result.issues[0]!.path).toEqual(["name"]);
    }
  });

  test("wrong property type reports nested path", () => {
    const result = validateJsonSchema(schema, { name: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((i) => i.path.join(".") === "name");
      expect(issue).toBeDefined();
    }
  });

  test("additionalProperties false rejects extras", () => {
    const result = validateJsonSchema(schema, { name: "ada", extra: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.path).toEqual(["extra"]);
    }
  });

  test("additionalProperties as schema validates extras", () => {
    const s: JSONSchema = { type: "object", additionalProperties: { type: "number" } };
    expect(validateJsonSchema(s, { a: 1, b: 2 }).ok).toBe(true);
    expect(validateJsonSchema(s, { a: "x" }).ok).toBe(false);
  });

  test("nested objects with required, path correctness", () => {
    const nested: JSONSchema = {
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: { email: { type: "string" } },
          required: ["email"],
        },
      },
      required: ["user"],
    };
    const result = validateJsonSchema(nested, { user: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.path).toEqual(["user", "email"]);
    }
  });
});

describe("array items", () => {
  const schema: JSONSchema = { type: "array", items: { type: "integer" } };

  test("valid array", () => {
    expect(validateJsonSchema(schema, [1, 2, 3]).ok).toBe(true);
  });

  test("invalid item reports index in path", () => {
    const result = validateJsonSchema(schema, [1, "two", 3]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.path).toEqual([1]);
    }
  });

  test("array of objects, path includes index and key", () => {
    const s: JSONSchema = {
      type: "array",
      items: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    };
    const result = validateJsonSchema(s, [{ id: 1 }, {}]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.path).toEqual([1, "id"]);
    }
  });
});

describe("enum + const", () => {
  test("enum accepts a member", () => {
    expect(validateJsonSchema({ enum: ["a", "b", "c"] }, "b").ok).toBe(true);
  });

  test("enum rejects a non-member", () => {
    const result = validateJsonSchema({ enum: ["a", "b"] }, "z");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.message).toContain("Expected one of");
  });

  test("const accepts the exact value", () => {
    expect(validateJsonSchema({ const: 42 }, 42).ok).toBe(true);
    expect(validateJsonSchema({ const: "x" }, "x").ok).toBe(true);
  });

  test("const rejects a different value", () => {
    expect(validateJsonSchema({ const: 42 }, 43).ok).toBe(false);
  });

  test("const with object deep-equality", () => {
    expect(validateJsonSchema({ const: { a: 1 } }, { a: 1 }).ok).toBe(true);
    expect(validateJsonSchema({ const: { a: 1 } }, { a: 2 }).ok).toBe(false);
  });
});

describe("combinators", () => {
  test("anyOf accepts when a branch matches", () => {
    const schema: JSONSchema = { anyOf: [{ type: "string" }, { type: "number" }] };
    expect(validateJsonSchema(schema, "x").ok).toBe(true);
    expect(validateJsonSchema(schema, 5).ok).toBe(true);
  });

  test("anyOf rejects when no branch matches", () => {
    const schema: JSONSchema = { anyOf: [{ type: "string" }, { type: "number" }] };
    const result = validateJsonSchema(schema, true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.message).toContain("any of");
  });

  test("anyOf as nullable (string | null)", () => {
    const schema: JSONSchema = { anyOf: [{ type: "string" }, { type: "null" }] };
    expect(validateJsonSchema(schema, null).ok).toBe(true);
    expect(validateJsonSchema(schema, "x").ok).toBe(true);
    expect(validateJsonSchema(schema, 1).ok).toBe(false);
  });

  test("oneOf requires exactly one match", () => {
    const schema: JSONSchema = { oneOf: [{ type: "integer" }, { const: 5 }] };
    // 5 matches both integer and const 5 -> fails oneOf.
    expect(validateJsonSchema(schema, 5).ok).toBe(false);
    // 3 matches only integer -> passes.
    expect(validateJsonSchema(schema, 3).ok).toBe(true);
  });

  test("allOf requires every branch", () => {
    const schema: JSONSchema = { allOf: [{ type: "string" }, { minLength: 2 }] };
    expect(validateJsonSchema(schema, "ab").ok).toBe(true);
    expect(validateJsonSchema(schema, "a").ok).toBe(false);
  });
});

describe("string constraints + format", () => {
  test("minLength / maxLength", () => {
    expect(validateJsonSchema({ type: "string", minLength: 2 }, "a").ok).toBe(false);
    expect(validateJsonSchema({ type: "string", maxLength: 2 }, "abc").ok).toBe(false);
    expect(validateJsonSchema({ type: "string", minLength: 1, maxLength: 3 }, "ab").ok).toBe(true);
  });

  test("pattern", () => {
    expect(validateJsonSchema({ type: "string", pattern: "^a+$" }, "aaa").ok).toBe(true);
    expect(validateJsonSchema({ type: "string", pattern: "^a+$" }, "aab").ok).toBe(false);
  });

  test("date-time format accepts ISO strings", () => {
    expect(validateJsonSchema({ type: "string", format: "date-time" }, "2026-07-17T12:00:00Z").ok).toBe(true);
    expect(validateJsonSchema({ type: "string", format: "date-time" }, "2026-07-17T12:00:00.123+02:00").ok).toBe(true);
  });

  test("date-time format rejects non-ISO strings", () => {
    const result = validateJsonSchema({ type: "string", format: "date-time" }, "not a date");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.message).toContain("ISO");
  });
});

describe("numeric bounds", () => {
  test("minimum / maximum", () => {
    expect(validateJsonSchema({ type: "number", minimum: 0 }, -1).ok).toBe(false);
    expect(validateJsonSchema({ type: "number", maximum: 10 }, 11).ok).toBe(false);
    expect(validateJsonSchema({ type: "number", minimum: 0, maximum: 10 }, 5).ok).toBe(true);
  });
});

describe("toStandard", () => {
  test("round-trips a valid value through the Standard Schema interface", async () => {
    const schema: JSONSchema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    };
    const standard = toStandard(schema);
    expect(standard["~standard"].version).toBe(1);
    const result = await validateStandard(standard, { name: "ada" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: "ada" });
  });

  test("surfaces issues through the Standard Schema interface with paths", async () => {
    const schema: JSONSchema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    };
    const standard = toStandard(schema);
    const result = await validateStandard(standard, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.path).toEqual(["name"]);
      expect(result.issues[0]!.message).toContain("required");
    }
  });

  test("synchronous validate returns a Standard Schema result shape directly", () => {
    const standard = toStandard({ type: "string" });
    const result = standard["~standard"].validate(5);
    expect(result).not.toBeInstanceOf(Promise);
    if (!(result instanceof Promise)) {
      expect(result.issues).toBeDefined();
    }
  });
});
