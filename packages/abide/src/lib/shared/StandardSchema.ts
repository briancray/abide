// Standard Schema v1 — the vendor-neutral validation interface (rpc-core §10). Any Zod/Valibot/
// ArkType/etc. schema exposes a `~standard` property conforming to this shape, so abide validates
// against them without depending on any one library.
//
// Raw JSON Schema objects and type-derived schemas are handled in `shared/internal/jsonSchema.ts`
// (`asStandardSchema` adapts either kind to this interface); the RPC path funnels everything through
// there before calling `validateStandard` below.

// The `~standard` contract a conforming schema attaches. `validate` may return synchronously or
// asynchronously; a success carries `value`, a failure carries `issues`.
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output> | undefined;
  }

  export type Result<Output> = SuccessResult<Output> | FailureResult;

  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }

  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }

  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }

  export interface PathSegment {
    readonly key: PropertyKey;
  }

  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }

  export type InferInput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["input"];
  export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["output"];
}

// Normalised outcome the RPC path consumes — collapses sync/async and success/failure into a
// single monomorphic shape so callers branch on `ok` alone.
export type ValidateStandardResult<Output> =
  | { readonly ok: true; readonly value: Output }
  | { readonly ok: false; readonly issues: ReadonlyArray<StandardSchemaV1.Issue> };

// Run a Standard Schema validation, awaiting an async `validate` when needed.
export async function validateStandard<Input, Output>(
  schema: StandardSchemaV1<Input, Output>,
  value: unknown,
): Promise<ValidateStandardResult<Output>> {
  let result = schema["~standard"].validate(value);
  if (result instanceof Promise) result = await result;
  if (result.issues !== undefined) return { ok: false, issues: result.issues };
  return { ok: true, value: result.value };
}
