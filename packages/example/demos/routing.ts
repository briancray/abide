// Routing — which page a URL names, and what that page may ask about the caller that asked for it.
//
// `route()` is an ambient like `request()`, but it is the one that has to be REACTIVE: a client
// moves without a new caller arriving. So it is a facade over four small cells rather than one
// record, and the difference is the whole of the last two cases here — a navigation from `/users/1`
// to `/users/2` wakes a reader of `params` and leaves a reader of `name` asleep, which is what makes
// it a republish rather than a remount. A record rebuilt per navigation cannot do that, and the
// vanilla arm on the bench is exactly that record.
//
// Every case drives the router inside an `isolate`, for two reasons: it is what proves the route is
// per-caller — a server serves two visitors at two URLs at once — and it is what keeps `bun test`
// and the browser card from writing to a real address bar. The interactive card at the bottom is the
// opposite on purpose: no isolate, so it drives the document, and `/routing/*` is served for it.

import {
    html,
    isolate,
    type Loader,
    navigate,
    outlet,
    type RouteEntry,
    route,
    routes,
    url,
    type View,
    watch,
} from 'abide'
import { reader, settled, suite } from 'abide/tests'
import { mount } from 'abide/ui'
import { button, el, row, stage } from './dom.ts'
import { META } from './SUITES.ts'
import { hrefFor, routerRecord } from './vanilla.ts'

// --- the pages ---------------------------------------------------------------
//
// Hand-written rather than `.abide` files, because a browser card cannot read a directory. The
// filesystem half — `pages(dir)` turning a pages directory into this same table — is proved in
// `test/pages.test.ts` against real `.abide` files, for the same reason `serve` is tested there.

const Home: View = () => html`<b>home</b>`
const Fresh: View = () => html`<b>the new user form</b>`
const User: View = () => html`<b>user ${() => route().params.id}</b>`
const Files: View = () => html`<b>files ${() => route().params.path}</b>`
const Post: View = () => html`<b>post ${() => route().params.slug ?? 'index'}</b>`
const Missed: View = () => html`<b>caught ${() => route().params.rest}</b>`
const Shell: View = (args) => html`<main>shell(${args.children})</main>`

/** A view that is already here, as a loader. What `() => import('./page.abide')` is the async form of. */
function load(view: View): Loader {
    return () => ({ default: view })
}

const TABLE: RouteEntry[] = [
    { path: '/', page: load(Home) },
    { path: '/users/new', page: load(Fresh) },
    { path: '/users/[id]', page: load(User), layouts: [load(Shell)] },
    { path: '/blog/[[slug]]', page: load(Post) },
    { path: '/files/[...path]', page: load(Files) },
]

/** The same table plus a catch-all, so "the last resort is still a resort" has something to catch. */
const CATCH_ALL: RouteEntry[] = [...TABLE, { path: '/[...rest]', page: load(Missed) }]

