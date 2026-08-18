// The `server` ladder — `render`, which is the one name an app types to reach the SSR walk.
//
// Both rungs cross the seam, because a render is something a ROUTE does: the server half is where
// `render` is called and the browser half is how you reach it, and a rung showing only a component
// would be showing the walk's argument rather than the walk. The two server files differ in one
// statement — drain the generator, or hand it to `page` — and that difference is the whole lesson.
import type { Example } from 'harness'
import One from './1-drain-it-into-a-string.abide'
import ONE_CLIENT from './1-drain-it-into-a-string.abide?source'
import Two from './2-hand-the-chunks-straight-out.abide'
import TWO_CLIENT from './2-hand-the-chunks-straight-out.abide?source'
import ONE from '#server/rpc/docs/server/drain-a-render.ts?source'
import TWO from '#server/rpc/docs/server/stream-a-render.ts?source'

export const LADDER: Example[] = [
    {
        adds: 'render a Renderable to HTML — an async generator, so a caller wanting a string drains it',
        of: ['render'],
        source: ONE,
        client: ONE_CLIENT,
        view: One,
    },
    {
        adds: 'hand the generator straight out instead, so each chunk leaves as the walk writes it',
        of: ['render'],
        source: TWO,
        client: TWO_CLIENT,
        view: Two,
    },
]
