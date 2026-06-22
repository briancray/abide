import { HttpError } from '../../shared/HttpError.ts'
import { error } from '../error.ts'

/*
Enforces a verb's maxBodySize on the actual received bytes, not the
Content-Length header (absent on chunked bodies, trivially spoofed). A
declared Content-Length over the limit rejects before reading anything;
otherwise the body streams into a buffer that throws 413 the moment the
limit is crossed — aborting the read, so the remaining bytes are never
consumed. Returns a reassembled Request carrying the buffered body and the
original headers, so the parse path's .text()/.formData() work unchanged.
Only called when the verb declares maxBodySize; the default ceiling is
Bun.serve's server-wide maxRequestBodySize, which Bun enforces natively.
*/
export async function readBodyWithinLimit(request: Request, maxBytes: number): Promise<Request> {
    const tooLarge = () =>
        new HttpError(error(413, `request body exceeds maxBodySize (${maxBytes} bytes)`))
    const declared = Number(request.headers.get('content-length') ?? Number.NaN)
    if (Number.isFinite(declared) && declared > maxBytes) {
        throw tooLarge()
    }
    if (!request.body) {
        return request
    }
    const chunks: Uint8Array[] = []
    let total = 0
    for await (const chunk of request.body) {
        total += chunk.byteLength
        if (total > maxBytes) {
            throw tooLarge()
        }
        chunks.push(chunk)
    }
    const buffered = new Uint8Array(total)
    chunks.reduce((offset, chunk) => {
        buffered.set(chunk, offset)
        return offset + chunk.byteLength
    }, 0)
    return new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: buffered,
        /* Carry the inbound signal forward so a handler reading `request().signal` still
           aborts on client disconnect — a fresh Request would otherwise drop it. */
        signal: request.signal,
    })
}