export default suite({
    ...META.routing,
    cases: [
        {
            title: 'a URL names a route, and its segments name the params',
            note: 'The route’s NAME is the pattern that matched, so it is stable across every URL that matches it — which is what makes it the thing to key a page on.',
            async run({ is }) {
                routes(TABLE)
                await isolate(async () => {
                    await navigate('/users/42')
                    is('the name is the PATTERN, not the path', route().name, '/users/[id]')
                    is('a required segment', route().params, { id: '42' })
                    is('kind', route().kind, 'page')
                    is('the URL is there in full', route().url.pathname, '/users/42')

                    await navigate('/blog')
                    is('an absent optional is OMITTED, not empty', route().params, {})
                    await navigate('/blog/hello')
                    is('…and present when it is there', route().params, { slug: 'hello' })

                    await navigate('/files/notes/2026/q1.md')
                    is('a rest segment is the joined remainder', route().params, { path: 'notes/2026/q1.md' })
                    await navigate('/files')
                    is('…and a catch-all catches nothing too', route().params, { path: '' })

                    await navigate('/users/a%20b')
                    is('a param is decoded', route().params, { id: 'a b' })
                })
            },
        },

        {
            title: 'precedence — literal > required > optional > rest',
            note: 'The table is sorted ONCE, at install, so a match is a walk that stops at the first hit. Scoring every route on every navigation is the other way to spell this, and it visits the whole table every time.',
            async run({ is }) {
                routes(CATCH_ALL)
                await isolate(async () => {
                    await navigate('/users/new')
                    is('a literal beats a required segment', route().name, '/users/new')
                    await navigate('/users/42')
                    is('…and anything else is the required one', route().name, '/users/[id]')
                    await navigate('/blog/x')
                    is('an optional takes it when nothing more specific does', route().name, '/blog/[[slug]]')
                    await navigate('/nowhere/at/all')
                    is('a rest segment is the last resort', route().name, '/[...rest]')
                    is('and it caught the whole path', route().params, { rest: 'nowhere/at/all' })
                })
            },
        },

        {
            title: 'nothing matched is a route too',
            note: 'A URL nobody claimed still has a URL, so `route()` still answers — `kind` is how a page says 404 rather than the framework guessing on its behalf.',
            async run({ is, host }) {
                routes(TABLE)
                await isolate(async () => {
                    await navigate('/nope')
                    is('kind', route().kind, 'missing')
                    is('the name is empty', route().name, '')
                    is('the URL is still answerable', route().url.pathname, '/nope')
                    const view = mount(host, () => outlet())
                    is('and the outlet renders nothing', host.textContent, '')
                    view.dispose()
                })
            },
        },

        {
            title: 'a layout wraps its page, outermost first',
            note: 'A layout is an ordinary component and its child arrives through `<slot/>` — so there is no second component protocol, and a layout is testable by being called.',
            async run({ is, host }) {
                routes(TABLE)
                await isolate(async () => {
                    await navigate('/users/7')
                    const view = mount(host, () => outlet())
                    is('the layout is outside the page', host.textContent, 'shell(user 7)')

                    await navigate('/users/8')
                    await settled()
                    is('a same-route navigation patches in place', host.textContent, 'shell(user 8)')

                    await navigate('/')
                    await settled()
                    is('a different route swaps the whole thing', host.textContent, 'home')
                    view.dispose()
                })
            },
        },

        {
            title: 'a same-route navigation is a REPUBLISH, not a remount',
            note: 'The reads re-fire in place: `params` moved, so its reader woke, and the route’s name did not, so the outlet — which reads the name and nothing else — never ran again. This is the case a status record cannot pass.',
            async run({ is }) {
                routes(TABLE)
                await isolate(async () => {
                    await navigate('/users/1')
                    const name = reader(() => route().name)
                    const params = reader(() => route().params.id)

                    await navigate('/users/2')
                    await settled()

                    is('the reader of the params woke', params.seen, ['1', '2'])
                    is('the reader of the NAME did not', name.seen, ['/users/[id]'])
                    name.dispose()
                    params.dispose()
                })
            },
        },

        {
            title: 'a query-only navigation moves the URL and nothing else',
            note: 'Four cells, not one record: `?tab=b` writes `url`, and the params object handed back is the one already held — so a reader comparing identities is right to stay asleep.',
            async run({ is }) {
                routes(TABLE)
                await isolate(async () => {
                    await navigate('/users/1?tab=a')
                    const params = reader(() => route().params.id)
                    const tab = reader(() => route().url.searchParams.get('tab'))

                    await navigate('/users/1?tab=b')
                    await settled()

                    is('the reader of the URL woke', tab.seen, ['a', 'b'])
                    is('the reader of the params did not', params.seen, ['1'])
                    params.dispose()
                    tab.dispose()
                })
            },
        },

        {
            title: 'the route is per-caller — two visitors, two URLs, at once',
            note: 'The same storage a memo’s cache uses. On a client this is one caller forever and costs a null check; on a server it is what stops one request answering about another’s URL.',
            async run({ is }) {
                routes(TABLE)
                const first = await isolate(async () => {
                    await navigate('/users/1')
                    return route().params.id
                })
                const second = await isolate(async () => {
                    await navigate('/users/2')
                    return route().params.id
                })
                is('first caller', first, '1')
                is('second caller', second, '2')
            },
        },

        {
            title: 'a page that has not arrived yet is what `navigating` reports',
            note: 'The route is committed only once its module lands, so nothing ever renders a page that is not there. A navigation to a route already loaded has no in-flight window at all, and never wakes a reader of `navigating` — the case below.',
            async run({ is }) {
                let release = (): void => {}
                const gate = new Promise<void>((resolve) => {
                    release = resolve
                })
                routes([
                    { path: '/', page: load(Home) },
                    {
                        path: '/slow',
                        page: async () => {
                            await gate
                            return { default: Fresh }
                        },
                    },
                ])
                await isolate(async () => {
                    await navigate('/')
                    const spin = reader(() => route().navigating)

                    const going = navigate('/slow')
                    await settled()
                    is('a navigation is in flight', route().navigating, true)
                    is('and the route has NOT moved yet', route().name, '/')

                    release()
                    await going
                    await settled()
                    is('it landed', route().name, '/slow')
                    is('and stopped', route().navigating, false)
                    is('the spinner woke for the start and the end', spin.seen.length, 3)
                    spin.dispose()
                })
            },
        },

        {
            title: 'a navigation with nothing to load never wakes `navigating`',
            note: 'Setting it true and false inside one tick would wake every reader of it for a navigation nobody waited on — so the resolve path stays synchronous when there is nothing to resolve.',
            async run({ is }) {
                routes(TABLE)
                await isolate(async () => {
                    await navigate('/users/1')
                    const spin = reader(() => route().navigating)
                    await navigate('/users/2')
                    await navigate('/')
                    await settled()
                    is('one run, which is the first one', spin.seen.length, 1)
                    spin.dispose()
                })
            },
        },

        {
            title: '`url` builds an in-app href, or refuses to build a wrong one',
            note: 'A missing segment and a param the pattern has no segment for are both typos every time, and both otherwise produce an href pointing at the wrong page — a bug nothing catches until somebody clicks it.',
            run({ is, throws }) {
                is('a required segment', url('/users/[id]', { id: 42 }), '/users/42')
                is('with a query', url('/users/[id]', { id: 42 }, { tab: 'posts' }), '/users/42?tab=posts')
                is('an absent optional drops out', url('/blog/[[slug]]'), '/blog')
                is('…and present when given', url('/blog/[[slug]]', { slug: 'hi' }), '/blog/hi')
                is(
                    'a rest segment keeps its slashes',
                    url('/files/[...path]', { path: 'a/b c.md' }),
                    '/files/a/b%20c.md',
                )
                is('an undefined query value is dropped', url('/', undefined, { q: undefined }), '/')

                throws('a missing required segment', () => url('/users/[id]'), 'needs a "id"')
                throws(
                    'a param that is not a segment',
                    () => url('/users/[id]', { id: 1, tab: 'x' }),
                    'not a segment',
                )
                throws('a rest segment before the end', () => url('/[...a]/b'), 'catch-all is terminal')
                throws('an unclosed segment', () => url('/users/[id'), 'unclosed')
            },
        },

        {
            title: 'interact — a router driving the address bar',
            note: 'No `isolate` here, so this is the client’s one caller: the buttons push real history entries, back and forward work, and `/routing/*` is served so a reload lands on the same page.',
            interact({ host, log }) {
                routes(LIVE)
                // Take the document's URL as the starting point, explicitly. In a browser this is
                // what `route()` would have worked out for itself; it is written down because it also
                // works where `location` is not a PLACE — a DOM emulator reports `about:blank`, and
                // an ambient that refuses to guess is right to refuse that one.
                void navigate(location.pathname + location.search, { replace: true, keepScroll: true })

                const live = stage(host, 'the outlet')
                mount(live, () => outlet())

                const links = row(
                    button('/routing', () => void navigate('/routing')),
                    button('/routing/users/1', () => void navigate('/routing/users/1')),
                    button('/routing/users/2', () => void navigate('/routing/users/2')),
                    button('?tab=b', () => void navigate(`${location.pathname}?tab=b`)),
                    button('/routing/files/a/b.md', () => void navigate('/routing/files/a/b.md')),
                    button('back', () => history.back()),
                )
                host.append(links, el('p', 'text-xs text-slate-500', 'The address bar is the state.'))

                // An ordinary effect over the ambient: the log wakes exactly when the page does.
                watch(() => {
                    log.live('route().name', route().name)
                    log.live('route().params', route().params)
                    log.live('route().url.pathname', route().url.pathname)
                    log.live('route().navigating', route().navigating)
                })
            },
        },

        {
            title: 'what a navigation WAKES — one route record against four cells',
            note: 'The vanilla arm is the shape everyone reaches for: one `{ name, params, url }` rebuilt per navigation and one notify. It is correct, and every reader wakes for every navigation. The claim here is a count, because the values on screen are identical either way.',
            bench: {
                kind: 'wake',
                arms: [
                    {
                        label: 'abide — reader of route().name across a param navigation',
                        run: async () => {
                            routes(TABLE)
                            let woke = -1
                            await isolate(async () => {
                                await navigate('/users/1')
                                const held = reader(() => {
                                    woke++
                                    return route().name
                                })
                                await navigate('/users/2')
                                await navigate('/users/3')
                                await settled()
                                held.dispose()
                            })
                            return { count: woke, of: 'wake-ups across two param navigations' }
                        },
                    },
                    {
                        label: 'vanilla — one route record, rebuilt and published per navigation',
                        run: async () => {
                            const router = routerRecord(['/users/[id]', '/'])
                            router.go('/users/1')
                            let woke = 0
                            const off = router.subscribe(() => {
                                woke++
                            })
                            router.go('/users/2')
                            router.go('/users/3')
                            off()
                            return { count: woke, of: 'wake-ups across two param navigations' }
                        },
                    },
                ],
            },
        },

        {
            title: 'what an href COSTS',
            note: 'The pattern is parsed once and cached, so building an href is a walk over segments rather than a regex over the whole string — about 1.7× the hand-written replace, under JSC. The template literal is the floor and is meant to be: it knows the pattern at author time, which is exactly the knowledge `url` gives up in exchange for a missing segment being an error rather than the string “undefined” in a link.',
            bench: {
                kind: 'time',
                arms: [
                    {
                        label: 'abide — url("/users/[id]", { id })',
                        run: (i: number): unknown => url('/users/[id]', { id: i }),
                    },
                    {
                        label: 'vanilla — a replace over the same pattern',
                        run: (i: number): unknown => hrefFor('/users/[id]', { id: i }),
                    },
                    {
                        label: 'vanilla — a template literal, which knows the pattern already',
                        run: (i: number): unknown => `/users/${i}`,
                    },
                ],
            },
        },
    ],
})

// --- the interactive table ----------------------------------------------------
//
// Under `/routing/**` on purpose: `web/serve.ts` serves that subtree with this same page, so a
// pushState the card makes is an address a reload can land on. A demo that puts the browser somewhere
// the server does not serve is a demo that breaks the moment anyone refreshes.

const Chrome: View = (args) =>
    html`<div class="space-y-2"><div class="text-xs uppercase tracking-widest text-slate-600">layout</div>${args.children}</div>`

const CHROME: Loader[] = [load(Chrome)]

const LIVE: RouteEntry[] = [
    { path: '/routing', page: load(Home), layouts: CHROME },
    { path: '/routing/users/[id]', page: load(User), layouts: CHROME },
    { path: '/routing/files/[...path]', page: load(Files), layouts: CHROME },
]
