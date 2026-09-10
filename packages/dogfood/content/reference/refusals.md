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
refuse.typed(name)
refuse.typed(name, status, message, options)
```

## Members

| Name | Signature | Description |
| --- | --- | --- |
| `refuse.typed` | `<Name extends string, Data extends JsonValue = undefined>(name: Name, status?: number, message?: string \| ((data: Data) => string), options?: { schema?: Schema<Data> }) => ((data?: Data) => Failed<Name, Data>) & { is: (error: unknown) => error is Failed<Name, Data> }` | Declares a named, narrowable failure. The status defaults to 400. A `message` given as a function runs at construction on the data, a `Failed` being a value rather than a thing with getters. The factory carries `is`, which is the only narrowing available where there is no `Reactive` in scope. |
| `Failed<Name, Data>` | `Error & { name: Name; status: number; message: string; data: Data }` | The one refusal type, in process and over a wire alike. Structural, because a caller catches a shape rather than a class it imported. |
| `return myError(data)` | `Failed<Name, Data>` | One spelling for every refusal: a handler returns them. Returning refuses. |
| `notFound` | `(data?: { path: string; method: string }) => Failed<'NotFound', { path: string; method: string }>` | abide's own, returned where no route matched and where no handler is mounted at that address and method. |
| `validationError` | `<T>(data?: Issues<T>) => Failed<'ValidationError', Issues<T>>` | The other one, at 422, returned where a schema refuses. |
| `myError(data)` discarded | compile error | A `Failed` built and thrown away is a refusal that did not happen, so an expression statement whose type is `Failed` is refused, naming both repairs. |

## Description

**Construction is inert.** Building a `Failed` does not throw, which lets a gate return one and
puts the failure in a handler's return type honestly. The cost is that a
built-and-dropped refusal would fall through silently, which is why discarding one is a
compile error rather than a lint.

**Two named refusals and no more.** A name is public surface forever. The rest of what abide
raises — 403 on an origin mismatch, 413 over-size, 504 on a timeout — has no data to narrow to,
so it stays the undeclared `HttpError` at its status that `refuse(status)` means.

A declared refusal defaults to 400 because it is by construction an expected answer, and 500
is the one status certainly wrong for it: a generated client reads it as a server fault, and a
model retries instead of re-planning.

## Examples

### Declaring a refusal

```ts shared
export const notMember = refuse.typed('NotMember', 403)
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
