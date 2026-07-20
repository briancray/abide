import { POST } from 'abide/server/POST'

// A multipart file-upload mutation (TODO #8). The single positional argument is the raw `FormData`:
// the `avatar` File rides in the body (never in a JSON args object). Two schemas guard it — `files`
// validates the uploaded FILE field (present, size, MIME), and the JSON `input` schema validates the
// multipart TEXT field `caption` (required, non-empty). Either failure surfaces as one 422 the client
// narrows to a ValidationError. The handler still receives the raw FormData and reads fields back out.
export default POST(
    async (form: FormData) => {
        const file = form.get('avatar')
        const caption = String(form.get('caption') ?? '')
        if (!(file instanceof File)) return { ok: false as const }
        return { ok: true as const, name: file.name, size: file.size, type: file.type, caption }
    },
    {
        schemas: {
            input: {
                type: 'object',
                properties: { caption: { type: 'string', minLength: 1 } },
                required: ['caption'],
            },
            files: {
                required: ['avatar'],
                properties: { avatar: { maxSize: 1_000_000, accept: 'text/*' } },
            },
        },
    },
)
