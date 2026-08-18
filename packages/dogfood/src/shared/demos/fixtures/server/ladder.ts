// The `server` ladder — `render`, which is the one name an app types to reach the SSR walk.
//
// Every rung crosses the seam, because a render is something a ROUTE does: the server half is where
// `render` is called and the browser half is how you reach it, and a rung showing only a component
// would be showing the walk's argument rather than the walk.
//
// The four server files differ in ONE statement each, and that difference is the whole lesson: drain
// the generator, hand it to `page`, ask for the app's own document around it, or pass a document of
// your own. The browser halves of rungs 1, 3 and 4 are deliberately the same button and `<pre>` —
// what changed is what came back, and a second spelling of the call site would hide that.
import type { Example } from 'harness'
import One from './1-drain-it-into-a-string.abide'
import ONE_CLIENT from './1-drain-it-into-a-string.abide?source'
import Two from './2-hand-the-chunks-straight-out.abide'
import TWO_CLIENT from './2-hand-the-chunks-straight-out.abide?source'
import Three from './3-put-it-in-the-apps-shell.abide'
import THREE_CLIENT from './3-put-it-in-the-apps-shell.abide?source'
import Four from './4-bring-your-own-shell.abide'
import FOUR_CLIENT from './4-bring-your-own-shell.abide?source'
import ONE from '#server/rpc/docs/server/drain-a-render.ts?source'
import THREE from '#server/rpc/docs/server/in-the-apps-shell.ts?source'
import FOUR from '#server/rpc/docs/server/in-your-own-shell.ts?source'
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
    {
        adds: 'ask for a document around it — `shell: true` is the one the app’s own pages are served in',
        of: ['render'],
        source: THREE,
        client: THREE_CLIENT,
        view: Three,
    },
    {
        adds: 'pass a document of your own instead: a whole html file with a `<slot></slot>` in it',
        of: ['render'],
        source: FOUR,
        client: FOUR_CLIENT,
        view: Four,
    },
]
