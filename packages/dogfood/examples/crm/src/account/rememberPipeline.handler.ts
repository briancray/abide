import { cookies, POST } from '@abide/abide/server'

/** Remembers the pipeline a member last opened, on the answer's set-cookie. */
export default POST(
    ({ pipeline }: { pipeline: string }) => {
        cookies().set('pipeline', pipeline, {
            maxAge: 60 * 60 * 24 * 365,
            httpOnly: true,
        })
    },
    { description: 'Remembers the pipeline the caller last opened.' },
)
