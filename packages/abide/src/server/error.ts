// Error helpers (rpc-core §4). `error(status, message?)` FAILS the call; `error.typed(name, status,
// schema?)` builds a reusable factory for a named, narrowable failure.
//
// Both THROW rather than returning a `Response`. `rpc = memo + transport`, so a handler is a memo body
// and a memo's failure channel is a throw: throwing is what puts the failure in the slot's error channel
// (`fn.error()`), keeps it out of the value channel, and reaches an in-process caller as a `catch`.
// Returning a `Response` instead made the handler reach DOWN into transport, and the value channel then
// carried it — on a read at `ttl: ∞` the non-2xx was retained as that slot's value forever.
//
// Because a `throw` is `never`, the ternary form still types on the success shape with no brand and no
// conditional: `GET(({ fail }) => fail ? error(503) : { greeting })` infers `{ greeting }`, since a union
// absorbs `never`. That is what retired `OutcomeResponse`/`Payload<R>`'s outcome branch.
//
// Transport is the other half: the router renders a thrown `HttpError` at its status (`errorResponse`),
// and the browser proxy decodes a non-2xx back into the same class — so `fn.isError(e, name)` narrows
// identically on both sides. Middleware short-circuits by throwing this too; the chain renders it.

import { HttpError } from '../shared/HttpError.ts'

export const error: {
    (status: number, message?: string, init?: { headers?: HeadersInit }): never
    typed(name: string, status: number, schema?: unknown): (data?: unknown) => never
} = Object.assign(
    (status: number, message?: string, init?: { headers?: HeadersInit }): never => {
        throw new HttpError(status, message, { headers: init?.headers })
    },
    {
        typed(name: string, status: number, _schema?: unknown): (data?: unknown) => never {
            return (data?: unknown): never => {
                throw new HttpError(status, undefined, { kind: name, data })
            }
        },
    },
)
