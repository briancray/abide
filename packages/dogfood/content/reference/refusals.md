---
title: Refusals
nav: Refusals
intent: A failure declared as a value, narrowed by name, the same in process and over a wire.
enumerates:
  - Refusals
---

A **refusal** is a declared value, not a status code and not a transport concern. It fills the
`Failures` of the [`Reactive`](reactive.md) that produced it, and is narrowed with `s.isError`
wherever it is read. So a `#shared` module can own an app's failure names, and a `transform` in
the browser can refuse a write the same way a handler refuses a request.

## Syntax

```ts shared
refuse.named(name)
refuse.named(name, status, message)
refuse.named(name, status, message, { schema })
```

## Members

| Name | Signature | Description |
| --- | --- | --- |
| `refuse.named` | `<Name extends string>(name: Name, status?: number, message?: string) => ((data?: undefined) => Failed<Name, undefined>) & { is: (error: unknown) => error is Failed<Name, undefined> }` | Declares a named, narrowable failure. The status defaults to 400 and the message to that status's phrase. The factory carries `is`, which is the only narrowing available where there is no `Reactive` in scope. |
| `refuse.named` | `<Name extends string, Data extends JsonValue>(name: Name, status: number \| undefined, message: string \| ((data: Data) => string) \| undefined, options: { schema: Schema<Data> }) => ((data?: Data) => Failed<Name, Data>) & { is: (error: unknown) => error is Failed<Name, Data> }` | The same, carrying data. The schema is the only way to declare it, so `Data` and the name are both inferred and the name is written once. A `message` given as a function runs at construction on the data, a `Failed` being a value rather than a thing with getters. |
| `Failed<Name, Data>` | `Error & { name: Name; status: number; message: string; data: Data }` | The one refusal type, in process and over a wire alike. Structural, because a caller catches a shape rather than a class it imported. |
| `return myError(data)` | `Failed<Name, Data>` | One spelling for every refusal: a handler returns them. Returning refuses. |
| `notFound` | `(data?: { path: string; method: string }) => Failed<'NotFound', { path: string; method: string }>` | abide's own, returned where no route matched and where no handler is mounted at that address and method. |
| `validationError` | `<T>(data?: Issues<T>) => Failed<'ValidationError', Issues<T>>` | At 422, returned where a schema refuses. |
| `aborted` | `(data?: undefined) => Failed<'Aborted', undefined>` | At 499, where every call waiting on a load handed a `signal` and all of them aborted. The value keeps what it held. |
| `myError(data)` discarded | compile error | A `Failed` built and thrown away is a refusal that did not happen, so an expression statement whose type is `Failed` is refused, naming both repairs. |

## Description

**Construction is inert.** Building a `Failed` does not throw, which lets a gate return one and
puts the failure in a handler's return type honestly. The cost is that a
built-and-dropped refusal would fall through silently, which is why discarding one is a
compile error rather than a lint.

**Three named refusals and no more.** A name is public surface forever. The rest of what abide
raises — 403 on an origin mismatch, 413 over-size, 504 on a timeout — has no data to narrow to,
so it stays the undeclared `HttpError` at its status that `refuse(status)` means.

**On a wire it is Problem Details (RFC 9457).** An answer refusing is `application/problem+json` at
the refusal's own status: its name is the `type`, its message the `detail`, and its data a `data`
member. An undeclared `HttpError` is `type: "about:blank"` titled by its reason phrase, as the RFC
has it (15.21). A browser's `Rpc` rebuilds the same `Failed` from it, so `isError` narrows by name
there exactly as in process; any other client reads a format it already knows.

A declared refusal defaults to 400 because it is by construction an expected answer, and 500
is the one status certainly wrong for it: a generated client reads it as a server fault, and a
model retries instead of re-planning.

## Examples

### Declaring a refusal

```ts shared
export const notMember = refuse.named('NotMember', 403, undefined, {
    schema: z.object({ group: z.string() }),
})
```

### Returning a refusal

```ts server
export const invite = POST(async ({ group }: { group: string }) => {
    if (!(await isMember(group))) return notMember({ group })
    return send(group)
})
```

### Narrowing a refusal

```ts browser
if (invite.isError(error, 'NotMember')) show(error.data.group)
```

## See also

* [Failures](../server/refuse-a-request-and-say-why.md)
* [Schemas](../server/check-what-callers-send-you.md)
* [`Reactive`](reactive.md)
