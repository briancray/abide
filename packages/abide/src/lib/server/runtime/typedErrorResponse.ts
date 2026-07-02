import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'
import type { TypedResponse } from '../rpc/types/TypedResponse.ts'
import { STATUS_TEXT } from './STATUS_TEXT.ts'
import { withResponseDefaults } from './withResponseDefaults.ts'

/*
Serializes a typed error as a `{ $abideError, data }` JSON body at `status`, with
the status reason phrase as statusText so it reaches `HttpError.statusText` on the
client (which parses the body back onto `HttpError.kind` / `.data`). `data` of
`undefined` drops the key (nullary errors). The single serializer shared by the
`error.typed(...)` constructors and the framework-reserved `validation` error.
*/
export function typedErrorResponse(
    name: string,
    status: number,
    data: unknown,
): TypedResponse<never> {
    return new Response(
        JSON.stringify({ $abideError: name, data }),
        withResponseDefaults(
            { statusText: STATUS_TEXT[status] ?? `HTTP ${status}` },
            { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE },
            status,
        ),
    ) as TypedResponse<never>
}
