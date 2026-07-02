import { NO_STORE } from '../shared/CACHE_CONTROL_VALUES.ts'
import { TEXT_PLAIN } from '../shared/TEXT_PLAIN.ts'
import type { StandardSchemaV1 } from '../shared/types/StandardSchemaV1.ts'
import type { TypedError } from './rpc/types/TypedError.ts'
import type { TypedResponse } from './rpc/types/TypedResponse.ts'
import { STATUS_TEXT } from './runtime/STATUS_TEXT.ts'
import { typedErrorResponse } from './runtime/typedErrorResponse.ts'
import { withResponseDefaults } from './runtime/withResponseDefaults.ts'

/*
Plain-text error Response — clearer than constructing a Response by
hand with a status and a text body, and shaped so the client's
HttpError carries the message verbatim (`HttpError.response.text()`
returns the message, no parsing).

  if (!order) return error(404, 'order not found')

`message` defaults to the status's standard reason phrase when
omitted (e.g. `error(404)` body = 'Not Found'). The body is
text/plain so intermediaries don't try to render or sniff it. A final
`ResponseInit` adds headers (e.g. `Retry-After` on a 429); the positional
`status` always wins over any `init.status`.

For a NAMED, typed error the client can branch on, declare a constructor with
`error.typed(name, status, schema?)` and return it (see below). To short-circuit
a handler instead of returning, `throw new Error(...)` or
`throw new HttpError(error(...))` — the framework's `app.handleError` hook
catches thrown errors. This helper deliberately returns a Response rather than
throwing one so a single `return error(...)` is the expected pattern, with the
same control flow as `return json(...)`.
*/

/*
Body type is `never` because `error()` only travels the non-2xx path on
the wire — the caller's `await fn(args)` throws `HttpError` and never
resolves to this response's body. Returning a TypedResponse<never> lets
the union of branches in a handler narrow to whatever the success
branch carries (`TypedResponse<{user}> | TypedResponse<never>` → Return
= {user}).
*/
function errorResponse(
    status: number,
    message?: string,
    init?: ResponseInit,
): TypedResponse<never> {
    const body = message ?? STATUS_TEXT[status] ?? `HTTP ${status}`
    return new Response(
        body,
        withStatusText(
            withResponseDefaults(
                init,
                {
                    'Content-Type': TEXT_PLAIN,
                    'Cache-Control': NO_STORE,
                },
                status,
            ),
            status,
        ),
    ) as TypedResponse<never>
}

/*
Stamps the status's standard reason phrase onto `init.statusText` so the wire
status line reads `404 Not Found` and the client's `HttpError.statusText` is
populated — Bun's `Response` never derives statusText from the code. A caller's
explicit `init.statusText` (preserved through withResponseDefaults) still wins;
an unlisted code leaves it untouched.
*/
function withStatusText(init: ResponseInit, status: number): ResponseInit {
    if (init.statusText === undefined && STATUS_TEXT[status] !== undefined) {
        return { ...init, statusText: STATUS_TEXT[status] }
    }
    return init
}

/*
Declares a reusable, typed error as a single constructor. With a `data` schema
the constructor requires that input; without one it's nullary. Returning the
constructor from a handler IS the error — it serializes a `{ $abideError, data }`
body at `status`, and the rpc reads the constructor's branded return type to
expose the error on `rpc.isError(e, 'name')` (`.kind` and typed `.data`). No
`errors:` option, no set to register — compose by returning whichever you want:

  const duplicateSlug = error.typed('duplicateSlug', 409, z.object({ slug: z.string() }))
  const rateLimited = error.typed('rateLimited', 429)               // nullary

  export const createPost = POST(({ slug }) =>
      taken(slug) ? duplicateSlug({ slug }) : json(save(slug)),
  )

`name` is the wire identity and the `isError` key, so it's an explicit string
(a const can't read its own variable name); `schema` types `.data` and is never
validated at runtime here.
*/
function typed<Name extends string, Schema extends StandardSchemaV1>(
    name: Name,
    status: number,
    schema: Schema,
): (data: StandardSchemaV1.InferInput<Schema>) => TypedError<Name, { status: number; data: Schema }>
function typed<Name extends string>(
    name: Name,
    status: number,
): () => TypedError<Name, { status: number; data?: undefined }>
function typed(name: string, status: number, _schema?: StandardSchemaV1) {
    return (data?: unknown) => typedErrorResponse(name, status, data)
}

// @documentation response
export const error = Object.assign(errorResponse, { typed })
