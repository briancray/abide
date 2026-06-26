/*
Mirror of the Standard Schema v1 spec interface (standardschema.dev). Any
library that implements the spec — zod, valibot, arktype, etc. — produces
values whose `~standard` property structurally matches this shape, so users
can pass their existing schemas to rpc helpers without an adapter.

Kept inline (no `@standard-schema/spec` dep) because the spec is type-only
and tiny; adding a package for ~30 lines of interface would be churn. The
namespace pattern below is the spec's own convention — `InferInput` /
`InferOutput` ride along the same export.
*/
export interface StandardSchemaV1<Input = unknown, Output = Input> {
    readonly '~standard': StandardSchemaV1.Props<Input, Output>
}

export namespace StandardSchemaV1 {
    export interface Props<Input = unknown, Output = Input> {
        readonly version: 1
        readonly vendor: string
        readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>
        readonly types?: Types<Input, Output> | undefined
    }

    export type Result<Output> = SuccessResult<Output> | FailureResult

    export interface SuccessResult<Output> {
        readonly value: Output
        readonly issues?: undefined
    }

    export interface FailureResult {
        readonly issues: ReadonlyArray<Issue>
    }

    export interface Issue {
        readonly message: string
        readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined
    }

    export interface PathSegment {
        readonly key: PropertyKey
    }

    export interface Types<Input = unknown, Output = Input> {
        readonly input: Input
        readonly output: Output
    }

    export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
        Schema['~standard']['types']
    >['input']

    export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
        Schema['~standard']['types']
    >['output']
}
