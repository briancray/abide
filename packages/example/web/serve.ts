// The example server. `bun run web` from the repo root.
//
// Bun's HTML routes bundle the `<script type="module">` and the `<link>`ed stylesheet on demand, so
// there is no build step and no bundler config — the pages import `abide` and `$tests` directly, and
// what the browser runs is the source in this repo.

import bench from './bench.html'
import channel from './channel.html'
import client from './client.html'
import compiler from './compiler.html'
import hydrate from './hydrate.html'
import memo from './memo.html'
import overview from './overview.html'
import scope from './scope.html'
import server from './server.html'
import state from './state.html'
import template from './template.html'
import verbs from './verbs.html'
import watch from './watch.html'

const running = Bun.serve({
    port: Number(Bun.env.PORT ?? 3000),
    // Not a preference, and not a half-measure either — both halves of this are measured.
    //
    // HMR has to be off: the dev server wraps every module in a registry function so it can swap
    // them, and that wrapping evaluates a circular ESM graph in an order plain ESM never would.
    // TypeScript's `unstable/ast` barrel is one — `export * from "./visitor.js"` — so with HMR on,
    // `/compiler` and `/bench` die at import with `TypeError: null is not an object (evaluating
    // 'import_visitor3.visitEachChildOfJSDocParameterTag')`. A `Bun.build` of the same entry is fine,
    // because it inlines modules in dependency order. Three lines reproduce it with no abide in them.
    //
    // `false` rather than `{ hmr: false }`, because the object form re-bundles the route on EVERY
    // document request — 8-10ms a navigation, where `false` caches and serves in 0.3ms. The cost is
    // the error overlay and console forwarding; the cards report their own pass/fail, and Safari's
    // console is still right there.
    development: false,
    routes: {
        '/': overview,
        '/state': state,
        '/memo': memo,
        '/verbs': verbs,
        '/channel': channel,
        '/watch': watch,
        '/scope': scope,
        '/template': template,
        '/client': client,
        '/server': server,
        '/hydrate': hydrate,
        '/compiler': compiler,
        '/bench': bench,
    },
})

console.log(`abide examples → ${running.url}`)
