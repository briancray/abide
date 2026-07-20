import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { deriveSchema } from "./deriveSchema.ts";
import type { JSONSchema } from "../../shared/internal/jsonSchema.ts";

const FIXTURE = fileURLToPath(new URL("./__fixtures__/handlers.ts", import.meta.url));

describe("deriveSchema", () => {
  test("derives input/output for a wrapped async handler with mixed field shapes", () => {
    const { input, output, warnings } = deriveSchema(FIXTURE, "create");

    expect(input).toBeDefined();
    const inputSchema = input!;
    expect(inputSchema.type).toBe("object");

    const props = inputSchema.properties!;
    // Primitive field.
    expect(props.id).toEqual({ type: "number" });
    // Optional field is present but excluded from `required`.
    expect(props.name).toEqual({ type: "string" });
    // Literal union collapses to an enum.
    expect(props.role!.enum).toBeDefined();
    expect([...(props.role!.enum as string[])].sort()).toEqual(["admin", "guest", "user"]);
    // Array field.
    expect(props.tags).toEqual({ type: "array", items: { type: "string" } });
    // Date -> date-time string.
    expect(props.createdAt).toEqual({ type: "string", format: "date-time" });
    // Nested object with its own optional prop.
    expect(props.profile!.type).toBe("object");
    expect(props.profile!.properties!.bio).toEqual({ type: "string" });
    expect(props.profile!.required).toEqual(["bio"]);

    // `required` excludes the optional top-level fields (name) and any unrepresentable field.
    const required = inputSchema.required ?? [];
    expect(required).toContain("id");
    expect(required).toContain("role");
    expect(required).not.toContain("name");

    // Function-typed field is permissive {} and produces a LOUD warning naming the field.
    expect(props.onEvent).toEqual({});
    const functionWarning = warnings.find((w) => w.includes("onEvent"));
    expect(functionWarning).toBeDefined();
    expect(functionWarning).toContain("function");

    // Promise return type is unwrapped to its settled value.
    expect(output).toBeDefined();
    expect(output!.type).toBe("object");
    expect(output!.properties!.ok).toEqual({ type: "boolean" });
    expect(output!.properties!.id).toEqual({ type: "number" });
    expect(output!.required!.sort()).toEqual(["id", "ok"]);
  });

  test("derives from a direct (unwrapped) arrow function", () => {
    const { input, output, warnings } = deriveSchema(FIXTURE, "echo");
    expect(warnings).toEqual([]);
    expect(input).toEqual({ type: "object", properties: { text: { type: "string" } }, required: ["text"] });
    expect(output).toEqual({ type: "object", properties: { text: { type: "string" } }, required: ["text"] });
  });

  test("handles number-literal unions, tuples, and nullable fields", () => {
    const { input } = deriveSchema(FIXTURE, "configure");
    const props = input!.properties!;

    // Number-literal union -> enum of numbers.
    expect((props.level!.enum as number[]).slice().sort()).toEqual([1, 2, 3]);

    // Tuple -> array with fixed-length positional prefixItems.
    const pair = props.pair as JSONSchema & { prefixItems?: JSONSchema[] };
    expect(pair.type).toBe("array");
    expect(pair.prefixItems).toEqual([{ type: "number" }, { type: "string" }]);
    expect(pair.minItems).toBe(2);
    expect(pair.maxItems).toBe(2);

    // `string | null` -> anyOf including a null branch.
    const nickname = props.nickname!;
    expect(nickname.anyOf).toBeDefined();
    const branches = nickname.anyOf!;
    expect(branches).toContainEqual({ type: "null" });
    expect(branches).toContainEqual({ type: "string" });
  });

  test("warns (does not throw) when the export is not callable", () => {
    const { input, output, warnings } = deriveSchema(FIXTURE, "notAFunction");
    expect(input).toBeUndefined();
    expect(output).toBeUndefined();
    expect(warnings.some((w) => w.includes("not callable"))).toBe(true);
  });

  test("warns when the export does not exist", () => {
    const { warnings } = deriveSchema(FIXTURE, "doesNotExist");
    expect(warnings.some((w) => w.includes("not found"))).toBe(true);
  });
});
