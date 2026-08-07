// Render the example on the server. Same component, no DOM, no reactivity — a render is a snapshot,
// so every thunk is simply called.
//
// Named `ssr` rather than `server`, because `server/` beside it is the transport directory the
// compiler recognises — one word for two things in one folder is one word too many.

import { renderDocument, renderToString } from 'abide/server'
import { App, count, filter, search } from './app.ts'

count.set(3)
filter.set('a')
// Warm the slot the component will actually read. The slot read is non-blocking, so an unwarmed
// key paints empty — which is the honest answer at that moment, not a bug. Awaiting the same args
// the render will ask for is the minimal stand-in for a real SSR data pass.
await search({ q: filter.peek() })

console.log('--- renderToString ---')
console.log(await renderToString(App()))

console.log('\n--- streamed document ---')
const started = Date.now()
for await (const chunk of renderDocument('<title>abide</title>', () => App())) {
    console.log(`[+${String(Date.now() - started).padStart(3)}ms] ${chunk.trim().slice(0, 96)}`)
}
