# Registry

Every name an app author can write, with its type and what it is.

`@abide/abide/compiler`, and the `/runtime`, `/server/runtime`, `/routing`, `/wire` and `/worker`
entries compiled output imports, are tooling rather than surface an app author writes, and none of their
names is a row.

## What this document is

A **registry**. One row per name, and the row answers exactly one question: *what is this?*

## What belongs here, and what does not

| A statement | Goes | Because |
| --- | --- | --- |
| Answerable from the type alone | here | a signature and its one-line meaning are the same fact |
| Constrains behavior, at build time or run time | RULEBOOK.md | a requirement has a clause number, and is stated once |
| Explains why the design is this way | a guide in `packages/dogfood/src` | a reason is read once and never looked up |
| A measurement | the harness | a number in prose is a number nothing reruns |

## Format rules

These are immutable. A change to them is a change to what this document is.

1. **A row is a name that appears in application source.** An internal type nothing can be written
   against is not a row.
2. **The meaning cell is ONE sentence**, and it states what the name *is*. Never when it runs, what
   it requires, what it refuses, or what happens if it does.
3. **No requirement keyword appears in this document.** MUST, MUST NOT, SHALL, SHOULD, SHOULD NOT
   and MAY belong to RULEBOOK.md, and a check refuses them here.
4. **No rationale, no measurement, no example.** A row that wants any of the three is a row whose
   behavior is being restated; cite the clause instead.
5. **Behavior is cited, never described.** The `Rules` cell lists the clauses that govern the name.
   `—` is permitted and is an admission: it says this name has no behavior of its own.

The one-sentence rule is what keeps the two documents apart. A second sentence is a rule every time.

## Type parameter order

Slots one and two are the two ends of the arrow the name is, the end a reader came for written
first. `Reactive<Stored, Accepted>` is a value read and then written,
`Rpc<Value, Args>` is a call answered and then made, `reactive<Accepted, Shaped>` is the value form
taking and then holding what its transform hands back, and `memo<Computed, Args>` is a keyed body returning and then taking. Slot three is the
second value type wherever the first two did not already carry it, which on `Keyed<Stored, Args,
Accepted, Failures>` is the inner value's own `Accepted`. Then `Failures`, then
`Produced`.

# `.abide` files

## Reading and writing by name

| Spelling | Means | Rules |
| --- | --- | --- |
| `foo` wherever the declared type of its position is not a `Reactive` | a live read | 31.1, 31.2, 31.10, 31.21 |
| `const x: Reactive<…> = foo` / a `Reactive<…>`-typed parameter, object literal member, return or `bind:` operand | the `Reactive` | 31.3, 31.19 |
| `await foo` | the settling of the `Reactive`, which is its value | 1.4, 2.7, 31.3 |
| `refresh(foo)` / a `Selection`-typed parameter | the `Reactive` | 31.13 |
| `foo = bar` | a write, or where `foo` holds nothing yet and `bar` is a `Reactive`, a binding to it | 31.4, 11.61, 31.18, 31.20 |
| `foo.bar = v` | a write through a path | 31.8, 31.14, 31.16 |
| `foo.push(v)` | a write through a path, run on a copy of the array | 31.8, 31.9 |
| `const [a, b] = foo` / `...foo` | one read of the value | 31.12 |
| `const { a, b: c } = bar()` where a member is a `Reactive` | a name bound to that `Reactive` | 31.17 |
| `bar.a` / `bar[k]` where the member is a `Reactive` | read and written as `foo` is | 31.15 |
| `foo.bar` | the value's `bar`, or the `Reactive`'s own `bar` where its type declares one the value does not | 31.5 |
| `foo.bar(…)` | a call of the value's `bar`, or of the `Reactive`'s own `bar` where it declares one the value does not | 31.6 |
| `foo()` / `foo.set(v)` | the explicit forms | 31.7, 31.11 |

## Expressions

| Spelling | Meaning | Rules |
| --- | --- | --- |
| `{expr}` | Reactive text, escaped. | 32.1, 32.23 |
| formatting whitespace | What a run of whitespace renders as. | 33.17, 33.18 |
| `{raw(...)}` | Raw HTML. | 32.2, 32.25, 32.26, 32.30, 32.31, 32.70 |
| `name={expr}` | A reactive attribute or property. | 32.3, 32.20, 32.23, 32.37, 32.70, 32.71, 32.113, 32.114, 32.115 |
| `on<event>={fn}` | A native listener on an element, and an ordinary prop on a component. | 32.4, 32.75, 32.95, 32.109 |
| `name="…{expr}…"` | An interpolated quoted value. | 32.3, 32.71 |
| `bind:value` | Two-way bind on an element. | 5.16, 32.5, 32.58, 32.59, 32.60, 32.61, 32.62, 32.72, 32.74, 32.75, 32.76, 32.78 |
| `bind:prop={state}` | Hands a component prop the caller's `Reactive`, or a `{get, set}` pair, to write through. | 32.6, 33.6, 33.8, 14.18, 32.76 |
| `bind:checked` | A boolean bind on an input. | 32.7, 32.72, 32.74, 32.75, 32.76, 32.78 |
| `bind:open` | A boolean bind on whether a `<details>` is open. | 32.7, 32.72, 32.74, 32.75, 32.76, 32.78 |
| `bind:group` | Radio or checkbox membership. | 32.8, 32.72, 32.74, 32.75, 32.76 |
| `bind:files` | A file input's files, as a list. | 32.73, 32.72, 32.74, 32.75, 32.76, 32.78 |
| `bind:value={{get, set}}` | Two-way bind over an explicit accessor pair, on an element or a component. | 32.5, 32.6, 32.78 |
| `bind:element={Reactive<Element> \| ((element: Element) => void \| Disposer) \| ((element: Element) => void \| Disposer)[]}` | A node reference. | 32.9, 32.38, 32.66, 32.68, 32.69 |
| `class:name={cond}` | Toggles a class. | 32.10, 32.71 |
| `style:prop={value}` | Sets one style property. | 32.10, 32.19, 32.71, 32.94 |
| `{...expr}` | Spreads props or attributes. | 32.11, 32.37, 33.12, 33.13, 32.99, 32.109, 32.113, 32.114 |
| static template text | What an author writes outside a slot, in body text and in an attribute value. | 32.27, 32.28 |

## `raw`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `raw` | `(value: unknown) => Raw` | The branding a value takes to render as markup rather than as text. | 32.2, 32.24, 32.26, 32.30, 32.31, 32.70, 32.77, 32.93 |
| `Raw` | `class Raw { html: string }` | What `raw` hands back. | 32.24 |

## Control flow

| Spelling | Branches | Meaning | Rules |
| --- | --- | --- | --- |
| `{#if cond}` | `{:else if cond}`, `{:else}` | Conditional markup. | 12.18, 32.12, 32.21, 32.63, 32.64, 32.65, 32.70, 41.24 |
| `{#for item, index of list key expression}` | — | Repeats markup over a list, or over a cursor as it produces. | 12.18, 32.13, 32.14, 32.15, 32.22, 32.97, 32.29, 32.32, 32.33, 32.63, 32.64, 32.67, 32.70, 32.111, 41.8, 41.14, 41.15 |
| `{#try}` | `{:pending}`, `{:catch e}`, `{:finally}` | A render-time boundary and a region. | 32.16, 32.56, 32.63, 32.64, 32.96 |

## Components and slots

| Spelling | Meaning | Rules |
| --- | --- | --- |
| `{#component Name(pattern)}` | An inline component. | 32.39, 32.40, 32.41, 32.42, 32.43, 32.44, 32.45, 32.46, 32.47, 32.48, 32.49, 32.50, 32.51, 32.52, 32.53, 32.54, 32.55, 32.63, 32.64 |
| `<Name/>` | A component invocation. | 32.17, 32.34, 32.35, 32.36, 32.70, 33.19, 33.21, 41.24, 41.28 |
| `<slot/>` | The position children render into. | 32.18 |
| `<slot>fallback</slot>` | Renders children, or a fallback. | 32.18 |
| `<Tag>…</Tag>` | Children passed to a component's slot. | 32.18, 32.70 |

## `props`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `props` | `<Props>() => { [K in keyof Props]: Props[K] }` | One live accessor per prop the component declares. | 33.1, 33.2, 33.3, 33.4, 33.5, 33.6, 33.7, 33.8, 33.9, 33.10, 33.11, 33.14, 33.15, 33.20, 33.22, 33.25, 33.27 |
| `Attributes<Tag>` | `Attributes<Tag extends keyof HTMLElementTagNameMap \| keyof SVGElementTagNameMap>` | The attributes an HTML or SVG element takes, typed as a component's props. | 33.23, 33.24, 33.26 |
| `children` | always accepted | What a caller passes between the tags. | 33.16, 32.18 |

## Script and style blocks

| Spelling | Meaning | Rules |
| --- | --- | --- |
| `<script>` | Per-instance component setup. | 14.7, 34.1, 34.3, 34.12, 34.13, 34.14, 34.15, 34.17, 34.29, 34.30, 34.32 |
| `<script module>` | Module scope, and what the file exports beside its component. | 34.2, 34.3, 34.12, 34.14, 34.15, 34.18, 34.21, 34.30, 34.33, 34.34, 34.35 |
| `<script server>` | Module scope on a server alone, declaring its file's private handlers and filing its hooks. | 16.28, 16.70, 34.3, 34.12, 34.17, 34.19, 34.20, 34.22, 34.28, 34.29, 34.30, 37.1 |
| `<style>` | Component-scoped styles. | 34.4, 34.5, 34.10, 34.11, 34.31 |
| `import './app.css'` | A stylesheet the component depends on. | 34.6 |
| `:global(…)` | The per-selector escape from scoping. | 34.5 |

# Pages and routing

## Pages

| Path | Meaning | Rules |
| --- | --- | --- |
| `<head>` | A page's, layout's or component's contribution to the document head. | 39.1, 39.2, 39.3, 39.4, 39.5, 39.6, 39.11, 39.12, 39.13, 39.14, 39.15, 39.16, 39.17, 39.20 |
| `<window>` · `<document>` | A page's, layout's or component's listeners on the window or the document. | 39.21, 39.22, 39.23 |
| `view-transition-name` | What turns view transitions on, in the app's own stylesheet. | 39.7, 39.8, 39.9, 39.10, 39.18, 39.19 |
| `[name]` | A required dynamic segment. | 16.65, 23.5, 30.3, 30.34, 30.36 |
| `[[name]]` | An optional segment. | 23.5, 30.4, 30.34, 30.36 |
| `[...name]` | A rest segment, terminal. | 23.5, 30.5, 30.34, 30.36 |
| `[name=NAME]` · `[[name=NAME]]` · `[...name=NAME]` | A dynamic segment a param file's matcher decides. | 19.1, 23.26, 23.27, 30.19, 30.35, 30.36, 30.37 |
| `/__abide/**` | Every endpoint abide controls. | 20.8, 37.19 |

## Files

| Path | Meaning | Rules |
| --- | --- | --- |
| `src/**` | The app's source. | 36.10, 38.25 |
| `**/lib/**` | The app's code that is no address: components and modules. | 23.15, 23.16, 23.18, 23.22, 37.1 |
| `**/lib/**/<name>.server.<extension>` | A server file: source the browser never loads. | 16.29, 23.23, 34.20, 36.10 |
| `**/<name>.test.ts` | A test file: one of the app's tests, wherever it lies. | 23.22, 38.109 |
| `**/<name>.bench.ts` | A bench file: benches `bun run bench` runs, wherever it lies. | 23.22, 43.29 |
| `**/<name>.d.ts` | A declaration file: types for the checker, wherever it lies. | 23.22 |
| `**/public/**` | The files answered as authored, at their path below that directory. | 23.15, 23.16, 23.18, 36.11, 36.12, 36.13, 36.14, 36.15, 36.17, 21.12, 21.13, 21.14, 38.18, 38.19 |
| `src/public/favicon.ico` | The file answered at `/favicon.ico`. | 36.11 |
| `src/public/robots.txt` | The file answered at `/robots.txt`. | 36.11 |
| `src/public/icon.png` · `src/public/icon.icns` | The files answered at `/icon.png` and `/icon.icns`, and the native app's icon. | 36.11, 38.79, 45.15 |
| `src/**/` | A directory of the app's, a segment of the route of every file directly in it. | 23.14, 23.17, 23.22 |
| `**/index.abide` | The page at its directory's route. | 19.1, 23.3, 23.4, 23.14, 23.18, 35.19 |
| `**/<name>.abide` | The page at its directory's route and then `<name>`. | 19.1, 23.3, 23.4, 23.14, 23.21, 35.19 |
| `**/<NAME>.param.ts` | A param file: the matcher a segment naming `NAME` matches by. | 23.22, 23.24, 23.25, 23.26 |
| `**/<name>.handler.ts` | A handler file: the handler its default export declares, at its directory's route and then `<name>`. | 16.2, 16.28, 16.73, 16.74, 19.1, 23.14, 23.22 |
| `**/layout.abide` | A layout, rendering every page below its route through a slot, and the hooks over that route. | 35.1, 35.12, 35.13, 37.2, 41.11, 41.19, 41.23 |
| `src/native/` | The native app's own pages, which are no routes of the app's. | 23.15, 23.33 |
| `src/native/launcher.abide` | The native launcher: the `onLauncher` it calls, and its page in place of the launcher's own where it has markup. | 38.80, 38.82, 38.84, 38.85, 38.107 |
| `src/native/menubar.abide` | The page the menu bar extra's panel shows. | 38.167, 38.168, 38.169, 38.171, 38.176 |
| `src/public/icon-menubar.png` | The file answered at `/icon-menubar.png`, and the menu bar extra's icon. | 36.11, 38.166 |
| `src/layout.abide` | The root layout, whose `<script server>` is the app's own, and whose `<html>` is the document its pages are served in. | 35.15, 35.16, 35.17, 37.1, 37.3, 39.4 |
| `**/error.abide` | The page a refusal renders in. | 35.2, 35.3, 35.14, 35.18 |
| `**/node_modules/**/*.abide` | A component a dependency ships as source, compiled with the app that imports it. | 34.23, 34.24, 34.25, 34.26, 34.27, 38.99 |
| `import '…' with { type: 'routes' }` | A package's directory mounted at the importing file's directory, its pages, layouts, error pages and handler files answering below it. | 23.19, 23.20 |
| `bunfig.toml` | The file whose `[serve.static] plugins` the client is built with. | 38.43 |
| `preload = ["@abide/abide/test"]` | The `[test]` preload a test imports the app's `.abide` files through. | 38.109 |

## Worker files

| Path | Meaning | Rules |
| --- | --- | --- |
| `**/lib/**/<name>.worker.ts` | A worker file: a module whose exports run in a thread of their own. | 55.1, 55.2, 55.3, 55.4, 55.5, 55.6, 55.7, 55.8, 55.9, 55.10, 55.11, 55.12, 55.13, 55.14 |

## `render`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Component` | `interface Component {}` | A component bound to its props. | 32.17, 34.16, 35.4, 38.208 |
| `render` | `(component: Component) => Promise<Uint8Array>` | Renders a component bound to its props into a document, as its bytes. | 29.10, 35.4, 35.5, 35.6, 35.15, 35.16, 41.1, 41.2, 41.3, 41.4, 41.9, 41.13, 41.16, 41.17, 41.18, 41.19, 41.20, 41.28, 35.11, 41.29, 41.30, 41.31, 41.34, 41.35 |

## Sinks

| Spelling | Sink | Filled | Rules |
| --- | --- | --- | --- |
| `href={x}`, any attribute | the element | the attribute or property | 35.7, 35.8 |
| `class:`, `style:`, `bind:` | the element | the class, the style property, the bound property | 35.7 |
| `<title>{name}</title>` | the `<title>` | `.textContent` | 35.9, 35.10 |
| `<textarea>{v}</textarea>` | the `<textarea>` | `.defaultValue` | 35.9 |

## `route`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `route.url` | `Reactive<URL>` | Where we are, fragment included. | 23.1, 23.2, 23.3, 23.4, 30.20, 30.21, 30.23, 30.33, 19.16, 31.15 |
| `route.params` | `Reactive<Params>` | The matched route's segments — typed by its own route in a page or a layout, and `Params` in any other file. | 23.1, 23.5, 23.9, 30.23, 31.15 |
| `Params` | `Record<string, string \| string[]>` | What a matched route's segments are. | 23.5 |
| `route.name` | `Reactive<string>` | The resolution path, the same under any mount path. | 23.1, 23.6, 23.14, 31.15 |
| `route.index` | `Reactive<number>` | The place of the entry the address bar stands at in the history this app's router wrote. | 23.1, 23.28, 23.29, 31.15 |
| `route.navigating` | `Reactive<boolean>` | Whether a navigation is in flight. | 23.1, 31.15 |
| `route.query` | `<Defaults extends Record<string, string \| number \| boolean \| readonly string[]>>(defaults: Defaults) => Reactive<QueryOf<Defaults>, Partial<QueryOf<Defaults>>>` | The address's query as one value of its defaults' shape. | 30.41, 30.42, 30.43, 30.44, 30.45, 30.46, 30.47, 30.48, 31.8 |

The alias `route.query` widens its defaults through is declared rather than listed, not being a
name an app writes:
```ts
type QueryOf<Defaults> = { [Name in keyof Defaults]: Defaults[Name] extends string ? string : Defaults[Name] extends number ? number : Defaults[Name] extends boolean ? boolean : string[] }
```

## `url`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `url` | `<P extends RouteLiteral>(url?: P, ...rest: HasParams<P> extends true ? [params: ParamsOf<P>, queryParams?: Query, defaults?: Record<string, unknown>] : [params?: ParamsOf<P>, queryParams?: Query, defaults?: Record<string, unknown>]) => string` | Builds an address from a route literal or a public file's address. | 30.1, 30.2, 30.6, 30.8, 30.19, 30.26, 30.40 |
| `HasParams<P>` | `boolean` | Whether the literal carries a required segment. | 30.2 |
| `HasSegments<P>` | `boolean` | Whether the literal carries a segment of any kind. | 30.2 |
| `RequiredNames<P>` | `string` | The required segment names. | 30.3 |
| `OptionalNames<P>` | `string` | The optional segment names. | 30.4 |
| `RestNames<P>` | `string` | The rest segment names. | 30.5 |
| `Query` | `Record<string, unknown> \| URLSearchParams` | The query half. | 30.6, 30.28, 30.40 |
| `ParamsOf<P>` | `& { [K in RequiredNames<P>]: string \| number } & { [K in OptionalNames<P>]?: string \| number } & { [K in RestNames<P>]?: string \| number \| (string \| number)[] }` | What a route literal's segments accept, narrowed where `abide check` declares a matcher's literals. | 30.3, 30.4, 30.5 |
| `RouteParams<P>` | `{ [K in RequiredNames<P>]: string } & { [K in OptionalNames<P>]?: string } & { [K in RestNames<P>]: string[] }` | What a page filed under `P` reads its params as, narrowed where `abide check` declares a matcher's literals. | 23.9 |
| `Routes` | `interface Routes {}` | The app's route literals and public file addresses, which `abide check` declares. | 30.26 |
| `RouteLiteral` | `[keyof Routes] extends [never] ? string : Extract<keyof Routes, string>` | What `url` takes. | 30.26 |

## `navigate`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `navigate` | `{ (by: number): Promise<void>; (url?: URL \| string, options?: { replace?: boolean, keepScroll?: boolean }): Promise<void> }` | Navigates to an address, or steps through the history. | 30.7, 30.38, 30.39, 30.9, 30.10, 30.11, 30.12, 30.13, 30.14, 30.15, 30.16, 30.17, 30.18, 30.20, 30.21, 30.22, 30.23, 30.24, 30.25, 30.27, 30.29, 30.30, 30.31, 30.32, 45.12, 45.24 |

# Reactive primitives

## `reactive`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Reactive` | `Reactive<Stored = undefined, Accepted = Stored, Failures = never, Produced = Stored>` | The value type every producer in this design hands back. | 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 1.8, 9.1, 9.14 |
| `Keyed` | `Keyed<Stored, Args, Accepted = Stored, Failures = never, Produced = Stored>` | What a body declaring a parameter hands back: a factory carrying the probes and the triggers. | 4.13, 11.2, 11.4, 11.6, 11.23, 11.55 |
| `Accepted` | `unknown` | What a factory and a write take, before the gates run. | 4.1, 4.2 |
| `Stored` | `unknown` | What is held, and what a read returns. | 4.7, 5.2 |
| `Failures` | union of `Failed` | What a read hands back in place of a value. | 1.3 |
| `Shaped` | `unknown` | What a `transform` hands back: the value to store, or a refusal. | 4.6, 4.9 |
| `Produced` | `unknown` | What a production carries, where that differs from what is stored. | 1.2, 9.3 |
| `Args` | `Record<string, JsonValue> \| undefined` | The key of a keyed value. | 9.4, 11.24, 11.25, 11.26, 11.27, 11.29, 11.31, 11.64, 19.15 |
| `reactive` | `<Accepted, Shaped = Accepted, Gate = Schema<Accepted>>(initial: Held<Accepted> \| undefined, options?: Shaping<Accepted, Shaped, never, Gate>) => Reactive<Kept<Shaped>, Accepted, Refusals<Shaped, Gate, Accepted>>` | The value form, for what the scope owns outright, opening at `initial`, at what a promise of it settles to, or at `undefined`. | 4.1, 4.2, 4.14, 4.15, 4.16, 4.20 |
| `reactive` | `<Accepted>() => [Accepted extends Rpc<infer Value, infer Args, infer Failures, infer Produced> ? true : false] extends [true] ? Reactive<StoredOf<CallOf<Accepted>>, StoredOf<CallOf<Accepted>>, AdoptedFailures<CallOf<Accepted>>, AdoptedProduced<CallOf<Accepted>, StoredOf<CallOf<Accepted>>>> : Reactive<Kept<Accepted>, Accepted, Refused<Accepted>>` | The empty form, for a value nothing has written yet. | 4.14, 4.19 |
| `Transformer` | `<Accepted, Stored, Failures = never>(value: Accepted) => Stored \| Failures` | The shape of a `transform`. | 4.6, 4.7, 4.8 |
| `Shared` | `interface Shared {}` | The app's declaration-merged registry of shared keys. | 10.3 |
| `reactive.share` | `<Key extends string, Value>(key: Key, create: () => Reactive<Value>) => Key extends keyof Shared ? Reactive<Shared[Key]> : Reactive<Value>` | Get-or-create a reactive value in the component's scope by key. | 10.1, 10.2, 10.4, 10.5, 10.6, 10.7 |

The aliases `memo` reads what a body is through — its value, what it streams, and the value or
keyed value it builds — the one the value form turns a `Reactive` away with, those a transform's and
a body's return are split through, the one that adds a declared `schema`'s refusal, and the two the
empty form reads each `Rpc`'s call through, are declared rather than listed, none of them being a
name an app writes:
```ts
type Held<Accepted> = [Accepted] extends [{ invalidate: unknown }] ? never : Accepted | (PromiseLike<Accepted> & { invalidate?: never })
type BodyValue<Result> = Awaited<Result> extends AsyncGenerator<infer Chunk> ? Chunk[] : Awaited<Result>
type BodyProduced<Result, Otherwise> = Awaited<Result> extends AsyncGenerator<infer Chunk> ? Chunk : AdoptedProduced<Result, Otherwise>
type ReactiveOf<Args, Result, Shaped, Gate, ArgsGate> = [Args] extends [never] ? Reactive<Kept<Shaped>, BodyValue<Result>, AdoptedFailures<Result> | Refusals<Shaped, Gate, BodyValue<Result>>, BodyProduced<Result, Kept<Shaped>>> : Keyed<Kept<Shaped>, Args, BodyValue<Result>, AdoptedFailures<Result> | Refusals<Shaped, Gate, BodyValue<Result>, ArgsGate, Args>, BodyProduced<Result, Kept<Shaped>>>
type Kept<Shaped> = Exclude<Shaped, Failed<string, unknown>>
type Refused<Shaped> = Extract<Shaped, Failed<string, unknown>>
type AdoptedFailures<T> = T extends Reactive<unknown, never, infer Failures, unknown> ? Failures : never
type AdoptedProduced<T, Otherwise> = T extends Reactive<unknown, never, unknown, infer Produced> ? Produced : Otherwise
type Gated<Gate, Accepted> = [Schema<Accepted>] extends [Gate] ? never : Failed<'ValidationError', Issues<Accepted>>
type CallOf<Calls> = Calls extends Rpc<infer Value, infer Args, infer Failures, infer Produced> ? ReturnType<Rpc<Value, Args, Failures, Produced>> : never
type StoredOf<Calls> = Calls extends Reactive<infer Stored, never, unknown, unknown> ? Stored : never
```

### `ReactiveOptions`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `schema` | `Schema<Accepted>` | The gate on the way in. | 1.3, 4.3, 4.4, 4.5, 11.46, 11.47 |
| `transform` | `(value: Accepted) => Shaped` | The shaping on the way to storage. | 4.6, 4.7, 4.8, 4.9, 11.14 |
| `identity` | `(next: Stored, previous: Stored) => unknown` | What makes it the same value. | 5.1, 5.2, 5.3, 5.4, 5.5, 9.3, 11.17, 18.4 |
| `key` | `(keyof Element & string) \| ((element: Element) => unknown)`, over the `Element` a `Stored` array holds | What tells one element of the value from another. | 5.22, 18.4, 18.15, 32.32 |
| `ttl` | `number` | The life of a production, of a keyed entry, or of a write to a value with no producer. | 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 6.16, 11.6, 11.35, 11.45, 11.48, 11.49, 11.69 |
| `poll` | `number \| { every: number; after?: 'tick' \| 'settle'; delay?: number \| (() => number) }` | How often the value refreshes itself, in milliseconds, with the spacing between runs and a job's wait before its first. | 7.20, 7.21, 7.22, 7.23, 7.24, 7.25, 7.26, 7.27, 7.28, 7.29, 7.30, 7.31, 7.32, 7.33, 7.34, 7.35, 7.36, 7.37, 7.40, 7.41, 7.42, 7.43, 7.44 |
| `args` | `Schema<Args>` | The gate on a keyed value's args. | 9.4, 11.28, 11.30, 11.40, 11.41, 11.56, 11.60, 11.68, 11.72 |
| `global` | `boolean` | Opts out of the default scope into one cache shared by every caller in the process. | 11.34, 11.35, 11.36, 11.37, 11.38, 11.39, 11.53, 11.67, 26.24 |
| `tags` | `string[] \| ((args: Args) => string[])` | What a `Selection` matches on. | 11.43, 11.44, 13.15, 18.4, 18.15 |
| `throttle` | `number` | A ceiling on how often the value changes. | 5.8, 5.9, 5.11, 5.12, 5.14, 5.15, 5.17, 5.18, 5.19, 5.20, 5.21, 5.23, 5.24 |
| `debounce` | `number` | A wait for the changes to stop before the value changes. | 5.8, 5.9, 5.11, 5.13, 5.14, 5.15, 5.17, 5.18, 5.19, 5.20, 5.21, 5.23, 5.24 |

### Reads

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s` | `() => Stored` | Read the current value. | 2.1, 2.2, 2.3, 2.4, 2.9 |
| `s.peek` | `() => Stored \| undefined` | Read what is held without joining the flow. | 2.10, 2.11 |
| `NotLanded` | `Error & { name: 'NotLanded'; source: object }` | What a read throws where nothing has landed yet. | 2.9, 2.12, 2.13, 2.14, 7.8, 34.32 |
| `s.then` | `<Settled = Stored, Refused = never, Next = never>(onSettled?: (value: Stored) => Settled \| Reactive<Settled, any, Next, any> \| PromiseLike<Settled>, onFailed?: (error: unknown) => Refused \| PromiseLike<Refused>) => Reactive<Settled \| Refused, Settled \| Refused, Failures \| Next>` | The next step after the settling, as a value. | 1.4, 2.7, 2.8, 2.15, 2.16, 2.17, 2.18, 2.19, 2.20, 2.21, 2.22 |
| `s.catch` | `<Result>(onFailed: (error: unknown) => Result \| PromiseLike<Result>) => Reactive<Stored \| Result, Stored \| Result, Failures>` | The settling's refusal path. | 1.4, 1.5 |
| `s.finally` | `(onSettled: () => void) => Reactive<Stored, Stored, Failures>` | The settling's end, whichever way it went. | 1.4, 1.5 |
| `for await (… of s)` | `AsyncIterable<Produced>` | What one run produced: the settled value once, or a stream's chunks. | 2.5, 2.6, 5.10, 9.12, 9.15, 9.16, 9.17 |
| `s[Symbol.asyncIterator]` | `() => AsyncIterator<Produced>` | The run being served, from its start to its end. | 2.5, 2.6 |

### Writes

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s.set` | `(value: Accepted \| Promise<Accepted> \| Reactive<Accepted, unknown, Failures, unknown>) => void \| Failures` | Write the current value here, gated by `identity`. | 3.6, 4.1, 4.2, 4.9, 4.13, 4.17, 4.18, 5.6, 9.4, 9.11, 9.12, 11.59, 11.61, 11.65, 11.66, 11.70 |
| `s.patch` | `(mutate: (value: Stored) => void) => void` | Mutate the value in place. | 5.7, 5.23, 9.13, 11.59, 18.11, 18.13, 32.33 |

### Probes

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s.busy` | `() => boolean` | Work is in flight for this value. | 3.1, 3.2, 3.3, 3.4, 3.7, 3.9, 3.14, 5.15, 7.5, 7.8, 11.19, 11.20, 11.21, 11.22, 11.50 |
| `s.ready` | `() => boolean` | There is a value to serve. | 3.1, 3.2, 3.3, 3.5, 3.6, 3.8, 3.14, 7.8, 11.20, 11.54, 11.58 |
| `s.error` | `() => Failures \| undefined` | The standing refusal. | 3.1, 3.2, 3.3, 3.5, 3.14, 4.10, 4.11, 4.12 |
| `s.issues` | `() => Extract<Failures, { name: 'ValidationError'; data: unknown }>['data'] \| undefined` | The issues of the standing validation refusal. | 3.1, 3.2, 3.3, 3.15, 11.50 |
| `s.synced` | `() => boolean` | What is held is what the producer made. | 3.1, 3.2, 3.3, 3.10, 3.11, 3.12, 3.13, 3.14 |
| `s.isError` | `<Name extends Failures['name']>(error: unknown, name: Name) => error is Extract<Failures, { name: Name }>` | Whether a caught failure is the one named. | 3.1 |

### Triggers

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s.invalidate` | `() => void` | Drop the cache behind the value. | 7.1, 7.2, 7.3, 7.6, 7.7, 7.9, 7.10, 7.12, 7.13, 7.14, 7.15, 7.16, 7.17, 7.19, 11.51 |
| `s.refresh` | `() => void` | Reload while continuing to serve what is held. | 4.12, 7.1, 7.4, 7.5, 7.6, 7.11, 7.18, 11.51, 5.24 |

### Effects

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s.watch` | `(effect: (value: Stored) => void \| Disposer) => () => void` | `watch` narrowed to this value. | 5.1, 12.9 |

### The keyed face

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `k.busy` | `(pattern?: Partial<Args>) => boolean` | `busy` narrowed to matching entries. | 13.2, 13.3, 13.12 |
| `k.ready` | `(pattern?: Partial<Args>) => boolean` | `ready` narrowed to matching entries. | 13.11, 13.12 |
| `k.synced` | `(pattern?: Partial<Args>) => boolean` | `synced` narrowed to matching entries. | 13.12, 13.18 |
| `k.invalidate` | `(pattern?: Partial<Args>) => void` | `invalidate` narrowed to matching entries. | 7.2, 7.3, 13.4, 13.12 |
| `k.refresh` | `(pattern?: Partial<Args>) => void` | `refresh` narrowed to matching entries. | 7.4, 7.5, 13.4, 13.12 |

## `memo`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `memo` | `<Value = never, Args = never, Result = Value, Shaped = BodyValue<Result>, Gate = Schema<BodyValue<Result>>, ArgsGate = Schema<Args>>(body: (args: Args) => Result, options?: Shaping<BodyValue<Result>, Shaped, Args, Gate, ArgsGate>) => ReactiveOf<Args, Result, Shaped, Gate, ArgsGate>` | A value `body` produces, keyed where it declares a parameter and a stream where it hands back a generator. | 3.9, 11.1, 11.3, 11.5, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12, 11.13, 11.14, 11.15, 11.16, 11.17, 11.18, 11.19, 11.20, 11.21, 11.22, 11.32, 11.33, 11.50, 11.51, 11.52, 11.53, 11.54, 11.57, 11.58, 41.6, 11.62, 11.63, 11.65, 11.66, 12.14, 12.17, 19.24, 41.34, 41.35, 11.73, 3.7, 3.8, 4.8, 9.1, 9.2, 9.6, 9.7, 9.8, 9.9, 12.16, 11.2, 11.4, 11.6, 11.23, 11.55, 7.45, 7.46, 11.74 |

## `pipe`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `pipe` | `<const Steps extends readonly [Step, ...Step[]]>(steps: Steps, options?: PipeOptions<FirstIn<Steps>>) => Pipe<FirstIn<Steps>, LastOut<Steps>, AnyFans<Steps>>` | Steps an item runs through in order, at most `concurrency` items at once, as a function to call and a stream pair to pipe through. | 57.1, 57.2, 57.3, 57.4, 57.6, 57.7, 57.8, 57.9, 57.10, 57.11, 57.12, 57.13, 57.14 |
| `Pipe` | `Pipe<In, Out, Fanned extends boolean = false> = ((input: In, signal?: AbortSignal) => Reactive<Fanned extends true ? Out[] : Out, Fanned extends true ? Out[] : Out, Failed<string, unknown>>) & { readonly readable: ReadableStream<Out \| Failed<string, unknown>>; readonly writable: WritableStream<In>; readonly status: Reactive<PipeStatus>; stop(): Promise<void> }` | What `pipe` hands back: a call answering a `Reactive` of its item, and the stream pair. | 57.5, 57.13, 57.15, 57.16, 57.19, 57.20 |
| `Pipe.status` | `Reactive<PipeStatus>` | Where the pipe's items stand, one value for every caller. | 57.21 |
| `Pipe.stop` | `() => Promise<void>` | The end of the pipe, and of every attempt in flight. | 57.18 |
| `PipeOptions` | `<In = unknown>{ concurrency?: number; key?: (input: In) => string; ordered?: boolean; retries?: number; backoff?: number \| ((retry: number) => number); timeout?: number; paused?: Reactive<boolean> \| (() => boolean) }` | How many items run at once and by what key, the order they leave in, each step's retries, their spacing and its deadline, and what holds the pipe. | 57.6, 57.7, 57.9, 57.10, 57.12, 57.16, 57.17 |
| `PipeStatus` | `{ waiting: number; running: number; done: number; failed: number; paused: boolean }` | How many items wait, run, are done and failed, and whether the pipe is paused. | 57.21 |

The aliases `pipe` reads its steps through — what one place in the steps holds, what a step hands on,
whether one fans out, and the item a pipe takes and the answer it gives — are declared rather than
listed, none of them being a name an app writes:
```ts
type Step = ((input: never, signal: AbortSignal) => unknown) | Pipe<never, unknown, boolean> | readonly (((input: never, signal: AbortSignal) => unknown) | Pipe<never, unknown, boolean>)[]
type StepOut<S> = S extends readonly unknown[] ? { -readonly [K in keyof S]: StepOut<S[K]> } : S extends Pipe<never, infer Out, infer _Fanned> ? Exclude<Out, Failed<string, unknown>> : S extends (...given: never[]) => infer Result ? Awaited<Result> extends AsyncIterable<infer Chunk> ? Chunk : Exclude<Awaited<Result>, Failed<string, unknown>> : never
type StepFans<S> = S extends readonly unknown[] ? false : S extends Pipe<never, unknown, infer Fanned> ? Fanned : S extends (...given: never[]) => infer Result ? Awaited<Result> extends AsyncIterable<unknown> ? true : false : false
type AnyFans<Steps> = Steps extends readonly [infer First, ...infer Rest] ? StepFans<First> extends true ? true : AnyFans<Rest> : false
type StepIn<S> = S extends readonly (infer Member)[] ? StepIn<Member> : S extends Pipe<infer In, unknown, boolean> ? In : S extends (input: infer In, signal: AbortSignal) => unknown ? In : never
type LastOut<Steps> = Steps extends readonly [...unknown[], infer Last] ? StepOut<Last> : never
type FirstIn<Steps> = Steps extends readonly [infer First, ...unknown[]] ? StepIn<First> : never
```

## `ledger`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `ledger` | `<Entry>(options?: LedgerOptions<Entry>) => Ledger<Entry>` | Entries appended and never coalesced, read in order from a position or a named cursor. | 58.1, 58.9, 58.10, 58.11, 58.12 |
| `Ledger` | `<Entry>Reactive<Logged<Entry>[], never> & { append: (entry: Entry, options?: { key?: string }) => Promise<number>; read: (from?: number \| { cursor: string }) => ReadableStream<Logged<Entry>>; readonly writable: WritableStream<Entry> }` | What `ledger` hands back: the entries it keeps, the append, the read, and the stream an entry is written to. | 58.2, 58.4, 58.5, 58.6, 58.7, 58.8, 58.15, 58.16 |
| `LedgerOptions` | `<Entry>{ store?: LogStore; retain?: number; ttl?: number; schema?: Schema<Entry> }` | Where the entries are kept, how many are and for how long, and what an entry must be. | 58.3, 58.9, 58.10, 58.14 |
| `Logged` | `<Entry>{ seq: number; at: number; entry: Entry }` | One entry as a ledger keeps it: its number, when it was appended, and what it holds. | 58.2 |
| `LogStore` | `{ append: (entry: unknown, key: string \| undefined, at: number) => number \| Promise<number>; since: (seq: number) => Logged<unknown>[] \| Promise<Logged<unknown>[]>; last: () => number \| Promise<number>; position: (cursor: string, seq?: number) => number \| Promise<number>; trim: (through: number) => void \| Promise<void>; watch?: (changed: () => void) => () => void }` | The append face of a `store` a ledger keeps its entries and cursors in. | 58.9, 58.12 |

## `watch`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Disposer` | `() => void` | What tears down the previous run. | 12.1 |
| `Effect` | `() => void \| Disposer` | What runs on change. | 12.2, 12.8, 14.6 |
| `watch` | `(effect: Effect) => () => void` | Begins a watch over whatever the effect reads. | 12.2, 12.4, 12.5, 12.6, 12.7, 12.10, 12.13, 12.15, 12.18 |
| `watch` | `(sources: Reactive<unknown, never, unknown, unknown> \| Reactive<unknown, never, unknown, unknown>[], effect: Effect) => () => void` | The narrowed form, over named sources. | 12.3 |

## `store`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Store` | `{ get: () => Stored \| undefined \| Promise<Stored \| undefined>; set: (value: Stored, retention: { ttl: number }) => void \| Promise<void>; watch?: (changed: () => void) => () => void }` | Where a value lives when this process does not. | 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13, 8.14, 8.15, 8.16, 8.17, 8.18, 8.19, 8.20, 8.21 |
| `store` | `{ web; indexedDB; cookies }`, and `sqlite` and `redis` beside them from `@abide/abide/server` | The `Store`s abide ships, as one namespace. | 8.22, 8.25, 8.31, 8.34, 8.37, 8.43 |
| `store.web` | `<Stored>(key: string, options?: { area?: 'local' \| 'session'; schema?: Schema<Stored> }) => Store<Stored>` | A `Store` kept in the browser's Web Storage. | 8.22, 8.23, 8.24, 8.26, 8.27, 8.28, 8.29, 8.30 |
| `store.sqlite` | `<Stored>(database: Database \| (() => Database) \| string, key: string, options?: { table?: string; schema?: Schema<Stored> }) => Store<Stored> & LogStore` | A `Store` kept in a `bun:sqlite` table, a member of `@abide/abide/server`'s `store` alone. | 8.25, 8.26, 8.27, 8.28, 8.29, 8.41, 8.42, 58.9 |
| `store.redis` | `<Stored>(client: RedisClient \| string, key: string, options?: { schema?: Schema<Stored> }) => Store<Stored> & LogStore` | A `Store` kept in a Redis key through `bun`'s `RedisClient`, a member of `@abide/abide/server`'s `store` alone. | 8.26, 8.27, 8.28, 8.29, 8.30, 8.31, 8.32, 8.33, 58.9, 58.12, 58.13 |
| `store.indexedDB` | `<Stored>(key: string, options?: { table?: string; schema?: Schema<Stored> }) => Store<Stored> & LogStore` | A `Store` kept in the browser's IndexedDB. | 8.26, 8.27, 8.28, 8.29, 8.30, 8.34, 8.35, 8.36, 58.9, 58.12 |
| `store.cookies` | `<Stored>(name: string, options?: { path?: string; domain?: string; sameSite?: 'strict' \| 'lax' \| 'none'; secure?: boolean; schema?: Schema<Stored> }) => Store<Stored>` | A `Store` kept in a cookie. | 8.26, 8.27, 8.28, 8.29, 8.30, 8.37, 8.38, 8.39, 8.40 |
| `store` | `Store<Stored> \| ((args: Args) => Store<Stored>)` | The option that keeps a value in a `Store`, or a keyed value's entries one `Store` each. | 8.1, 8.2, 8.3, 8.14, 9.5, 11.42, 11.71 |

## `refuse`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `refuse.named` | `<Name extends string>(name: Name, status?: number, message?: string) => ((data?: undefined) => Failed<Name, undefined>) & { is: (error: unknown) => error is Failed<Name, undefined> }` | A reusable factory for a named, narrowable failure. | 15.3, 15.13, 15.18 |
| `refuse.named` | `<Name extends string, Data extends JsonValue>(name: Name, status: number \| undefined, message: string \| ((data: Data) => string) \| undefined, options: { schema: Schema<Data> }) => ((data?: Data) => Failed<Name, Data>) & { is: (error: unknown) => error is Failed<Name, Data> }` | A reusable factory for a named failure whose data its schema declares and checks. | 15.3, 15.11, 15.12, 15.13, 15.14, 15.15, 15.18 |
| `return myError(data)` | `Failed<Name, Data>` | The one spelling for every refusal. | 15.4, 15.5 |
| `refuse.notFound` | `(data?: { path: string; method: string }) => Failed<'NotFound', { path: string; method: string }>` | abide's own refusal for an address nothing answers. | 15.7, 15.9, 15.22 |
| `refuse.validation` | `<T>(data?: Issues<T>) => Failed<'ValidationError', Issues<T>>` | abide's own refusal for a schema or an `args` gate that refused, or a call's route parameter no segment can spell. | 15.8, 15.9 |
| `refuse.aborted` | `(data?: undefined) => Failed<'Aborted', undefined>` | abide's own refusal for a load every caller aborted, and for a client that left. | 15.9, 16.49, 16.63 |
| `myError(data)` DISCARDED | compile error | A `Failed` built and thrown away. | 15.10 |
| `refuse` | `(status: number, message?: string) => Failed<'HttpError', undefined>` | An undeclared refusal at a status. | 15.5, 15.9, 15.10, 15.16, 15.19, 15.20, 15.23, 16.40, 17.4, 17.5, 17.8 |

## `isFailed`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Failed<Name, Data>` | `Error & { name: Name; status: number; message: string; data: Data }` | The one refusal type, in-process and over a wire alike. | 15.1, 15.2, 15.6, 16.40, 16.41, 15.21, 15.24 |
| `isFailed` | `(value: unknown) => value is Failed<string, unknown>` | Whether a value is a refusal. | 15.6 |

## `busy`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `busy` | `(selection?: Selection, pattern?: Partial<Args>) => boolean` | Whether any entry in the selection has work in flight. | 13.2, 13.3, 13.5, 13.12, 41.28, 41.31, 46.11 |

## `ready`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `ready` | `(selection?: Selection, pattern?: Partial<Args>) => boolean` | Whether every entry in the selection has a value to serve. | 13.3, 13.5, 13.11, 13.12, 41.28, 41.31 |

## `synced`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `synced` | `(selection?: Selection, pattern?: Partial<Args>) => boolean` | Whether every entry in the selection holds what its producer made. | 13.12, 13.18 |

## `refresh`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Selection` | `Reactive<any, any, any, any> \| Keyed<any, any, any, any> \| Rpc<any, any, any, any> \| { tags: string[] }` | What `busy`, `ready`, `synced`, `refresh` and `invalidate` take: a value, a keyed value, a handler, or a set of tags. | 13.1, 13.8, 13.9, 13.13, 31.13 |
| `refresh` | `(selection?: Selection, pattern?: Partial<Args>) => void` | Stale-while-revalidate over the selection. | 13.4, 13.7, 13.10, 13.12, 13.14, 13.15, 13.16, 13.17, 13.20, 26.24, 7.40 |

## `invalidate`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `invalidate` | `(selection?: Selection, pattern?: Partial<Args>) => void` | Marks the selection stale. | 13.4, 13.6, 13.10, 13.12, 13.15, 13.17 |

## `isReactive`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `isReactive` | `(value: unknown) => value is Reactive<unknown>` | Whether a value is a `Reactive`. | 1.6 |

## Tracking

| Context | Meaning | Rules |
| --- | --- | --- |
| template expression | The flow itself. | 14.1, 14.2, 14.11, 14.17, 14.19, 32.25, 32.57 |
| branch-local `<script>` | An item's own setup scope. | 14.8, 34.7, 34.8, 34.9, 34.10, 34.32 |
| `memo` body, unkeyed | The unkeyed body's own scope. | 14.3, 14.11, 14.15, 14.16, 14.17, 14.19 |
| `memo` body, keyed | The keyed body's own scope. | 14.4 |
| block body binding | A live read, like a prop. | 14.5 |
| `watch` effect, bare | The effect's own scope. | 14.6, 14.14, 14.16, 14.19 |
| `watch` effect, over sources | The scope its sources narrow. | 12.3, 14.6 |
| component `<script>` setup | The component's own setup scope. | 14.7, 14.12, 14.13, 34.32 |
| event handler | Not the flow. | 14.9 |
| `Transformer`, `Disposer`, middleware, lifecycle hooks | Not the flow. | 14.10 |

# Headless components

## `dialog`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `dialog` | `(options?: DialogOptions) => DialogParts` | A native modal as a part an app spreads onto a `<dialog>` of its own, opened and closed by `open`. | 50.1, 50.2, 50.3, 50.4, 49.2, 49.4, 49.5, 49.6 |
| `DialogOptions` | `{ open?: Reactive<boolean>; modal?: boolean \| (() => boolean); dismissible?: boolean \| (() => boolean); onclose?: (returnValue: string) => void }` | Whether the dialog shows, and how it opens and closes. | 50.1, 50.2, 50.3 |
| `DialogParts` | `{ readonly dialog: Record<string, unknown>; readonly backdrop: Record<string, unknown>; readonly open: Reactive<boolean> }` | The `<dialog>`'s part, the part for an element inside it standing for its backdrop, and whether it is showing. | 32.11, 32.99, 50.3, 49.3, 49.8, 49.9 |

## `prompts`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `prompts.confirm` | `(asked: string \| PromptOptions) => Promise<boolean>` | A yes-or-no question shown where the app spreads `prompts.host`. | 50.5, 50.7, 50.8, 50.11, 50.36, 11.32 |
| `prompts.alert` | `(told: string \| PromptOptions) => Promise<void>` | A message shown where the app spreads `prompts.host` until it is closed. | 50.5, 50.7, 50.9, 50.11, 50.36, 11.32 |
| `prompts.prompt` | `(asked: string \| PromptOptions) => Promise<string \| undefined>` | A line of text asked for where the app spreads `prompts.host`. | 50.5, 50.7, 50.11, 50.33, 50.36, 11.32 |
| `PromptOptions` | `{ title?: string; body?: string; confirm?: string; cancel?: string; danger?: boolean; mustType?: string; value?: string; placeholder?: string; signal?: AbortSignal; modal?: boolean; run?: (answer: string) => unknown }` | What a prompt shows, what its buttons say, what withdraws it, whether it is modal, and the call confirming makes. | 50.7, 50.10, 50.34, 50.43, 50.44, 50.45 |
| `prompts.host` | `() => PromptsHost` | The `<dialog>` the queued prompts show in, as parts an app spreads onto markup of its own, from the script of the one component that shows them. | 50.6, 50.8, 50.9, 50.10, 50.34, 50.36, 50.45, 50.1, 50.2, 50.3, 50.4, 49.2, 49.4, 49.5, 49.6 |
| `PromptsHost` | `{ readonly dialog: Record<string, unknown>; readonly form: Record<string, unknown>; get current(): ShownPrompt \| undefined; get typing(): boolean; readonly title: Record<string, unknown>; readonly body: Record<string, unknown>; readonly field: Record<string, unknown>; readonly input: Record<string, unknown>; get failed(): string \| undefined; readonly error: Record<string, unknown>; readonly confirm: Record<string, unknown>; readonly cancel: Record<string, unknown>; readonly actions: Record<string, unknown> }` | The dialog's, the form's, the title's, the body's, the field's, the input's, the error's, the two buttons' and their holder's parts, the prompt showing, whether it asks for text, and what its `run` failed with. | 32.11, 32.99, 50.6, 50.10, 50.34, 50.45, 49.3, 49.9 |
| `ShownPrompt` | `Readonly<{ title: string \| undefined; body: string; confirm: string; cancel: string; danger: boolean; mustType: string \| undefined; value: string; placeholder: string \| undefined; modal: boolean; kind: 'confirm' \| 'alert' \| 'prompt' }>` | The prompt showing, as markup reads it. | 50.6 |

## `notices`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `notices` | `(options?: NoticesOptions) => Notices` | A list of notices, shown where the app spreads its `host`. | 50.12, 50.68, 50.70, 50.74 |
| `NoticesOptions` | `{ initial?: readonly (string \| ({ text: string } & NotifyOptions))[]; timeout?: number; store?: Store<Record<string, number>>; ttl?: number; key?: (notice: Notice) => string }` | The notices it starts with, how long a notice stays, and where, for how long and by what a dismissal is remembered. | 50.14, 50.69, 50.70, 50.71, 50.73 |
| `Notices` | `{ notify(text: string, options?: NotifyOptions): string; dismiss(id: string): void; readonly list: Reactive<Notice[]>; host(options?: NoticesHostOptions): NoticesHost }` | What adds a notice and takes one down, the notices added and not yet closed, and where they show. | 50.12, 50.13, 50.15, 50.16, 50.17, 50.36, 50.68, 11.32 |
| `NotifyOptions` | `{ id?: string; tone?: 'info' \| 'success' \| 'error'; timeout?: number; expires?: Date \| number; action?: { label: string; run: () => unknown }; attributes?: Record<string, string>; onclose?: (reason: CloseReason) => void }` | What tells a notice apart, its tone, how long it stays and the moment it stops showing, the one action it offers, the attributes on its element, and what hears it leave. | 50.12, 50.13, 50.14, 50.18, 50.41, 50.42, 50.71, 50.72 |
| `CloseReason` | `'timeout' \| 'dismissed' \| 'action'` | Why a notice left its list. | 50.42, 50.69 |
| `Notice` | `{ id: string; text: string; tone: 'info' \| 'success' \| 'error'; action: { label: string; run: () => unknown } \| undefined; attributes: Record<string, string>; expires: number }` | One notice a list holds. | 50.12, 50.41, 50.71, 50.72 |
| `NoticesHostOptions` | `{ label?: string \| (() => string) }` | The region's accessible name. | 50.17 |
| `NoticesHost` | `{ readonly region: Record<string, unknown>; get notices(): readonly Notice[]; notice(notice: Notice): NoticeParts }` | The region's part, the notices to render, and a notice's parts. | 32.11, 50.17, 50.18, 50.41, 49.2, 49.3, 49.4, 49.5, 49.6, 49.9 |
| `NoticeParts` | `{ readonly notice: Record<string, unknown>; readonly text: Record<string, unknown>; readonly action: Record<string, unknown>; readonly close: Record<string, unknown>; act(): void; dismiss(): void }` | A notice's, its text's, its action's and its close button's parts, and what runs its action or closes it. | 50.15, 50.17, 50.18, 50.41, 49.3, 49.9 |

## `toasts`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `toasts` | `Notices` | The notices abide builds for an app, every timeout its default. | 50.74 |

## `tooltip`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `tooltip.tip` | `(text: string, options?: TooltipOptions) => Record<string, unknown>` | The part opening a text hint for the element it is spread on, shown by the page's `tooltip.host`. | 32.99, 50.23, 50.24, 50.25, 50.36, 53.15, 49.3, 49.12 |
| `tooltip.host` | `() => TooltipHost` | The popover every hint shows in, as parts an app spreads onto markup of its own, from the script of the one component that shows them. | 50.19, 50.20, 50.21, 50.22, 50.26, 50.27, 50.35, 50.36, 50.47, 50.53, 49.14, 49.2, 49.4, 49.5, 49.6 |
| `TooltipHost` | `{ readonly hint: Record<string, unknown>; get text(): string \| undefined }` | The popover's part, and the text of the hint showing in it. | 32.11, 50.53, 50.54, 49.3, 49.9 |
| `TooltipOptions` | `{ align?: 'start' \| 'center' \| 'end' \| (() => 'start' \| 'center' \| 'end'); offset?: number \| (() => number); margin?: number \| (() => number); arrowInset?: number \| (() => number); side?: Side \| (() => Side); delay?: number \| (() => number) }` | Where a hint opens against its anchor, placed as a `popover` is, and how long a pointer rests first. | 50.19, 50.20, 50.21, 50.24, 50.26, 50.35, 49.10, 49.11 |

## `menu`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `menu` | `(options?: MenuOptions) => Menu` | WAI-ARIA's menu button as parts an app spreads onto elements of its own: a trigger and the menu it opens in a `popover`. | 50.28, 50.29, 50.30, 50.31, 50.32, 50.37, 50.38, 50.39, 50.40, 50.57, 50.58, 49.2, 49.4, 49.5, 49.6 |
| `MenuOptions` | `PopoverOptions & { group?: string \| (() => string \| undefined) }` | Where the menu opens and what opens and closes it, as a `popover` takes them, and the group it switches within. | 50.37, 49.8, 49.10, 49.11, 50.57 |
| `Menu` | `{ readonly id: string; readonly trigger: Record<string, unknown>; readonly anchor: Record<string, unknown>; readonly menu: Record<string, unknown>; readonly open: Reactive<boolean> }` | The base of its ids, the trigger's part, the anchor's, the menu's, and whether the menu is open. | 32.11, 50.37, 50.38, 49.3, 49.8, 49.9, 49.17 |

## `popover`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `popover` | `(options?: PopoverOptions) => PopoverParts` | An app's own overlay as parts it spreads onto a trigger or an anchor and a popover of its own, shown in the top layer against the one while `open` holds. | 50.19, 50.20, 50.21, 50.22, 50.26, 50.27, 50.35, 50.48, 50.55, 50.56, 50.59, 50.60, 50.75, 50.76, 32.99, 49.7, 49.12, 49.14, 49.2, 49.4, 49.5, 49.6 |
| `PopoverOptions` | `{ side?: Side \| (() => Side); align?: 'start' \| 'center' \| 'end' \| (() => 'start' \| 'center' \| 'end'); offset?: number \| (() => number); margin?: number \| (() => number); arrowInset?: number \| (() => number); id?: string; open?: Reactive<boolean>; escape?: boolean; outside?: boolean; openOnHover?: number \| false \| (() => number \| false); closeOnLeave?: number \| false \| (() => number \| false); openOnFocus?: boolean \| (() => boolean) }` | The side tried first, the edge lined up with, the gap to the anchor, the gap kept to the viewport and the gap the arrow keeps to the corners, the base of its ids, whether it is open, whether Escape and a press outside close it, and whether a resting pointer and focus open it and a leaving pointer closes it. | 50.19, 50.20, 50.21, 50.35, 50.55, 50.56, 50.60, 50.75, 49.8, 49.10, 49.11 |
| `PopoverParts` | `{ readonly id: string; readonly trigger: Record<string, unknown>; readonly anchor: Record<string, unknown>; readonly popover: Record<string, unknown>; readonly open: Reactive<boolean> }` | The base of its ids, the trigger's part, the anchor's, the popover's, and whether it is open. | 50.48, 50.59, 32.11, 49.3, 49.8, 49.9, 49.17 |
| `Side` | `'top' \| 'bottom' \| 'left' \| 'right'` | A side of an anchor. | 50.19, 50.20 |

## `drawer`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `drawer` | `(options?: DrawerOptions) => Drawer` | A `dialog` standing on an edge of the page, sized from a `resizable`'s handle on its inner edge and settling at its stops, as parts an app spreads onto a `<dialog>` and a handle of its own. | 50.61, 50.62, 50.63, 50.64, 49.2, 49.4, 49.5, 49.6 |
| `DrawerOptions` | `DialogOptions & { side?: 'start' \| 'end' \| 'top' \| 'bottom'; size?: Reactive<number \| undefined>; min?: number \| (() => number); max?: number \| (() => number); label?: string \| (() => string); stops?: readonly number[] \| (() => readonly number[]) }` | How it opens, the edge it stands on, its size and the bounds of it, the handle's accessible name, and the sizes it settles at as shares of the viewport's. | 50.61, 50.62, 50.63, 50.64, 49.8, 49.10, 49.11 |
| `Drawer` | `{ readonly drawer: Record<string, unknown>; readonly backdrop: Record<string, unknown>; readonly handle: Record<string, unknown>; readonly open: Reactive<boolean>; readonly size: Reactive<number \| undefined> }` | The dialog's part, its backdrop's, the handle's, whether it is showing, and its size. | 32.11, 50.61, 50.62, 49.3, 49.8, 49.9 |

## `lightbox`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `lightbox` | `<Item>(options: LightboxOptions<Item>) => Lightbox<Item>` | A `carousel` in a `dialog`, its arrow keys bound with `hotkeys` to the carousel's own buttons, as parts an app spreads onto a `<dialog>` and the carousel's markup of its own. | 50.65, 50.66, 50.67, 49.2, 49.4, 49.5, 49.6 |
| `LightboxOptions` | `<Item>CarouselOptions<Item> & { open?: Reactive<boolean> }` | The carousel's options, and whether it is showing. | 50.65, 49.8 |
| `Lightbox` | `<Item>Carousel<Item> & { readonly dialog: Record<string, unknown>; readonly backdrop: Record<string, unknown>; readonly open: Reactive<boolean>; show(key: string): void }` | The carousel's parts, the dialog's, its backdrop's, whether it is showing, and what opens it on an item. | 32.11, 50.65, 50.67, 49.3, 49.8, 49.9 |

## `commandPalette`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `commandPalette` | `(options: CommandPaletteOptions) => CommandPaletteParts` | WAI-ARIA's combobox in a modal dialog over the commands an app can run, as parts an app spreads onto elements of its own. | 51.65, 51.66, 51.67, 51.68, 51.69, 51.70, 51.71, 51.107, 49.7, 50.1, 50.2, 50.3, 50.4, 49.2, 49.4, 49.5, 49.6 |
| `CommandPaletteOptions` | `{ commands: readonly Command[] \| (() => readonly Command[]); open?: Reactive<boolean>; hotkey?: string \| (() => string); id?: string; label?: string \| (() => string) }` | What the palette lists, what opens it, and what it is called. | 51.65, 51.66, 49.10, 49.11 |
| `CommandPaletteParts` | `{ readonly id: string; readonly dialog: Record<string, unknown>; readonly input: Record<string, unknown>; readonly listbox: Record<string, unknown>; command(command: Command): CommandParts; readonly empty: Record<string, unknown>; get results(): readonly Command[]; readonly open: Reactive<boolean> }` | The dialog's part, the input's, the list's, a command's parts, the empty status, the commands listed and whether it shows. | 32.11, 51.66, 51.67, 49.3, 49.8, 49.9, 49.17 |
| `CommandParts` | `{ readonly option: Record<string, unknown>; readonly label: Record<string, unknown>; readonly key: Record<string, unknown>; readonly runs: readonly LabelRun[] }` | A command's option, the label and the key written in it, and the label in runs. | 51.67, 51.107, 49.3 |
| `Command` | `{ label: string; keywords?: readonly string[]; key?: string; run: () => void }` | One thing the palette can do: what it is called, the further words typing matches, the key shown beside it and what choosing it does. | 51.66, 51.68, 51.70 |

## `outlet`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `outlet.host` | `(name: string) => Record<string, unknown>` | The part for an element a layout owns, holding what `outlet.into` fills under its name. | 35.20, 35.22, 49.3, 49.12 |
| `outlet.into` | `(name: string) => Record<string, unknown>` | The part moving the element it is spread on into the `outlet.host` of its name. | 35.20, 35.21, 35.23, 35.24, 32.99, 49.3, 49.12 |

## `form`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `form` | `<Handler extends Rpc<any, any, any, any>>(handler: Handler) => Form<Handler>` | A form over a handler as parts an app spreads onto a `<form>` and fields of its own, checked against the handler's args document before the call is made. | 56.1, 56.2, 56.3, 56.4, 56.5, 56.6, 56.7, 56.8, 56.12, 56.14, 56.15, 56.18, 56.19, 56.23, 19.13, 49.3, 49.7, 49.9 |
| `FieldName` | `Handler extends Rpc<infer _Value, infer Args, infer _Failures, infer _Produced> ? keyof NonNullable<Args> & string : string` | The names a form's fields post under: the members of its handler's args. | 56.1 |
| `Form` | `{ readonly form: Record<string, unknown>; field(name: FieldName<Handler>): FormField; readonly error: Record<string, unknown>; get message(): string \| undefined; readonly submit: Record<string, unknown>; readonly reset: Record<string, unknown>; get dirty(): boolean; get changes(): Handler extends Rpc<infer _Value, infer Args, infer _Failures, infer _Produced> ? Partial<NonNullable<Args>> : Record<string, unknown>; get issues(): Issues<Handler> \| undefined; readonly call: ReturnType<Handler> }` | The form's part, a field's parts by name, the form's own message and its element, a submit button's and a reset button's parts, whether a field differs from its baseline and the args holding those that do, what is wrong with the form, and the last call it made. | 32.11, 56.4, 56.10, 56.11, 56.13, 56.16, 56.17, 56.20, 56.22, 49.9 |
| `FormField` | `{ readonly input: Record<string, unknown>; readonly error: Record<string, unknown>; get message(): string \| undefined; get invalid(): boolean; get changed(): boolean }` | One field's parts — the field's and its message element's — with its first message, whether it has one, and whether it differs from its baseline. | 56.9, 56.10, 56.13, 56.16, 56.21, 49.9 |

## `inlineEdit`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `inlineEdit` | `(options?: InlineEditOptions) => InlineEdit` | A value edited where it stands, as parts an app spreads onto a button showing it and an input editing it. | 56.24, 56.25, 56.26, 56.27, 56.28, 32.99, 49.2, 49.4, 49.5, 49.6 |
| `InlineEditOptions` | `{ value?: Reactive<string>; save?: (text: string) => unknown }` | The value, and what saves an edit of it. | 56.25, 56.26, 49.8 |
| `InlineEdit` | `{ readonly view: Record<string, unknown>; readonly input: Record<string, unknown>; readonly editing: Reactive<boolean>; readonly value: Reactive<string>; get busy(): boolean; get error(): string \| undefined }` | The button's part, the input's, whether it is being edited, the value, whether a save is in flight, and why the last one failed. | 32.11, 56.24, 56.26, 49.3, 49.8, 49.9 |

## `stepper`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `stepper` | `(options?: StepperOptions) => Stepper` | WAI-ARIA's spin button as parts an app spreads onto a field and the buttons either side of it. | 56.29, 56.30, 56.31, 56.32, 56.33, 49.2, 49.4, 49.5, 49.6, 49.15 |
| `StepperOptions` | `{ id?: string; value?: Reactive<number>; min?: number \| (() => number); max?: number \| (() => number); step?: number \| (() => number); label?: string \| (() => string) }` | The base of its id, the number, its bounds, how far a step moves it, and its accessible name. | 56.29, 56.30, 56.32, 56.33, 49.8, 49.10, 49.11 |
| `Stepper` | `{ readonly input: Record<string, unknown>; readonly decrement: Record<string, unknown>; readonly increment: Record<string, unknown>; readonly value: Reactive<number> }` | The field's part, the buttons stepping it down and up, and the number. | 32.11, 56.29, 56.31, 49.3, 49.8, 49.9 |

## `combobox`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `combobox` | `<Item>(options: ComboboxOptions<Item>) => ComboboxParts<Item>` | WAI-ARIA's combobox with a list popup as parts an app spreads onto an input, a popup and options of its own. | 51.13, 51.14, 51.15, 51.16, 51.17, 51.18, 51.19, 51.20, 51.21, 51.22, 51.23, 51.24, 51.25, 51.26, 51.27, 51.28, 51.29, 51.30, 51.31, 51.32, 51.33, 51.55, 51.56, 51.57, 51.92, 51.93, 51.106, 49.7, 49.14, 49.2, 49.4, 49.5, 49.6 |
| `ComboboxOptions` | `<Item, Multiple extends boolean = false>{ id?: string; options?: readonly Item[] \| (() => readonly Item[]); search?(query: string): readonly Item[] \| PromiseLike<readonly Item[]> \| Reactive<readonly Item[], unknown, unknown, unknown>; debounce?: number; key?(item: Item): string; label?(item: Item): string; multiple?: Multiple; value?: Reactive<Picked<Item, Multiple>> }` | What a combobox lists, how an item is told apart and written, and the pick it holds. | 51.15, 51.16, 51.18, 51.24, 51.55, 49.8, 49.10, 49.11, 49.16 |
| `ComboboxParts` | `<Item, Multiple extends boolean = false>{ readonly id: string; readonly root: Record<string, unknown>; readonly input: Record<string, unknown>; readonly open: Reactive<boolean>; readonly popup: Record<string, unknown>; readonly listbox: Record<string, unknown>; get items(): readonly Item[]; option(item: Item): Record<string, unknown>; runs(item: Item): readonly LabelRun[]; get nothingFound(): boolean; readonly empty: Record<string, unknown>; readonly value: Reactive<Picked<Item, Multiple>>; readonly chips: Record<string, unknown>; chip(item: Item): ComboboxChip }` | The parts `combobox` hands back: its id, the field's wrapper, the input, whether it is open, the popup, the list, an option, an item's label in runs, the empty status, the pick, the element holding the chips and a picked item's chip. | 51.26, 51.30, 51.31, 51.56, 51.57, 51.106, 32.99, 49.3, 49.8, 49.9, 49.17 |
| `ComboboxChip` | `{ readonly chip: Record<string, unknown>; readonly remove: Record<string, unknown> }` | A picked item's chip, and the button taking it out. | 51.56, 49.3 |
| `Picked` | `Picked<Item, Multiple extends boolean> = Multiple extends true ? readonly Item[] : Item \| undefined` | What a pick holds: every one picked where it picks many, else the one picked or none. | 51.55, 51.98 |
| `LabelRun` | `{ readonly text: string; readonly match: Record<string, unknown> \| undefined }` | A stretch of a label, and the `match` part of the element marking it where it is what was typed. | 51.106, 51.107, 49.3 |

## `tabs`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `tabs` | `<Item>(options: TabsOptions<Item>) => Tabs<Item>` | WAI-ARIA's tabs as parts an app spreads onto elements of its own: a tab list, a tab per item, and a panel. | 51.34, 51.35, 51.36, 51.37, 51.38, 51.39, 51.40, 51.41, 51.42, 49.7, 49.2, 49.4, 49.5, 49.6 |
| `TabsOptions` | `<Item>{ id?: string; items: readonly Item[] \| (() => readonly Item[]); key?: (item: Item) => string; selected?: Reactive<string \| undefined> }` | The tabs in order, how each is told apart, and the key of the one selected. | 51.34, 51.35, 49.8, 49.16 |
| `TabParts` | `{ readonly button: Record<string, unknown>; readonly panel: Record<string, unknown> }` | One tab's button, and the panel kept for it alone. | 51.40, 49.3 |
| `Tabs` | `<Item>{ readonly id: string; readonly list: Record<string, unknown>; tab(item: Item): TabParts; readonly panel: Record<string, unknown>; readonly selected: Reactive<string \| undefined> }` | The list's part, a tab's parts, the one panel every tab shows in, and the key of the tab selected. | 32.11, 51.34, 51.40, 51.41, 49.3, 49.8, 49.9 |

## `toggle`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `toggle` | `(options?: ToggleOptions) => Toggle` | WAI-ARIA's toggle button, or its switch, as a part an app spreads onto a button of its own. | 51.108, 51.109, 49.2, 49.4, 49.5, 49.6 |
| `ToggleOptions` | `{ pressed?: Reactive<boolean>; role?: 'button' \| 'switch' \| (() => 'button' \| 'switch') }` | Whether the button is pressed, and whether it reads as a toggle button or a switch. | 51.109, 49.8, 49.10, 49.11 |
| `Toggle` | `{ readonly button: Record<string, unknown>; readonly pressed: Reactive<boolean> }` | The button's part, and whether it is pressed. | 32.11, 51.108, 49.3, 49.8, 49.9 |

## `toggleGroup`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `toggleGroup` | `<Item, Multiple extends boolean = false>(options: ToggleGroupOptions<Item, Multiple>) => ToggleGroup<Item, Multiple>` | Toggle buttons over a set of items as parts an app spreads onto a group and a button per item of its own, picking one as a radio group does or picking many. | 51.110, 51.111, 51.112, 51.113, 51.114, 51.115, 49.2, 49.4, 49.5, 49.6 |
| `ToggleGroupOptions` | `<Item, Multiple extends boolean = false>{ id?: string; items: readonly Item[] \| (() => readonly Item[]); key?: (item: Item) => string; multiple?: Multiple; value?: Reactive<Picked<string, Multiple>>; label?: string \| (() => string) }` | The items in order, how each is told apart, whether it picks many, what it picks, and its accessible name. | 51.110, 51.115, 49.8, 49.10, 49.11, 49.16 |
| `ToggleGroup` | `<Item, Multiple extends boolean = false>{ readonly id: string; readonly group: Record<string, unknown>; item(item: Item): Record<string, unknown>; readonly value: Reactive<Picked<string, Multiple>> }` | The group's part, an item's button, and what is picked. | 32.11, 51.110, 51.111, 49.3, 49.8, 49.9 |

## `disclosure`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `disclosure` | `(options?: DisclosureOptions) => Disclosure` | WAI-ARIA's disclosure as parts an app spreads onto a button and a region of its own: the button shows and hides the region. | 51.116, 51.117, 51.118, 51.119, 49.2, 49.4, 49.5, 49.6 |
| `DisclosureOptions` | `{ id?: string; open?: Reactive<boolean> }` | The base of its ids, and whether the region is open. | 51.116, 49.8 |
| `Disclosure` | `{ readonly id: string; readonly button: Record<string, unknown>; readonly region: Record<string, unknown>; readonly open: Reactive<boolean> }` | The base of its ids, the button's part, the region's, and whether the region is open. | 32.11, 51.116, 51.117, 49.3, 49.8, 49.9 |

## `accordion`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `accordion` | `<Multiple extends boolean = false>(options?: AccordionOptions<Multiple>) => Accordion<Multiple>` | WAI-ARIA's accordion as a `disclosure` per key an app spreads onto a button and a region of its own, at most one open unless `multiple`. | 51.120, 51.121, 49.2, 49.4, 49.5, 49.6 |
| `AccordionOptions` | `<Multiple extends boolean = false>{ id?: string; multiple?: Multiple; open?: Reactive<Picked<string, Multiple>> }` | The base of its ids, whether many may be open, and which are. | 51.121, 49.8 |
| `Accordion` | `<Multiple extends boolean = false>{ readonly id: string; item(key: string): Disclosure; readonly open: Reactive<Picked<string, Multiple>> }` | The base of its ids, a key's disclosure, and which keys are open. | 32.11, 51.120, 49.3, 49.8, 49.9 |

## `clamp`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `clamp` | `(options?: ClampOptions) => Clamp` | Text cut to a few lines and a `disclosure`'s button showing the rest, as parts an app spreads onto its own. | 51.122, 51.123, 51.124, 32.99, 49.2, 49.4, 49.5, 49.6 |
| `ClampOptions` | `{ lines?: number \| (() => number); open?: Reactive<boolean>; id?: string }` | The lines shown while it is shut, whether all of it shows, and the base of its ids. | 51.122, 49.8, 49.10, 49.11 |
| `Clamp` | `{ readonly text: Record<string, unknown>; readonly button: Record<string, unknown>; readonly open: Reactive<boolean>; get overflowing(): boolean }` | The text's part, the button's, whether all of it shows, and whether there is more than the lines show. | 32.11, 51.122, 51.123, 49.3, 49.8, 49.9 |

## `spoiler`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `spoiler` | `(options?: SpoilerOptions) => Spoiler` | Content covered by a button of the app's own in its place until the button is pressed, as parts an app spreads onto both. | 51.152, 51.153, 51.154, 51.155, 32.99, 49.2, 49.4, 49.5 |
| `SpoilerOptions` | `{ open?: Reactive<boolean> }` | Whether the content shows. | 51.152, 49.8 |
| `Spoiler` | `{ readonly cover: Record<string, unknown>; readonly content: Record<string, unknown>; readonly open: Reactive<boolean> }` | The cover's part, the content's, and whether the content shows. | 32.11, 51.152, 51.153, 49.3, 49.8, 49.9 |

## `pages`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `pages` | `(options: PagesOptions) => Pages` | Pagination as parts an app spreads onto a nav and links or buttons of its own: a link per page listed, and one to the page before and after. | 51.125, 51.126, 51.127, 51.128, 51.129, 49.2, 49.4, 49.5, 49.6, 49.15 |
| `PagesOptions` | `{ count: number \| (() => number); page?: Reactive<number>; around?: number \| (() => number); href?: (page: number) => string; label?: string \| (() => string) }` | How many pages there are, the one on, how many around it are listed, each page's address, and the nav's accessible name. | 51.125, 51.126, 51.129, 49.8, 49.10, 49.11 |
| `Pages` | `{ readonly nav: Record<string, unknown>; get items(): readonly (number \| 'gap')[]; link(page: number): Record<string, unknown>; readonly previous: Record<string, unknown>; readonly next: Record<string, unknown>; readonly page: Reactive<number> }` | The nav's part, the pages listed, a page's link, the links before and after, and the page on. | 32.11, 51.125, 51.127, 51.128, 49.3, 49.8, 49.9, 49.17 |

## `playback`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `playback` | `(options: PlaybackOptions) => Playback` | A clock and its controls as parts an app spreads onto a play button, a scrubber, a row of speeds and a host for its keys, composed of `toggle`, `toggleGroup` and `hotkeys`. | 51.130, 51.131, 51.132, 51.133, 51.134, 51.135, 49.2, 49.4, 49.5, 49.6 |
| `PlaybackOptions` | `{ duration: number \| (() => number); at?: Reactive<number>; playing?: Reactive<boolean>; rate?: Reactive<number>; rates?: readonly number[] \| (() => readonly number[]); loop?: boolean \| (() => boolean); step?: number \| (() => number) }` | How long it runs, where it is, whether and how fast it plays, the speeds offered, whether it starts over, and what an arrow key moves it by. | 51.130, 51.131, 51.134, 51.135, 49.8, 49.10, 49.11 |
| `Playback` | `{ readonly root: Record<string, unknown>; readonly play: Record<string, unknown>; readonly scrubber: Record<string, unknown>; readonly speed: ToggleGroup<number>; readonly at: Reactive<number>; readonly playing: Reactive<boolean>; readonly rate: Reactive<number> }` | The key host's part, the play button's, the scrubber's, the speeds, where it is, whether it plays, and how fast. | 32.11, 51.132, 51.133, 51.134, 49.3, 49.8, 49.9 |

## `breadcrumbs`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `breadcrumbs` | `<Crumb>(options: BreadcrumbsOptions<Crumb>) => Breadcrumbs<Crumb>` | A trail of links to the page as parts an app spreads onto a nav and links of its own, its middle folded into a `menu` past `max`. | 51.136, 51.137, 51.138, 51.139, 51.140, 49.2, 49.4, 49.5, 49.6 |
| `BreadcrumbsOptions` | `<Crumb>{ trail: readonly Crumb[] \| (() => readonly Crumb[]); href: (crumb: Crumb) => string; max?: number \| (() => number); label?: string \| (() => string) }` | The crumbs from the top down, where each leads, how many show before the middle folds, and the nav's accessible name. | 51.136, 51.138, 51.140, 49.10, 49.11 |
| `Breadcrumbs` | `<Crumb>{ readonly nav: Record<string, unknown>; get items(): readonly (Crumb \| 'overflow')[]; get folded(): readonly Crumb[]; link(crumb: Crumb): Record<string, unknown>; readonly overflow: Menu; menuItem(crumb: Crumb): Record<string, unknown> }` | The nav's part, the crumbs shown, the crumbs folded, a crumb's link, the overflow's menu, and a folded crumb's menu item. | 32.11, 51.136, 51.137, 51.138, 51.139, 49.3, 49.9, 49.17 |

## `scrollSpy`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `scrollSpy` | `<Item>(options: ScrollSpyOptions<Item>) => Sections<Item>` | The section of a long page scrolled to, as a link per section an app spreads onto a nav of its own, the one scrolled to marked. | 51.169, 51.170, 51.171, 51.172, 51.173, 51.174, 51.175, 51.176, 51.177, 32.99, 49.2, 49.3, 49.4, 49.5 |
| `ScrollSpyOptions` | `<Item>{ items: readonly Item[] \| (() => readonly Item[]); key?: (item: Item) => string; behavior?: 'auto' \| 'smooth' \| (() => 'auto' \| 'smooth'); scrub?: boolean \| (() => boolean) }` | The sections in the order they stand, how one is told apart and its element found by id, how a jump scrolls, and whether a drag along the links scrubs them. | 51.169, 51.175, 51.167, 49.8, 49.10, 49.11, 49.16 |
| `Sections` | `<Section>{ readonly host: Record<string, unknown>; get all(): readonly Section[]; get current(): string \| undefined; jump(section: Section): Record<string, unknown> }` | A jump index over sections: its host, every section, the key of the one in view, and a section's jump. | 51.95, 51.167, 51.168, 49.3, 49.9, 49.17 |

## `wizard`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `wizard` | `<Step>(options: WizardOptions<Step>) => Wizard<Step>` | A task taken in steps as parts an app spreads onto markup of its own: a marker per step, a button on and back, and a `meter` of progress. | 51.141, 51.142, 51.143, 51.144, 49.2, 49.4, 49.5, 49.6, 49.15 |
| `WizardOptions` | `<Step>{ steps: readonly Step[] \| (() => readonly Step[]); key?: (step: Step) => string; current?: Reactive<string \| undefined>; valid?: (step: Step) => boolean }` | The steps in order, how each is told apart, the key of the one on, and whether one may be left forward. | 51.141, 51.142, 49.8, 49.10, 49.16 |
| `Wizard` | `<Step>{ step(step: Step): Record<string, unknown>; readonly next: Record<string, unknown>; readonly previous: Record<string, unknown>; readonly progress: Meter; readonly current: Reactive<string \| undefined>; get last(): boolean }` | A step's marker, the buttons on and back, the meter of progress, the step on, and whether it is the last. | 32.11, 51.141, 51.142, 51.143, 51.144, 49.3, 49.8, 49.9, 49.17 |

## `sortableList`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `sortableList` | `<Item, Multiple extends boolean = false>(options: SortableListOptions<Item, Multiple>) => SortableList<Item, Multiple>` | A `listbox` put in order by hand, as parts an app spreads onto a list, its items and a grip on each: Alt with the arrows moves the items, a grip drags them, the selection moving as one, lists of one group trading items, each move read out through `announce`. | 51.145, 51.146, 51.147, 51.148, 51.149, 51.150, 51.151, 51.178, 51.179, 51.180, 51.181, 51.182, 51.183, 32.99, 49.2, 49.4, 49.5, 49.6 |
| `SortableListOptions` | `<Item, Multiple extends boolean = false>{ items: readonly Item[] \| (() => readonly Item[]); order?: Reactive<readonly string[]>; multiple?: Multiple; selected?: Reactive<Picked<string, Multiple>>; group?: string \| (() => string \| undefined); key?(item: Item): string; label?(item: Item): string }` | The items, the order of their keys, whether many may be selected and which are, the group of lists it trades items with, and how each is told apart and read out. | 51.145, 51.147, 51.149, 51.150, 51.178, 51.179, 51.180, 51.181, 49.8, 49.10, 49.16 |
| `SortableItem` | `{ readonly item: Record<string, unknown>; readonly handle: Record<string, unknown> }` | An item's part, a `listbox` option, and its grip's. | 51.146, 51.150, 51.151, 49.3 |
| `SortableList` | `<Item, Multiple extends boolean = false>{ readonly list: Record<string, unknown>; item(item: Item): SortableItem; get sorted(): readonly Item[]; readonly order: Reactive<readonly string[]>; readonly selected: Reactive<Picked<string, Multiple>> }` | The list's part, an item's parts, the items in the order put, the order of their keys, and the keys selected. | 32.11, 51.145, 51.150, 49.3, 49.8, 49.9 |

## `tree`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `tree` | `<Node, Multiple extends boolean = false>(options: TreeOptions<Node, Multiple>) => Tree<Node, Multiple>` | WAI-ARIA's tree as parts an app spreads onto elements of its own: the tree, an item per node, and the group holding a node's children. | 51.77, 51.78, 51.79, 51.80, 51.81, 51.82, 51.83, 51.84, 51.98, 51.99, 51.100, 51.101, 51.102, 51.103, 49.7, 49.2, 49.4, 49.5, 49.6 |
| `TreeOptions` | `<Node, Multiple extends boolean = false>{ id?: string; roots: readonly Node[] \| (() => readonly Node[]); children(node: Node): readonly Node[] \| undefined; key?(node: Node): string; label?(node: Node): string; expanded?: Reactive<readonly string[]>; multiple?: Multiple; selected?: Reactive<Picked<string, Multiple>> }` | The nodes, how each is told apart and named, which are expanded, and whether one or many are selected and which. | 51.77, 51.79, 51.82, 51.83, 51.98, 49.8, 49.11, 49.16 |
| `Tree` | `<Node, Multiple extends boolean = false>{ readonly id: string; readonly tree: Record<string, unknown>; node(node: Node): TreeNode; get shown(): readonly Node[]; readonly expanded: Reactive<readonly string[]>; readonly selected: Reactive<Picked<string, Multiple>> }` | The tree's part, a node's parts, the nodes that show, and which nodes are expanded and which are selected. | 51.77, 51.78, 51.84, 51.98, 51.156, 49.3, 49.8, 49.9 |
| `TreeNode` | `{ readonly item: Record<string, unknown>; readonly group: Record<string, unknown>; get expanded(): boolean; toggle(): void }` | A node's item and group, whether it is expanded, and what expands or collapses it. | 51.77, 51.78, 51.84, 49.3, 49.17 |

## `jsonInspector`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `jsonInspector` | `(options: JsonInspectorOptions) => JsonInspector` | A JSON value to search and inspect as parts an app spreads onto elements of its own: a search field, and `tree`'s tree and an item per row, a row per value. | 51.157, 51.158, 51.159, 51.160, 51.161, 51.163, 49.7, 49.2, 49.4, 49.5, 49.6 |
| `JsonInspectorOptions` | `{ id?: string; value: JsonValue \| (() => JsonValue); query?: Reactive<string>; expanded?: Reactive<readonly string[]>; selected?: Reactive<string \| undefined> }` | The value inspected, what it is searched for, the pointers of the rows expanded, and the pointer of the row picked. | 51.157, 51.161, 51.165, 49.8, 49.10, 49.11 |
| `JsonInspector` | `{ readonly id: string; readonly search: Record<string, unknown>; readonly tree: Record<string, unknown>; get rows(): readonly JsonRow[]; row(row: JsonRow): JsonRowParts; get matches(): readonly JsonRow[]; get inspected(): JsonRow \| undefined; readonly query: Reactive<string>; readonly expanded: Reactive<readonly string[]>; readonly selected: Reactive<string \| undefined> }` | The search field's part, the tree's, the rows that show, a row's parts, the rows matching, the row picked, and what is searched for, expanded and picked. | 51.158, 51.159, 51.160, 51.163, 51.164, 49.3, 49.8, 49.9 |
| `JsonRow` | `{ readonly pointer: string; readonly key: string \| number \| undefined; readonly value: JsonValue; readonly kind: JsonKind; readonly size: number \| undefined; readonly level: number }` | A value of the document: its JSON Pointer, the key or index it is under, the value, its kind, how many entries it holds, and its depth. | 51.157 |
| `JsonKind` | `'object' \| 'array' \| 'string' \| 'number' \| 'boolean' \| 'null'` | What a JSON value is. | — |
| `JsonRowParts` | `{ readonly item: Record<string, unknown>; get keyRuns(): readonly LabelRun[]; get valueRuns(): readonly LabelRun[]; get expanded(): boolean; toggle(): void }` | A row's item, its key and value in runs, whether it is expanded, and what expands or collapses it. | 51.158, 51.160, 51.162, 49.3 |

## `range`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `range` | `(options: RangeOptions) => RangeParts` | WAI-ARIA's multi-thumb slider as parts an app spreads onto elements of its own: a group, a track, the span between the thumbs, two thumbs and a field for each. | 51.85, 51.86, 51.87, 51.88, 51.89, 51.90, 51.91, 49.7, 49.2, 49.4, 49.5, 49.6 |
| `RangeOptions` | `{ id?: string; value?: Reactive<readonly [number, number]>; label: string \| (() => string); min?: number \| (() => number); max?: number \| (() => number); step?: number \| (() => number); labels?: readonly [string, string] \| (() => readonly [string, string]); format?: (value: number) => string; name?: string \| (() => string \| undefined) }` | The range picked, and the scale it is picked on. | 51.85, 51.86, 51.91, 49.8, 49.10, 49.11 |
| `RangeParts` | `{ readonly id: string; readonly root: Record<string, unknown>; readonly track: Record<string, unknown>; readonly fill: Record<string, unknown>; end(which: 0 \| 1): RangeEnd; readonly value: Reactive<readonly [number, number]> }` | The group's part, the track's, the span's, an end's parts, and the range picked. | 32.11, 51.90, 49.3, 49.8, 49.9 |
| `RangeEnd` | `{ readonly thumb: Record<string, unknown>; readonly input: Record<string, unknown> }` | An end's thumb, and the hidden field submitting it. | 51.90, 51.91, 49.3 |

## `listbox`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `listbox` | `<Option, Multiple extends boolean = false>(options: ListboxOptions<Option, Multiple>) => Listbox<Option, Multiple>` | A keyboard controller over a list of keyed options, for markup the app writes itself. | 51.1, 51.2, 51.3, 51.4, 51.5, 51.6, 51.7, 51.8, 51.9, 51.10, 51.11, 51.12, 51.98, 51.99, 51.100, 51.101, 51.102, 51.103, 51.104, 51.105, 49.7, 49.2, 49.4, 49.5, 49.6 |
| `ListboxOptions` | `ListboxOptions<Option, Multiple extends boolean = false> = { id?: string; options: readonly Option[] \| (() => readonly Option[]); key?: (option: Option) => string; wrap?: boolean \| (() => boolean); multiple?: Multiple; selected?: Reactive<Picked<string, Multiple>>; onpick?: (option: Option) => void; onescape?: () => void }` | What `listbox` is handed: the options, what tells them apart, whether one or many are selected and which, and what Enter and Escape call. | 51.1, 51.6, 51.8, 51.9, 51.10, 51.98, 51.104, 51.105, 49.8, 49.10, 49.11, 49.16 |
| `Listbox` | `Listbox<Option, Multiple extends boolean = false> = { readonly id: string; readonly active: string \| undefined; readonly activeOption: Option \| undefined; readonly activeId: string \| undefined; activate: (key: string) => void; idOf: (key: string) => string; onkeydown: (event: KeyboardEvent) => void; readonly listbox: Record<string, unknown>; option(option: Option): Record<string, unknown>; readonly selected: Reactive<Picked<string, Multiple>> }` | What `listbox` hands back: its id, the active key and option, the ids and the listener the markup takes, the list's part and an option's, and the keys selected. | 51.1, 51.2, 51.3, 51.10, 51.11, 51.94, 51.98, 51.104, 49.3, 49.8, 49.9, 49.13, 49.16 |

## `calendar`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `calendar` | `<Range extends boolean = false>(options?: CalendarOptions<Range>) => Calendar<Range>` | WAI-ARIA's date grid as parts an app spreads onto elements of its own, picking a day or a range: a grid of whole weeks per month shown, a header cell per weekday, a cell per day, each month's heading and the buttons paging them. | 52.82, 52.83, 52.84, 52.85, 52.86, 52.87, 52.88, 52.89, 52.90, 52.91, 52.92, 52.93, 52.94, 52.95, 52.96, 52.97, 52.98, 52.99, 49.7, 49.2, 49.4, 49.5, 49.6 |
| `CalendarOptions` | `CalendarOptions<Range extends boolean = false> = { id?: string; month?: Reactive<string \| undefined>; range?: Range; selected?: Reactive<CalendarPick<Range>>; months?: number \| undefined \| (() => number \| undefined); firstDay?: number \| undefined \| (() => number \| undefined); locale?: string \| undefined \| (() => string \| undefined); timeZone?: string \| undefined \| (() => string \| undefined) }` | The first month shown as `YYYY-MM`, whether it picks a range, the day or the range picked, how many months are shown, and the week's first day, locale and zone, each read live where a function is given. | 52.84, 52.85, 52.87, 52.96, 52.97, 49.8, 49.10, 49.11 |
| `Calendar` | `Calendar<Range extends boolean = false> = { readonly id: string; get active(): string; idOf(date: string): string; get months(): readonly CalendarMonth[]; readonly previous: Record<string, unknown>; readonly next: Record<string, unknown>; readonly header: Record<string, unknown>; readonly week: Record<string, unknown>; get weekdays(): readonly CalendarWeekday[]; readonly month: Reactive<string \| undefined>; readonly selected: Reactive<CalendarPick<Range>> }` | The day in the tab order and a day's cell id, the months shown, the paging buttons, the rows' parts, the weekdays as data with a part to spread, and the first month shown and the day or range picked. | 32.11, 52.85, 52.87, 52.93, 52.96, 52.100, 49.3, 49.8, 49.9 |
| `CalendarPick` | `CalendarPick<Range extends boolean> = Range extends true ? readonly [start: string, end: string \| undefined] \| undefined : string \| undefined` | What a calendar picks: a range's start and end where it picks a range, else a day or none. | 52.97 |
| `CalendarMonth` | `{ readonly month: string; readonly label: string; readonly heading: Record<string, unknown>; readonly grid: Record<string, unknown>; readonly weeks: readonly (readonly CalendarDay[])[] }` | A month shown as `YYYY-MM`, its name in words, its heading's part, its grid's, and its weeks. | 52.82, 52.94, 52.96, 49.3 |
| `CalendarWeekday` | `{ readonly day: number; readonly name: string; readonly short: string; readonly header: Record<string, unknown> }` | A weekday's number from Monday's `1`, its name in full and shortened, and its header cell. | 52.87, 49.3 |
| `CalendarDay` | `{ readonly date: string; readonly day: number; readonly cell: Record<string, unknown> }` | A day of a grid as `YYYY-MM-DD`, its number in its month, and its cell. | 52.82, 52.84, 52.86, 52.95, 52.96, 52.98, 52.99, 49.3, 49.17 |

## `carousel`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `carousel` | `<Item>(options: CarouselOptions<Item>) => Carousel<Item>` | A scroll-snap carousel resting on a selection and following the item a scroll aligns, as parts an app spreads onto a scroller, its items, a button either side and one that plays and pauses. | 53.61, 53.62, 53.63, 53.64, 53.65, 53.66, 53.67, 53.68, 53.69, 53.70, 53.71, 53.72, 53.73, 53.74, 53.76, 53.78, 53.99, 53.100, 53.101, 32.99, 49.3, 49.7, 49.2, 49.4, 49.5, 49.6, 49.15 |
| `CarouselOptions` | `<Item>{ id?: string; items: readonly Item[] \| (() => readonly Item[]); key?: (item: Item) => string; label?: (item: Item) => string; selected?: Reactive<string \| undefined>; align?: 'start' \| 'center' \| 'end' \| (() => 'start' \| 'center' \| 'end'); behavior?: 'auto' \| 'smooth' \| (() => 'auto' \| 'smooth'); loop?: boolean \| (() => boolean); autoplay?: number \| undefined \| (() => number \| undefined); playing?: Reactive<boolean> }` | The items, how each is told apart and named, the key of the one the carousel rests on, which part of an item lines up with the scroller, how a scroll to an item moves, whether stepping past an end goes to the other, the milliseconds between steps it takes by itself, and whether it is taking them. | 53.61, 53.62, 53.67, 53.68, 53.71, 53.73, 53.75, 53.99, 49.8, 49.10, 49.11, 49.16 |
| `Carousel` | `<Item>{ readonly id: string; readonly host: Record<string, unknown>; item(item: Item): Record<string, unknown>; readonly previous: Record<string, unknown>; readonly next: Record<string, unknown>; readonly play: Record<string, unknown>; readonly playing: Reactive<boolean>; get current(): string \| undefined; readonly selected: Reactive<string \| undefined>; scrollTo(key: string): void; reset(): void }` | The scroller's part, an item's part, the two buttons' parts, the play button's part, whether it is playing, the key of the item aligned, the key it rests on, and what scrolls to an item and back. | 53.63, 53.67, 53.68, 53.69, 53.75, 53.77, 49.3, 49.8, 49.9 |

## `sortableTable`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `sortableTable` | `<Row>(options: SortableTableOptions<Row>) => SortableTableParts<Row>` | A table sorted by its headers and picked by its rows, as parts an app spreads onto a `<table>` of its own. | 51.49, 51.50, 51.51, 51.52, 51.53, 51.54, 51.72, 51.73, 51.74, 51.75, 51.76, 49.2, 49.4, 49.5, 49.6 |
| `SortableTableOptions` | `<Row>{ rows: readonly Row[] \| (() => readonly Row[]); columns: readonly Column<Row>[] \| (() => readonly Column<Row>[]); key?(row: Row): string; sort?: Reactive<Sort \| undefined>; selected?: Reactive<readonly string[] \| undefined> }` | The rows and columns of a sortable table, how a row is told apart, and its sort and selection. | 51.49, 51.72, 49.8, 49.16 |
| `SortableTableParts` | `<Row>{ readonly table: Record<string, unknown>; get rows(): readonly Row[]; column(column: Column<Row>): SortableTableColumn; row(row: Row): SortableTableRow; text(row: Row, column: Column<Row>): string; readonly selectAll: { readonly select: Record<string, unknown>; readonly checkbox: Record<string, unknown> }; readonly sort: Reactive<Sort \| undefined>; readonly selected: Reactive<readonly string[] \| undefined> }` | The parts `sortableTable` hands back: the table, the rows in sorted order, a column's parts, a row's parts, a cell's text, the header's checkbox and its cell, and the sort and the selection. | 51.49, 51.50, 51.51, 51.52, 51.53, 51.54, 51.72, 51.75, 32.99, 49.3, 49.8, 49.9 |
| `SortableTableColumn` | `{ readonly header: Record<string, unknown>; readonly sort: Record<string, unknown>; readonly cell: Record<string, unknown> }` | A column's header cell, its sort button, and its body cells. | 51.49, 51.50, 51.51, 51.52, 49.3 |
| `Column` | `Column<Row> = { key: string; label: string; align?: 'start' \| 'end'; value?: (row: Row) => unknown; format?: (value: unknown, row: Row) => string; sortable?: boolean; firstDirection?: 'ascending' \| 'descending' }` | One column of a sortable table: its header, what it sorts by and what its cells show. | 51.47, 51.50, 51.53, 51.54 |
| `Sort` | `{ key: string; direction: 'ascending' \| 'descending' }` | The column a table is sorted by, and its direction. | 51.49, 51.50, 51.51, 51.52 |
| `SortableTableRow` | `{ readonly row: Record<string, unknown>; readonly select: Record<string, unknown>; readonly checkbox: Record<string, unknown>; readonly detail: Record<string, unknown> }` | A row's part, the cell holding its checkbox, the checkbox, and a detail row under it. | 51.72, 51.74, 49.3 |

## `virtualList`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `virtualList` | `<Item>(options: VirtualListOptions<Item>) => VirtualList<Item>` | A long list's items that are in view, measured from the app's own markup — a list or a CSS grid — as parts to spread, for a keyed `{#for}` over just those items. | 51.58, 51.59, 51.60, 51.61, 51.62, 51.63, 51.96, 51.97, 51.166, 32.99, 49.3 |
| `VirtualListOptions` | `<Item>{ items: readonly Item[] \| (() => readonly Item[]); key?: (item: Item) => string; section?: (item: Item) => string; labels?: readonly string[] \| (() => readonly string[]); overscan?: number \| (() => number); initial?: number; estimate?: number; behavior?: 'auto' \| 'smooth' \| (() => 'auto' \| 'smooth'); scrub?: boolean \| (() => boolean) }` | The items, how one is told apart and grouped, the rows past each end, what renders before a measurement, how a jump scrolls, and whether a drag along the jumps scrubs them. | 51.58, 51.60, 51.64, 51.167, 49.10, 49.11, 49.16 |
| `VirtualList` | `<Item>{ readonly host: Record<string, unknown>; item(entry: VirtualListEntry<Item>): Record<string, unknown>; get shown(): readonly VirtualListEntry<Item>[]; readonly sections: Sections<VirtualListSection>; scrollTo(index: number): void }` | The host's part, an item's part, the items to render, the sections and their jumps, and what scrolls to an item. | 51.58, 51.62, 51.63, 49.9 |
| `VirtualListEntry` | `<Item>{ item: Item; index: number; key: string }` | One item `shown` renders: the item, where it stands in `items`, and its key. | 51.58 |
| `VirtualListSection` | `{ label: string; index: number }` | One section: its label, and the index of its first item, or `-1` where it has none. | 51.64 |

## `time`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `time` | `(options?: TimeOptions) => TimeParts` | Times kept current as parts an app spreads onto a `<time>` of its own, one per value: its `datetime` and `title`, and its label. | 52.1, 52.2, 52.3, 52.5, 52.72, 52.73, 52.74, 52.75, 52.76, 52.77, 52.113, 49.2, 49.4, 49.5, 49.6 |
| `TimeOptions` | `{ style?: 'long' \| 'short' \| 'narrow' \| (() => 'long' \| 'short' \| 'narrow'); locale?: string \| undefined \| (() => string \| undefined); timeZone?: string \| undefined \| (() => string \| undefined) }` | How a time is written, each read live where a function is given. | 52.72 |
| `TimeParts` | `{ at(value: unknown): TimeAt }` | A value's parts. | 32.11, 32.99, 52.72, 52.73, 49.9 |
| `TimeAt` | `{ readonly time: Record<string, unknown>; get text(): string }` | A value's `<time>` attributes and its label. | 32.99, 52.72, 52.73, 49.3 |

## `chat`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `chat` | `(options: ChatOptions) => ChatParts` | A conversation over an assistant handler as parts an app spreads onto markup of its own: the transcript and the composer. | 53.31, 53.32, 53.33, 53.34, 53.35, 53.36, 53.37, 53.38, 53.39, 53.40, 53.46, 53.47, 49.3, 49.2, 49.4, 49.5, 49.6 |
| `ChatOptions` | `{ ask: (args: { messages: AssistantMessage[] }, options: { signal: AbortSignal }) => AsyncIterable<AssistantEvent>; permit?: (answer: { id: string; allow: boolean }) => unknown; messages?: Reactive<AssistantMessage[]>; label?: string \| (() => string \| undefined); disabled?: boolean \| (() => boolean \| undefined) }` | The handler a conversation asks, what answers a permission prompt, the messages it holds, and its input's name and whether it sends. | 53.31, 53.34, 53.38, 53.47, 49.8, 49.10 |
| `ChatParts` | `{ readonly messages: Reactive<AssistantMessage[]>; get streaming(): boolean; get stop_reason(): string \| undefined; get failed(): string \| undefined; readonly root: Record<string, unknown>; readonly transcript: Record<string, unknown>; readonly jump: Record<string, unknown>; message(message: AssistantMessage, index: number): ChatMessageParts; readonly text: Record<string, unknown>; image(image: AssistantContent): Record<string, unknown>; document(document: AssistantContent): Record<string, unknown>; tool(call: AssistantContent): { readonly tool: Record<string, unknown>; readonly name: Record<string, unknown>; readonly input: Record<string, unknown>; readonly result: Record<string, unknown>; readonly status: 'running' \| 'done' \| 'failed'; readonly toolResult: AssistantContent \| undefined; readonly answer: string \| undefined }; get permissions(): readonly ChatPermission[]; permission(prompt: ChatPermission): { readonly permission: Record<string, unknown>; readonly name: Record<string, unknown>; readonly input: Record<string, unknown>; readonly allow: Record<string, unknown>; readonly deny: Record<string, unknown>; readonly answer: 'waiting' \| 'allowed' \| 'denied' }; readonly failure: Record<string, unknown>; readonly composer: Record<string, unknown>; readonly input: Record<string, unknown>; readonly draft: Reactive<string>; get attached(): readonly AssistantContent[]; readonly attachments: Record<string, unknown>; attachment(attached: AssistantContent): { readonly attachment: Record<string, unknown>; readonly image: Record<string, unknown>; readonly remove: Record<string, unknown> }; get pending(): readonly AssistantContent[] \| undefined; readonly queued: Record<string, unknown>; readonly cancel: Record<string, unknown>; readonly stop: Record<string, unknown>; readonly send: Record<string, unknown> }` | The conversation and whether it streams, why its latest answer ended or failed, its permission prompts, and the parts of the transcript, each message and block, and the composer. | 53.24, 53.25, 53.26, 53.27, 53.30, 53.32, 53.33, 53.34, 53.35, 53.36, 53.37, 53.39, 53.40, 49.1, 49.3, 49.9 |
| `ChatMessageParts` | `{ readonly message: Record<string, unknown>; readonly speaker: Record<string, unknown>; readonly role: 'you' \| 'assistant'; readonly shown: boolean; get blocks(): readonly AssistantContent[]; get streaming(): boolean; get ends(): boolean; readonly actions: Record<string, unknown>; retry(): void }` | A message's parts, who spoke, whether it is shown, its blocks, whether it streams or ends an answer, and what asks its question again. | 53.24, 53.28, 53.29, 53.46, 49.1, 49.3 |
| `ChatPermission` | `{ id: string; name: string; input: unknown; allowed: boolean \| undefined }` | A permission prompt Claude Code asks the page, and the visitor's answer. | 53.26, 53.38 |

## `chart`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `chart` | `(options: ChartOptions) => ChartParts` | A chart over one pair of axes as its geometry and parts an app spreads onto elements, with the arithmetic under it as its members. | 52.24, 52.25, 52.26, 52.27, 52.28, 52.29, 52.30, 52.34, 52.37, 52.38, 52.39, 50.46, 52.51, 52.52, 52.58, 52.59, 52.60, 52.61, 52.62, 52.63, 52.68, 52.69, 52.70, 52.71, 52.78, 52.79, 52.81, 52.19, 52.20, 52.21, 52.22, 52.23, 52.53, 49.14, 49.2, 49.4, 49.5, 49.6, 52.116, 52.118, 52.119 |
| `ChartOptions` | `{ id?: string; label: string \| (() => string); series: readonly { label: string; values: readonly (number \| null \| undefined)[]; kind?: 'line' \| 'column' \| 'area'; stack?: string \| false; curve?: boolean; format?: (value: number, index: number) => string }[] \| (() => readonly { label: string; values: readonly (number \| null \| undefined)[]; kind?: 'line' \| 'column' \| 'area'; stack?: string \| false; curve?: boolean; format?: (value: number, index: number) => string }[]; x?: readonly number[] \| (() => readonly number[] \| undefined); xFormat?: (x: number) => string; yFormat?: (y: number) => string; xTicks?: number \| (() => number); yTicks?: number \| (() => number); zero?: boolean \| (() => boolean); pad?: number \| readonly [number, number] \| (() => number \| readonly [number, number]); stack?: boolean \| (() => boolean); normalize?: boolean \| (() => boolean); bounds?: { x?: readonly [number, number]; y?: readonly [number, number] } \| (() => { x?: readonly [number, number]; y?: readonly [number, number] } \| undefined); width?: number; height?: number; onpick?: (index: number) => void; disabled?: (index: number) => boolean }` | What `chart` draws and how, each value read live where a function is given. | 52.24, 52.61, 49.8, 49.10, 49.11, 52.118, 52.119 |
| `ChartParts` | `{ readonly id: string; readonly svg: Record<string, unknown>; x(value: number): number; y(value: number): number; get frame(): { left: number; top: number; right: number; bottom: number }; get yTicks(): { value: number; y: number; label: string; grid: Record<string, unknown>; text: Record<string, unknown> }[]; get xTicks(): { index: number; x: number; label: string; text: Record<string, unknown> }[]; get zero(): { y: number; line: Record<string, unknown> } \| undefined; get marks(): { series: number; label: string; kind: 'line' \| 'column' \| 'area'; d: string; path: Record<string, unknown>; columns: Record<string, unknown>; bars: { key: string; series: number; index: number; value: number; x: number; y: number; width: number; height: number; rect: Record<string, unknown> }[] }[]; get lines(): { series: number; label: string; kind: 'line' \| 'column' \| 'area'; d: string; path: Record<string, unknown>; columns: Record<string, unknown>; bars: { key: string; series: number; index: number; value: number; x: number; y: number; width: number; height: number; rect: Record<string, unknown> }[] }[]; get areas(): { series: number; label: string; kind: 'line' \| 'column' \| 'area'; d: string; path: Record<string, unknown>; columns: Record<string, unknown>; bars: { key: string; series: number; index: number; value: number; x: number; y: number; width: number; height: number; rect: Record<string, unknown> }[] }[]; get bars(): { key: string; series: number; index: number; value: number; x: number; y: number; width: number; height: number; rect: Record<string, unknown> }[]; get points(): { key: string; series: number; index: number; value: number; x: number; y: number; circle: Record<string, unknown> }[]; get readout(): { index: number; x: number; label: string; disabled: boolean; heading: Record<string, unknown>; values: { series: number; label: string; value: string; y: number \| undefined; circle: Record<string, unknown> \| undefined; text: Record<string, unknown> }[] } \| undefined; get crosshair(): { index: number; x: number; line: Record<string, unknown> } \| undefined; readonly tip: Record<string, unknown> }` | The root's part, the plot's scales and edges, and every tick, mark, point and the crosshair as data with a part to spread. | 50.46, 52.78, 52.79, 52.81, 49.3, 49.9, 52.116 |
| `chart.ticks` | `(min: number, max: number, count?: number) => number[]` | Round values for an axis from `min` to `max`, about `count` intervals apart. | 52.19 |
| `chart.scale` | `(domain: readonly [number, number], range: readonly [number, number]) => (value: number) => number` | The linear map from `domain` onto `range`. | 52.20 |
| `chart.path` | `(xs: readonly number[], ys: readonly (number \| null \| undefined)[], options?: { baseline?: number \| readonly number[]; curve?: boolean }) => string` | An SVG path through the points `xs[i]`, `ys[i]`, or the area under them down to `baseline`, straight from point to point or curved through them. | 52.21, 52.22, 52.104 |
| `chart.stack` | `<Each extends { values: readonly (number \| null \| undefined)[]; stack?: string \| false }>(series: readonly Each[], options?: { stack?: boolean; normalize?: boolean }) => { low: (number \| undefined)[]; high: (number \| undefined)[]; stack: string \| undefined }[]` | Where each series stands at each x once its stack is piled, and the stack it joined. | 52.53, 52.54, 52.55, 52.56, 52.57 |
| `chart.nearest` | `(positions: readonly number[], x: number) => number` | The index of the position nearest `x` in positions sorted ascending. | 52.23 |
| `chart.Series` | `{ label: string; values: readonly (number \| null \| undefined)[]; kind?: 'line' \| 'column' \| 'area'; stack?: string \| false; curve?: boolean; format?: (value: number, index: number) => string }` | One series of a chart: what it is called, its values in x order, how it is drawn, and the stack it piles into. | 52.21, 52.24, 52.54, 52.118 |

## `pie`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `pie` | `(options: PieOptions) => PieParts` | Shares of a whole as the slices of a pie or a donut, as parts an app spreads onto SVG elements of its own. | 52.29, 52.30, 52.38, 52.39, 52.62, 52.63, 52.64, 52.65, 52.66, 52.67, 52.80, 52.81, 49.2, 49.4, 49.5, 49.6 |
| `PieOptions` | `{ slices: readonly { label: string; value: number \| null \| undefined }[] \| (() => readonly { label: string; value: number \| null \| undefined }[]); label: string \| (() => string); inner?: number \| (() => number); valueFormat?: (value: number) => string; onpick?: (index: number) => void; disabled?: (index: number) => boolean }` | What `pie` draws, each value read live where a function is given. | 52.66 |
| `PieParts` | `{ readonly svg: Record<string, unknown>; get slices(): { index: number; label: string; value: number; share: number; hint: string; circle: Record<string, unknown> }[] }` | The `<svg>`'s part and every slice drawn as data with its circle's part. | 52.64, 52.80, 49.3, 49.9 |

## `sparkline`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `sparkline` | `(options: SparklineOptions) => SparklineParts` | A trend with no axes, stretched to its box, as parts an app spreads onto elements. | 52.29, 52.30, 52.31, 52.33, 52.34, 52.81, 49.2, 49.4, 49.5, 49.6, 52.116, 52.119 |
| `SparklineOptions` | `{ values: readonly (number \| null \| undefined)[] \| (() => readonly (number \| null \| undefined)[]); label: string \| (() => string); zero?: boolean \| (() => boolean); kind?: 'line' \| 'bar' \| (() => 'line' \| 'bar'); curve?: boolean \| (() => boolean); pad?: number \| readonly [number, number] \| (() => number \| readonly [number, number]) }` | What `sparkline` draws, each value read live where a function is given. | 52.33, 52.34, 52.105, 52.119 |
| `SparklineParts` | `{ readonly svg: Record<string, unknown>; readonly line: Record<string, unknown>; readonly area: Record<string, unknown>; readonly bars: Record<string, unknown>; readonly dot: Record<string, unknown>; get trend(): 'up' \| 'down' \| 'flat'; get ended(): boolean }` | The `<svg>`'s part, the line, the area, the bars and the end dot as parts, and the trend. | 52.31, 49.3, 49.9, 52.116 |

## `meter`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `meter` | `(options: MeterOptions) => Meter` | WAI-ARIA's meter, or its progress bar, as parts an app spreads onto a track and a fill of its own. | 52.106, 52.107, 52.108, 52.109, 49.2, 49.4, 49.5, 49.6, 52.117 |
| `MeterOptions` | `{ value: number \| undefined \| (() => number \| undefined); min?: number \| (() => number); max?: number \| (() => number); low?: number \| (() => number); high?: number \| (() => number); role?: 'meter' \| 'progressbar' \| (() => 'meter' \| 'progressbar'); label?: string \| (() => string) }` | The value, the range it falls in, the bands marking it low or high, whether it is progress, and its accessible name. | 52.106, 52.107, 52.109, 49.10, 49.11 |
| `Meter` | `{ readonly meter: Record<string, unknown>; readonly fill: Record<string, unknown>; get fraction(): number \| undefined }` | The track's part, the fill's, and how far along the range the value is. | 32.11, 52.106, 52.108, 49.3, 49.9, 52.117 |

## `dropzone`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `dropzone` | `(options?: DropzoneOptions) => DropzoneParts` | Files dropped on an element, pasted into it, or picked through a file input, as parts an app spreads onto a host and an input of its own. | 53.17, 53.18, 53.19, 53.20, 53.45, 53.56, 53.57, 49.3, 49.8, 49.9 |
| `DropzoneOptions` | `{ accept?: string; paste?: boolean \| (() => boolean); multiple?: boolean \| (() => boolean); files?: Reactive<readonly File[]>; onfiles?: (files: File[], event: Event) => void; onreject?: (files: File[], event: Event) => void }` | Which files a drop, a paste or a pick takes, the files it binds, and what hears them. | 53.19, 53.20, 53.45, 53.56, 49.8, 49.10, 49.11 |
| `DropzoneParts` | `{ readonly host: Record<string, unknown>; readonly input: Record<string, unknown>; readonly files: Reactive<readonly File[]>; readonly rejected: readonly File[] }` | The drop target's part, a file input's part, the files taken last, and the files turned away last. | 53.17, 53.18, 53.45, 53.56, 53.57, 49.3, 49.9 |

## `autoscroll`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `autoscroll` | `(options?: AutoscrollOptions) => Autoscroll` | A scrolling element kept at its bottom as what it holds grows, until the reader scrolls up, and a button taking them back down, as parts to spread. | 32.99, 53.50, 53.58, 53.59, 53.60, 49.3, 49.8 |
| `AutoscrollOptions` | `{ following?: Reactive<boolean>; threshold?: number \| (() => number); behavior?: 'auto' \| 'smooth' \| (() => 'auto' \| 'smooth') }` | Whether the scroller is following, how near its bottom counts as at it, and how a jump scrolls. | 53.58, 53.60, 49.8, 49.10, 49.11 |
| `Autoscroll` | `{ readonly host: Record<string, unknown>; readonly jump: Record<string, unknown>; readonly following: Reactive<boolean>; toBottom(): void }` | The scroller's part, the jump button's part, whether it is following, and what takes it back down. | 53.50, 53.59, 53.60, 49.9 |

## `resizable`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `resizable` | `(options?: ResizableOptions) => Resizable` | WAI-ARIA's window splitter as parts an app spreads onto a panel and a handle of its own: dragging the handle, or its keys, sizes the panel. | 53.80, 53.81, 53.82, 53.83, 53.84, 53.85, 53.86, 49.2, 49.4, 49.5, 49.6 |
| `ResizableOptions` | `{ id?: string; axis?: 'x' \| 'y'; edge?: 'start' \| 'end'; size?: Reactive<number \| undefined>; min?: number \| (() => number); max?: number \| (() => number); keep?: number \| (() => number); step?: number \| (() => number); label?: string \| (() => string) }` | The axis it sizes, the edge its handle stands on, its size, the bounds it keeps to, how far a key moves it, and the handle's accessible name. | 53.80, 53.81, 53.82, 53.83, 49.8, 49.10, 49.11 |
| `Resizable` | `{ readonly id: string; readonly panel: Record<string, unknown>; readonly handle: Record<string, unknown>; readonly size: Reactive<number \| undefined> }` | The base of its ids, the panel's part, the handle's, and the panel's size. | 32.11, 53.80, 53.86, 49.3, 49.8, 49.9 |

## `panZoom`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `panZoom` | `(options?: PanZoomOptions) => PanZoom` | A surface moved and magnified by its wheel, its pointers and its keys, as parts an app spreads onto a surface and the content inside it. | 53.92, 53.93, 53.94, 53.95, 53.96, 53.97, 53.98, 32.99, 49.2, 49.4, 49.5, 49.6 |
| `PanZoomOptions` | `{ view?: Reactive<PanZoomView>; min?: number \| (() => number); max?: number \| (() => number); label?: string \| (() => string) }` | Where it stands, the bounds of its magnification, and the surface's accessible name. | 53.95, 49.8, 49.10, 49.11 |
| `PanZoomView` | `{ readonly x: number; readonly y: number; readonly k: number }` | Where the content stands in the surface: moved by `x` and `y` pixels and magnified by `k`. | 53.92 |
| `PanZoom` | `{ readonly surface: Record<string, unknown>; readonly content: Record<string, unknown>; readonly view: Reactive<PanZoomView>; zoomBy(factor: number, at?: { x: number; y: number }): void; fit(box: { x: number; y: number; width: number; height: number }, margin?: number): void }` | The surface's part, the content's, where it stands, and what magnifies it and frames a box of it from code. | 32.11, 53.92, 53.95, 53.97, 49.3, 49.8, 49.9 |

## `announce`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `announce` | `(text: string, options?: AnnounceOptions) => void` | A message a screen reader reads out from the regions the app spreads `announce.host` on, with nothing shown. | 50.36, 50.49, 50.50 |
| `announce.host` | `() => AnnouncerHost` | The polite and the assertive live region `announce` is read out from, as parts an app spreads onto markup of its own, from the script of the one component that renders them. | 50.36, 50.51, 49.3, 49.9, 49.2, 49.4, 49.5, 49.6 |
| `AnnouncerHost` | `{ readonly polite: Record<string, unknown>; readonly assertive: Record<string, unknown>; said(politeness: 'polite' \| 'assertive'): readonly Announcement[] }` | The two regions' parts, and the message each holds. | 50.51, 50.52, 49.9 |
| `Announcement` | `{ text: string; politeness: 'polite' \| 'assertive'; count: number }` | One message `announce` gave: its words, how urgently they are read, and which message it is. | 50.49, 50.52 |
| `AnnounceOptions` | `{ politeness?: 'polite' \| 'assertive' }` | How urgently a message interrupts what a screen reader is reading. | 50.49 |

# Element behaviors

## `dismissible`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `dismissible` | `(onDismiss: (event: PointerEvent \| KeyboardEvent) => void, options?: DismissibleOptions) => DismissibleParts` | A panel closed on a press outside it or on Escape, as parts an app spreads onto the panel and onto what counts as inside it. | 53.12, 53.13, 53.14, 53.15, 53.16, 32.99, 49.12 |
| `DismissibleOptions` | `{ escape?: boolean; outside?: boolean }` | Whether Escape dismisses, and whether a press outside does. | 53.12, 53.14 |
| `DismissibleParts` | `{ readonly host: Record<string, unknown>; readonly inside: Record<string, unknown> }` | The panel's part, and the part for an element a press on is not outside. | 53.12, 49.3, 49.9 |

## `copy`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `copy` | `(options?: { value?: string \| Record<string, string \| Blob> \| ((clicked: Element) => string \| Record<string, string \| Blob>); copiedFor?: number; selector?: string; oncopied?: (copied: boolean, clicked: Element) => void }) => Record<string, unknown>` | The part copying the element clicked, or text, or a record of MIME type to what it holds, to the clipboard on a click of the element it is spread on, or of a button inside it. | 32.99, 53.21, 53.23, 53.43, 53.44, 53.79, 49.3, 49.12 |

## `hotkeys`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `hotkeys` | `(bindings: Record<string, Hotkey>) => (event: KeyboardEvent) => void` | A `keydown` listener running the binding a key press matches, each binding written as its modifiers and its key joined by `+`. | 53.1, 53.2, 53.3, 53.4, 53.5, 53.6, 53.7, 53.8, 53.9 |
| `Hotkey` | `((event: KeyboardEvent) => void) \| { run: (event: KeyboardEvent) => void; editable?: boolean; prevent?: boolean }` | What a binding runs, alone or with whether it also runs while the visitor types and whether it takes the key's default. | 53.2, 53.7 |

## `isEditableTarget`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `isEditableTarget` | `(target: EventTarget \| null) => boolean` | Whether a key event's target is somewhere the visitor types. | 53.10 |

## `scrollEdges`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `scrollEdges` | `() => Record<string, unknown>` | The part marking the scrolling element it is spread on with the edges it can still scroll toward. | 32.99, 32.101, 32.102, 32.103, 32.104, 32.105, 32.106, 32.107, 32.108, 49.3, 49.12 |

## `elementSize`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `elementSize` | `{ (target: Reactive<unknown, { width: number; height: number }, unknown, unknown>, options?: { box?: Reactive<'content-box' \| 'border-box' \| 'device-pixel-content-box', never, unknown, unknown> }): Record<string, unknown>; (target: Reactive<unknown, { width: number; height: number }, unknown, unknown>, options?: { box?: 'content-box' \| 'border-box' \| 'device-pixel-content-box' }): Record<string, unknown>; (target: ((size: { width: number; height: number }) => void), options?: { box?: Reactive<'content-box' \| 'border-box' \| 'device-pixel-content-box', never, unknown, unknown> }): Record<string, unknown>; (target: ((size: { width: number; height: number }) => void), options?: { box?: 'content-box' \| 'border-box' \| 'device-pixel-content-box' }): Record<string, unknown>; (options?: { box?: Reactive<'content-box' \| 'border-box' \| 'device-pixel-content-box', never, unknown, unknown> }): { readonly host: Record<string, unknown>; readonly width: number \| undefined; readonly height: number \| undefined }; (options?: { box?: 'content-box' \| 'border-box' \| 'device-pixel-content-box' }): { readonly host: Record<string, unknown>; readonly width: number \| undefined; readonly height: number \| undefined } }` | The part writing the size of the element it is spread on, in the box `ResizeObserver` names, into a target, or, given none, that part as `host` beside the width and the height read by name. | 32.79, 32.81, 32.82, 32.83, 32.90, 32.91, 32.92, 32.98, 32.99, 49.3, 49.12, 32.110 |

## `elementVisible`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `elementVisible` | `{ (target: Reactive<unknown, boolean, unknown, unknown>, options?: { root?: Reactive<Element \| Document \| null \| undefined, never, unknown, unknown>; rootMargin?: string \| undefined; threshold?: number \| number[] \| undefined; once?: boolean }): Record<string, unknown>; (target: Reactive<unknown, boolean, unknown, unknown>, options?: { root?: Element \| Document; rootMargin?: string \| undefined; threshold?: number \| number[] \| undefined; once?: boolean }): Record<string, unknown>; (target: ((visible: boolean) => void), options?: { root?: Reactive<Element \| Document \| null \| undefined, never, unknown, unknown>; rootMargin?: string \| undefined; threshold?: number \| number[] \| undefined; once?: boolean }): Record<string, unknown>; (target: ((visible: boolean) => void), options?: { root?: Element \| Document; rootMargin?: string \| undefined; threshold?: number \| number[] \| undefined; once?: boolean }): Record<string, unknown>; (options?: { root?: Reactive<Element \| Document \| null \| undefined, never, unknown, unknown>; rootMargin?: string \| undefined; threshold?: number \| number[] \| undefined; once?: boolean }): { readonly host: Record<string, unknown>; readonly visible: boolean \| undefined }; (options?: { root?: Element \| Document; rootMargin?: string \| undefined; threshold?: number \| number[] \| undefined; once?: boolean }): { readonly host: Record<string, unknown>; readonly visible: boolean \| undefined } }` | The part writing whether the element it is spread on is in view into a target, or, given none, that part as `host` beside `visible` read by name. | 32.80, 32.81, 32.82, 32.83, 32.89, 32.91, 32.92, 32.98, 32.100, 32.99, 32.112, 49.3, 49.12, 32.110 |

## `elementRect`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `elementRect` | `{ (target: Reactive<unknown, { x: number; y: number; top: number; left: number; right: number; bottom: number; width: number; height: number }, unknown, unknown>): Record<string, unknown>; (target: ((rect: { x: number; y: number; top: number; left: number; right: number; bottom: number; width: number; height: number }) => void)): Record<string, unknown>; (): { readonly host: Record<string, unknown>; readonly x: number \| undefined; readonly y: number \| undefined; readonly top: number \| undefined; readonly left: number \| undefined; readonly right: number \| undefined; readonly bottom: number \| undefined; readonly width: number \| undefined; readonly height: number \| undefined } }` | The part writing the rectangle, in the viewport, of the element it is spread on into a target, or, given none, that part as `host` beside each of the eight read by name. | 32.81, 32.83, 32.84, 32.85, 32.86, 32.87, 32.88, 32.91, 32.92, 32.98, 32.99, 49.3, 49.12, 32.110 |

# Helpers

## `format`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `format` | `{ money; percent; number; plural; list; date; duration; relative; bytes }` | The formatters abide ships, as one namespace. | 52.1, 52.2, 52.6 |
| `format.money` | `(value: unknown, options?: Omit<Intl.NumberFormatOptions, 'style'> & { locale?: string }) => string` | An amount of money as it is written. | 52.1, 52.2, 52.6, 52.35, 52.112 |
| `format.percent` | `(value: unknown, options?: Omit<Intl.NumberFormatOptions, 'style'> & { locale?: string }) => string` | A fraction written as a percent. | 52.1, 52.2, 52.6, 52.35, 52.112 |
| `format.number` | `(value: unknown, options?: Omit<Intl.NumberFormatOptions, 'style'> & { locale?: string }) => string` | A number with its thousands grouped. | 52.1, 52.2, 52.6, 52.112, 52.114 |
| `format.plural` | `(value: unknown, one: string, many?: string, options?: { locale?: string }) => string` | A count and the word for what it counts. | 52.1, 52.2, 52.6 |
| `format.list` | `(value: unknown, options?: Intl.ListFormatOptions & { locale?: string }) => string` | A list of items as a sentence says it. | 52.1, 52.2, 52.6, 52.112 |
| `format.date` | `(value: unknown, options?: Omit<Intl.DateTimeFormatOptions, 'dateStyle' \| 'timeStyle' \| 'timeZone'> & { style?: 'day' \| 'monthDay' \| 'month' \| 'time' \| 'hour' \| 'dateTime' \| 'input'; timeZone?: string; locale?: string }) => string` | A date, a time or both, from a `Date`, epoch milliseconds or an ISO string. | 52.1, 52.2, 52.3, 52.6, 52.36, 52.101, 52.112, 52.113, 52.115 |
| `format.dateParts` | `(value: unknown, options?: Omit<Intl.DateTimeFormatOptions, 'dateStyle' \| 'timeStyle' \| 'timeZone'> & { style?: 'day' \| 'monthDay' \| 'month' \| 'time' \| 'hour' \| 'dateTime' \| 'input'; timeZone?: string; locale?: string }) => Intl.DateTimeFormatPart[]` | What `format.date` writes, as the pieces `Intl` names each part of it. | 52.1, 52.2, 52.3, 52.6, 52.36, 52.101, 52.112, 52.113, 52.115 |
| `format.timeZone` | `Reactive<string \| undefined>` | The zone the app pins every date to where its caller names none, or `undefined` for the visitor's own. | 52.3, 52.44, 52.45 |
| `format.duration` | `(value: unknown, options?: { locale?: string }) => string` | A length of time in milliseconds, in its two largest units. | 52.1, 52.2, 52.4, 52.6 |
| `format.relative` | `(value: unknown, options?: { now?: number; locale?: string; style?: 'long' \| 'short' \| 'narrow'; numeric?: 'auto' \| 'always' }) => string` | How long before or after now a time is. | 52.1, 52.2, 52.5, 52.6, 52.32, 52.113 |
| `format.bytes` | `(value: unknown, options?: { minimumFractionDigits?: number; maximumFractionDigits?: number; locale?: string }) => string` | A size in bytes, in the largest unit it fills. | 52.1, 52.2, 52.6, 52.7, 52.112 |

## `highlight`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `highlight` | `(text: string, query: string, options?: { words?: boolean }) => readonly LabelRun[]` | A text cut into runs, each holding what was searched for carrying the `match` part to spread on the element marking it. | 52.110, 52.111, 49.3 |

## `shrinkImage`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `shrinkImage` | `(file: Blob & { name?: string }, options?: ShrinkImageOptions) => Promise<File>` | A picture made no larger than an edge and a byte budget, the same call where Bun runs and in a browser. | 53.87, 53.88, 53.89, 53.102 |
| `ShrinkImageOptions` | `{ maxEdge?: number; maxBytes?: number; type?: 'image/jpeg' \| 'image/webp' \| 'image/png'; quality?: number }` | The most pixels its longer edge keeps, the most bytes it takes, what it is written as, and the quality it is written at first. | 53.87, 53.88 |

## `download`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `download` | `(data: Blob \| string, name: string, type?: string) => void` | Text or bytes made in the page, saved as a file under a name. | 53.90, 53.91 |

## `copyToClipboard`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `copyToClipboard` | `(value: string \| Record<string, string \| Blob>) => Promise<boolean>` | Text, or a record of MIME type to what it holds, written to the clipboard, settling whether it landed. | 53.22, 53.54, 53.55, 53.103, 53.104 |

## `sortBy`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `sortBy` | `<Item>(items: readonly Item[], value: (item: Item) => unknown, direction?: 'ascending' \| 'descending') => Item[]` | A new array of `items` ordered by a value of each, blanks last and text in abide's locale, so a server and the page hydrating it agree. | 51.43, 51.44, 51.45, 51.46, 51.48 |

## `markdown`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `markdown` | `(text: string, options?: { schemes?: readonly string[]; headingLevel?: number; href?: (address: string) => string \| LinkTarget \| undefined; blocks?: Readonly<Record<string, (source: string, info: string) => string>>; inline?: boolean; streaming?: boolean }) => string` | Markdown as HTML safe to hand `raw`. | 52.8, 52.9, 52.10, 52.11, 52.12, 52.13, 52.14, 52.15, 52.16, 52.40, 52.41, 52.42, 52.46, 52.47, 52.48, 52.49, 52.50 |
| `markdown.incremental` | `(options: { source: string \| (() => string); schemes?: readonly string[] \| (() => readonly string[] \| undefined); headingLevel?: number \| (() => number \| undefined); href?: (address: string) => string \| LinkTarget \| undefined; blocks?: readonly string[] \| (() => readonly string[] \| undefined); streaming?: boolean \| (() => boolean \| undefined) }) => { readonly sections: readonly MarkdownSection[] }` | Markdown as sections an app renders itself, each kept while text only grows past it. | 52.17, 52.18, 52.40, 52.41, 52.43, 52.50, 49.10, 49.11 |
| `MarkdownSection` | `{ readonly html: string; readonly block: { name: string; source: string; info: string } \| undefined }` | One section of a document: its markup, or the fenced block an app renders in its place. | 52.17, 52.43 |
| `LinkTarget` | `{ href: string; target?: string; rel?: string }` | Where a link `markdown` writes goes: its address, and the `target` and `rel` it opens with. | 52.40 |

## `instantAt`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `instantAt` | `(wallClock: string, options?: { timeZone?: string }) => number \| undefined` | The epoch milliseconds at which a zone's clocks read a day and a time. | 52.102, 52.103 |

## `keyLabel`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `keyLabel` | `(binding: string, options?: { apple?: boolean }) => string` | A `hotkeys` binding written the way the visitor's platform writes its keys. | 53.3, 53.9, 53.11, 53.51, 53.53 |
| `keyLabel.parts` | `(binding: string, options?: { apple?: boolean }) => string[]` | Each key `keyLabel` writes for a binding, apart, for one key cap apiece. | 53.52, 53.53 |

## `deepEqual`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `deepEqual` | `(next: unknown, previous: unknown) => boolean` | The by-value comparator over arrays and plain objects that an app declares on `identity`. | 5.4, 5.5, 18.4 |

## `validateJson`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Schema<T>` | `((value: unknown) => T) \| StandardSchemaV1<T>` | The two forms a shape may be declared in. | 19.2, 19.3, 19.4, 19.6, 19.8, 19.9, 19.10, 19.18, 19.11, 19.12 |
| `Issues<T>` | `T extends Rpc<infer _Value, infer Args, infer _Failures, infer _Produced> ? Issues<Args> : T extends object ? Partial<Record<Paths<T> \| '', string[]>> : string[]` | What was wrong, keyed by where. | 19.4, 19.19, 19.26 |
| `Paths<T>` | `string` | The dot-joined leaf paths of a type. | 19.5 |
| `validateJson` | `<T>(schema: JsonSchema, value: unknown) => Issues<T> \| null` | The native validator. | 19.13, 19.25 |

## `jsonSchema`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `JsonValue` | `null \| boolean \| number \| string \| JsonValue[] \| { [k: string]: JsonValue }` | What an `Args` may hold. | — |
| `JsonSchema` | `JsonValue` | A JSON Schema document, the native form. | 19.7, 19.14 |
| `jsonSchema` | `<T>(document: JsonSchema) => StandardSchemaV1<T>` | A JSON Schema document as a `Schema`, carrying its validator. | 19.13, 19.14, 19.23, 20.11, 19.28 |

# Handlers

## `GET`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Rpc` | `<Value, Args, Failures = never, Produced = Value>(args?: Args, options?: { signal?: AbortSignal; offline?: (args: Args) => Value }) => Reactive<Value, Value, Failures \| Failed<'HttpError', undefined> \| Annotated<Args>, Produced>` | A handler reached over http, or in process on a server. | 16.3, 16.4, 16.8, 16.11, 16.25, 16.26, 16.27, 16.28, 16.29, 16.33, 16.43, 16.48, 16.49, 16.62, 41.5, 41.7, 41.12, 41.21, 41.22, 41.25, 41.26, 41.27, 41.33, 16.79, 16.80, 16.85, 16.106 |
| `offline` | `(args: Args) => Value` | What a call settles to where a browser could not get its answer. | 16.81, 16.82, 16.83, 16.84 |
| `Value` | `unknown` | What the addressed `Reactive` holds. | 16.3, 16.30 |
| `Produced` | `unknown` | What the handler yields per production, per the unit rule. | 1.2, 16.3 |
| `Args` | `Record<string, JsonValue> \| undefined` | The arguments, in the body on a mutation and in the URL on a `GET` or `DELETE`. | 11.24, 16.18, 19.15, 19.27, 30.28 |
| `Middleware` | `Middleware<Answer = never, Extra extends object = object, Refused extends Failed<string, unknown> = Failed<string, unknown>> = <Given extends { request: Request } & Extra, Result extends {} \| null \| undefined>(next: (ctx?: Given) => Promise<Result>, ctx: Given) => Result \| Answer \| Refused \| Promise<Result \| Answer \| Refused>` | One rung, written once for every lane whose context carries `Extra`. | 16.8, 16.14, 16.15, 16.16, 16.21, 16.86, 37.14, 37.15 |
| `GET` | `<Args = undefined, Result = unknown, Shaped = BodyValue<Result>, Gate = Schema<BodyValue<Result>>, ArgsGate = Schema<Args>, Answers extends readonly unknown[] = unknown[]>(handler: (args: Args) => Result, options?: Shaping<BodyValue<Result>, Shaped, Args, Gate, ArgsGate> & Omit<RpcOptions<Args, Answers>, 'refreshes'>) => Rpc<Kept<Shaped>, Args, AdoptedFailures<Result> \| Refusals<Shaped, Gate, BodyValue<Result>, ArgsGate, Args> \| RungRefusals<Answers>, BodyProduced<Result, Kept<Shaped>>>` | Declares a read any surface may call, from a body: keyed where it declares a parameter, a stream where it hands back a generator, its options (`ttl`, `global`, `debounce` and the rest) building the value it becomes beside its address. | 16.1, 16.2, 16.5, 16.6, 16.30, 16.31, 16.32, 16.68, 16.76, 16.34, 16.35, 16.36, 16.37, 16.39, 16.105, 16.44, 16.45, 16.46, 16.47, 16.75, 16.50, 16.51, 16.52, 16.64, 12.17, 18.1, 18.3, 18.6, 18.8, 18.10, 18.12, 18.21, 18.24, 18.27, 16.92, 16.93, 16.94, 16.95, 16.96, 16.97, 16.98, 16.99, 16.100, 16.7, 11.2, 16.87 |
| `GET` | `<Built extends ((args: never) => unknown) & { invalidate: unknown }, Answers extends readonly unknown[] = unknown[]>(handler: Built, options?: Omit<RpcOptions<BuiltArgs<Built>, Answers>, 'refreshes'>) => BuiltRpc<Built, Answers>` | The built form, for a `Reactive` or a `Keyed` given an address and served as it is. | 11.2, 16.1, 16.3, 16.6 |
| `GET` | `<Accepted, Shaped = Accepted, Gate = Schema<Accepted>, Answers extends readonly unknown[] = unknown[]>(handler: Held<Accepted>, options?: Shaping<Accepted, Shaped, never, Gate> & Omit<RpcOptions<undefined, Answers>, 'refreshes'>) => Rpc<Kept<Shaped>, undefined, Refusals<Shaped, Gate, Accepted> \| RungRefusals<Answers>>` | The value form, for what the handler owns outright, whose options build the value it becomes. | 16.1, 16.6, 16.7 |
| `rpc.busy` | `(pattern?: Partial<Args>) => boolean` | `busy` narrowed to the handler's matching entries. | 13.2, 13.3, 13.12, 13.19, 46.11 |
| `rpc.ready` | `(pattern?: Partial<Args>) => boolean` | `ready` narrowed to the handler's matching entries. | 13.11, 13.12, 13.19 |
| `rpc.synced` | `(pattern?: Partial<Args>) => boolean` | `synced` narrowed to the handler's matching entries. | 13.12, 13.18, 13.19 |
| `rpc.invalidate` | `(pattern?: Partial<Args>, options?: { caller?: string \| true }) => void` | `invalidate` narrowed to the handler's matching entries. | 7.2, 7.3, 13.4, 13.12, 13.19, 18.37, 18.38, 18.39 |
| `rpc.refresh` | `(pattern?: Partial<Args>, options?: { caller?: string \| true }) => void` | `refresh` narrowed to the handler's matching entries. | 7.4, 7.5, 13.4, 13.12, 13.19, 18.37, 18.38, 18.39 |
| `rpc.isError` | `<Name extends string>(error: unknown, name: Name) => error is Extract<Failures \| Failed<'HttpError', undefined> \| Annotated<Args>, { name: Name }>` | Whether a caught failure is the one named. | 16.8 |
| `rpc.raw` | `(args: Args, init?: RequestInit) => Promise<Response>` | The handler's call, handed back as its raw `Response`. | 16.11, 16.42 |
| `rpc.method` | `string` | The HTTP method. | 16.2 |
| `rpc.url` | `(args?: Args) => string` | The address, resolved against the mount. | 16.9, 16.10, 30.28 |
| `rpc.address` | `string \| undefined` | Where the handler answers. | 16.88 |
| `rpc.tool` | `string \| undefined` | The name MCP and OpenAPI list the handler by. | 20.13, 20.24 |
| `rpc.description` | `string \| undefined` | The human description. | 16.28 |
| `PatchOp` | `{ op: 'add' \| 'replace' \| 'test'; path: string; value: unknown } \| { op: 'remove'; path: string } \| { op: 'move' \| 'copy'; from: string; path: string }` | One JSON Patch operation (RFC 6902), its paths JSON Pointers, as a followed `GET` is sent what an `s.patch` wrote. | 18.11, 18.13 |

The aliases a call's failures, a plain handler's options and a built value's `Rpc` are spelled
through are declared rather than listed, none of them being a name an app writes. `RungRefusals` is what 16.86 carries,
and `Annotated` is the `ValidationError` of
16.8, `never` wherever 19.9 derives no object's schema from `Args`:
```ts
type Annotated<Args> = 0 extends 1 & Args ? never : unknown extends Args ? never : Derived<Exclude<Args, undefined>>
type Derived<Member, Whole = Member> = Member extends readonly unknown[] | ((...given: never[]) => unknown) ? never : Member extends object ? [Whole] extends [Member] ? [keyof Member] extends [never] ? [string] extends [Member] ? Failed<'ValidationError', Issues<Whole>> : never : Failed<'ValidationError', Issues<Whole>> : never : never
type Shaping<Accepted, Shaped, Args = never, Gate = Schema<Accepted>, ArgsGate = Schema<Args>> = Omit<ReactiveOptions<Accepted, Kept<NoInfer<Shaped>>, never, Args>, 'transform' | 'schema' | 'args'> & { transform?: (value: Accepted) => Shaped; schema?: Gate & Schema<Accepted>; args?: [Args] extends [never] ? never : ArgsGate & Schema<Args> }
type Refusals<Shaped, Gate, Stored, ArgsGate = Schema<never>, Args = never> = Refused<Shaped> | Gated<Gate, Stored> | Gated<ArgsGate, Args>
type BuiltArgs<Built> = Built extends Keyed<unknown, infer Args, never, unknown, unknown> ? Args : undefined
type BuiltRpc<Built, Answers extends readonly unknown[]> = Built extends Keyed<infer Stored, infer Args, never, infer Failures, infer Produced> ? Rpc<Stored, Args, Failures | RungRefusals<Answers>, Produced> : Built extends Reactive<infer Stored, never, infer Failures, infer Produced> ? Rpc<Stored, undefined, Failures | RungRefusals<Answers>, Produced> : never
type RungRefusals<Answers extends readonly unknown[]> = Answers[number] extends infer Answer ? Answer extends Failed<infer Name, unknown> ? string extends Name ? never : Answer : never : never
type Reached = { readonly [REACHED]: true }
```

### `RpcOptions`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `description` | `string` | The human description carried onto every generated surface. | 16.28 |
| `middleware` | `{ [At in keyof Answers]: (next: (ctx?: { request: Request; args: () => Args }) => Promise<Reached>, ctx: { request: Request; args: () => Args }) => Answers[At] \| Promise<Answers[At]> } \| readonly ((next: (ctx?: { request: Request; args: () => NoInfer<Args> }) => Promise<Reached>, ctx: { request: Request; args: () => NoInfer<Args> }) => unknown)[]` | The rungs run per call. | 16.8, 16.11, 16.12, 16.16, 16.17, 16.18, 16.19, 16.20, 16.86 |
| `timeout` | `number` | How long the call may go without progress. | 16.22, 16.58, 16.59, 16.60, 16.61, 16.77 |
| `clients` | `Clients` | Which surfaces carry this handler. | 16.37, 20.3 |
| `crossOrigin` | `boolean \| string[]` | Whether other origins may call it, or follow it over the mux. | 16.24, 18.2, 21.19 |
| `maxBodySize` | `number` | The largest request body a mutation will accept, in bytes. | 16.13, 16.54, 16.55 |
| `refreshes` | `readonly (string \| Selection \| readonly [Selection, Record<string, unknown>] \| readonly [Rpc, Record<string, unknown> \| undefined, { caller?: string \| true }])[] \| ((args: Args) => readonly (string \| Selection \| readonly [Selection, Record<string, unknown>] \| readonly [Rpc, Record<string, unknown> \| undefined, { caller?: string \| true }])[] \| PromiseLike<readonly (string \| Selection \| readonly [Selection, Record<string, unknown>] \| readonly [Rpc, Record<string, unknown> \| undefined, { caller?: string \| true }])[]>)` | The tags and selections a run of a mutation refreshes once it answers. | 16.89, 16.90, 16.91, 16.92, 16.101, 16.102, 16.103, 16.104 |

## `POST`, `PUT`, `PATCH` and `DELETE`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `POST` / `PUT` / `PATCH` / `DELETE` | same as `GET`, with `RpcOptions` in place of `Omit<RpcOptions, 'refreshes'>` | Declares a mutation. | 16.2, 16.7, 16.32, 16.68, 16.76, 16.38, 16.53, 19.29 |

## Mount paths

| File | Declares | Served at | Rules |
| --- | --- | --- | --- |
| `users/getUser.handler.ts` | `export default GET(…)` | `/users/getUser` | 16.2, 16.73, 19.1, 19.20, 23.14 |
| `health.handler.ts` | `export default GET(…)` | `/health` | 16.2, 23.14 |
| `media/[id]/save.handler.ts` | `export default POST(…)` | `/media/[id]/save`, `id` reaching its `Args` | 16.2, 16.65, 16.66, 16.67, 16.69 |
| `media/[id]/lib/Comments.abide` | `const addComment = POST(…)` in its `<script server>` | `/__abide/handlers/media/id/lib/Comments/addComment` | 16.70, 16.71, 16.72 |

## Headers abide generates

| Header | On | Meaning | Rules |
| --- | --- | --- | --- |
| `x-content-type-options: nosniff` | everything | The declared content type, held against a browser's guess. | 21.1 |
| `traceresponse` | everything | Correlates the answer, a failure included. | 21.2 |
| `cache-control: private, no-store` | a page, an rpc answer, any refusal | The default a write through `response` overrides. | 21.3, 21.10 |
| `cache-control: private, max-age=<ttl>` | a `GET` over a `global` `reactive` | The value's own duration, answered rather than restated. | 21.8, 21.9, 21.11, 21.16, 21.17, 18.14 |
| `cache-control: no-store` | `/__abide/openapi.json`, `/__abide/mcp` | Refuses caching for an answer about the app's surfaces. | 21.4 |
| `cache-control: public, max-age=31536000, immutable` | the built bundle | A chunk addressed by its own content hash. | 21.5 |
| `cache-control: public, max-age=0, must-revalidate` | a file under a `public` directory | A file at an address the build never chose. | 21.12 |
| `cache-control: private, stale-while-revalidate=604800, stale-if-error=31536000` | a `GET`'s answer, where `ABIDE_OFFLINE` registers its worker | The default that lets a copy kept on the device stand in for the network. | 21.22, 21.11, 21.17 |
| `cache-control: private, max-age=0, stale-if-error=31536000` | a page, where `ABIDE_OFFLINE` registers its worker | The default that keeps the browser's own cache from opening a page stale, and the worker's copy standing in for a year. | 21.25 |
| `cache-control: public, max-age=0, stale-if-error=31536000` | a file under a `public` directory, where `ABIDE_OFFLINE` registers its worker | The same, for a file at an address the build never chose. | 21.23 |
| `clear-site-data: "cache"` | an answer carrying `abide-principal`, where pages are kept offline | Drops what the browser's own cache kept for the caller signed in before. | 21.24 |
| `etag` | a file under a `public` directory | The answered bytes, addressed by their content. | 21.13, 21.14 |
| `referrer-policy: strict-origin-when-cross-origin` | a page | The browsers' own default, written down. | 21.6 |
| `vary` | wherever an answer depends on a request header | Names the header the answer varied on. | 21.7 |
| `content-security-policy: frame-ancestors 'none'` | a page | The default a write through `response` or `csp` overrides. | 21.18, 21.10 |
| `access-control-allow-origin` | an rpc answer to another origin | The origin a handler admitted. | 21.19, 16.24 |
| `allow: GET, HEAD` | a page, a public file or the bundle, asked by another method | The methods the address answers. | 15.17 |
| `server-timing` | an rpc answer; `Middleware` and a `timing` span on any answer | The handler's duration, named `Direct`, `Seeded` from the render's run, `Cached` from a held `global` production, or `Started` to a stream's first chunk; the rungs' time; and each `timing` span. | 21.15, 21.20, 21.21, 24.6 |
| `etag` | a `GET` answered from a `global` value | The version of the production answered. | 18.5, 18.6, 18.7, 18.9, 18.19, 18.20, 18.22, 18.23, 16.57 |

## `clients`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Clients` | `{ ui?: boolean; mcp?: boolean; cli?: boolean; openapi?: boolean }` | Which surfaces carry a handler. | 20.1, 20.2, 20.3, 20.4 |
| `clients` | `Clients` | The option a handler withholds a surface with. | 16.37, 20.3, 20.4 |

## OpenAPI

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `/__abide/openapi.json` | `GET` | The generated OpenAPI document. | 19.21, 19.22, 20.5, 20.6, 20.7, 20.8, 20.11, 20.13, 20.15, 20.23, 36.7 |
| `OpenApiDocument` | `JsonValue` | OpenAPI 3.1, whose schema dialect is `JsonSchema`. | 20.6 |

## MCP

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `/__abide/mcp` | `POST` | The streamable-http MCP endpoint. | 19.21, 19.22, 20.5, 20.7, 20.8, 20.9, 20.10, 20.12, 20.13, 20.14, 20.16, 20.17, 20.19, 20.20, 20.21, 20.22, 20.23, 36.7, 16.78 |

# Middleware and guards

## `middleware`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `middleware` | `(...rungs: ((next: (ctx?: { request: Request }) => Promise<Response>, ctx: { request: Request; lane: Lane }) => Response \| Failed<string, unknown> \| Promise<Response \| Failed<string, unknown>>)[]) => () => void` | The per-request lane at the calling file's route. | 18.26, 37.2, 37.3, 37.13, 37.14, 37.15, 37.19, 37.20 |
| `Lane` | `'page' \| 'handler' \| 'file' \| 'openapi' \| 'mcp' \| 'bridge' \| 'socket' \| 'abide'` | What answers a request a `middleware` rung is handed. | 37.19 |

## `signedIn`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `signedIn` | `Middleware<never, object, Failed<'SignedOut', undefined>>` | A rung admitting a caller the server authenticated, from `@abide/abide/server`. | 15.9, 54.1 |

## `authorize`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `authorize` | `(admits: Partial<Principal> \| ((principal: Principal) => boolean \| Promise<boolean>), options?: { message?: string; status?: 403 \| 404 }) => Middleware<never, object, Failed<'SignedOut', undefined> \| Failed<'Forbidden', undefined> \| Failed<'NotFound', { path: string; method: string }>>` | A rung admitting a signed-in caller whose claims hold the ones it names, or whom a function passes, from `@abide/abide/server`. | 13.12, 15.7, 15.9, 54.2, 54.3, 54.4, 54.28 |

## `trustedIdentity`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `trustedIdentity` | `(options: { header: string; proxies: readonly string[]; claims: (value: string) => Record<string, unknown> }) => Middleware` | A rung signing in the caller a trusted proxy names in a header, from `@abide/abide/server`. | 54.35, 54.36, 54.37 |

## `readOnly`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `readOnly` | `(options?: { allow?: readonly { address: string \| undefined }[]; message?: string }) => Middleware<never, object, Failed<'ReadOnly', undefined>>` | A rung refusing every write but one to a handler it allows, from `@abide/abide/server`. | 15.9, 54.5, 54.6 |

## `csp`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `csp` | `(sources?: Record<string, string[]>) => (next: (ctx?: { request: Request }) => Promise<Response>, ctx: { request: Request }) => Response \| Promise<Response>` | The rung that sets `content-security-policy`. | 29.1, 29.2, 29.5, 29.6, 29.7, 29.8 |
| `csp.nonce` | `() => string` | This response's nonce, for the app's own inline script. | 29.3, 29.4, 29.9, 29.11 |

# Ambients

## `request`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `request` | `() => Request` | The request being served. | 18.16, 18.17, 18.18, 22.1 |
| `request.ip` | `() => ReceivedFrom \| 'in-process'` | Where the request being served came from. | 22.1, 22.12, 22.13 |
| `ReceivedFrom` | `{ address: string; family: 'IPv4' \| 'IPv6'; port: number } \| null` | The peer a listener received a request from. | 22.12 |

## `response`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Values<T>` | `Iterable<T> \| AsyncIterable<T> \| ReadableStream<T>` | What every body helper takes. | 17.1 |
| `response.page` | `<Body extends string \| Uint8Array \| Values<Uint8Array \| string>>(body: Body) => Body` | A rendered document as `text/html`. | 16.75, 17.2 |
| `response.json` | `<T>(value: T) => T` | A value as JSON, fixed, with `undefined` sent as `null`. | 17.7, 17.9, 17.10 |
| `response.redirect` | `(to: string \| URL, status?: RedirectStatus) => undefined` | A navigation. | 16.52, 17.3 |
| `response.jsonl` | `<T>(values: Values<T>) => Values<T>` | One JSON value per line, fixed. | 16.44, 16.75, 17.6, 17.7 |
| `response.sse` | `<T>(values: Values<T>) => Values<T>` | A stream of values framed as server-sent events, fixed. | 16.45, 16.57, 16.75, 17.6, 17.7 |
| `response.bytes` | `(values: Values<Uint8Array>) => Values<Uint8Array>` | A stream of binary chunks, fixed. | 16.34, 16.75, 17.6, 17.7 |
| `RedirectStatus` | `301 \| 302 \| 303 \| 307 \| 308` | The statuses a `response.redirect` may carry. | 17.3 |
| `response` | `() => { status: number; headers: Headers }` | The response being built for the request being served. | 16.13, 16.52, 21.10, 22.1, 22.9, 22.10 |

## `cookies`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `cookies` | `() => Cookies` | The cookies of the request being served, live and mutable. | 22.2, 22.3, 22.4, 22.5, 22.6, 22.7, 22.8, 22.10 |
| `Cookies` | `class Cookies implements Iterable<[string, string]> { get(name: string): string \| null; has(name: string): boolean; set(name: string, value: string, options?: CookieInit): void; set(options: CookieInit): void; delete(name: string, options?: Omit<CookieStoreDeleteOptions, 'name'>): void; delete(options: CookieStoreDeleteOptions): void; size: number; toJSON(): Record<string, string>; toSetCookieHeaders(): string[] }` | A cookie jar shaped like Bun's `CookieMap`. | 22.4, 22.5, 22.6 |

## `principal`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `principal.authenticated` | `Reactive<boolean>` | Whether this caller presented something the server accepted. | 26.1, 26.2 |
| `principal.expiresAt` | `Reactive<string \| undefined>` | When the seal lapses. | 26.1, 26.2 |
| `principal.error` | `Reactive<Failed<string, unknown> \| undefined>` | The app's resolver, or a browser's load of the document, having failed. | 26.1, 26.3, 26.23 |
| `principal.resolved` | `Reactive<Principal>` | What `onPrincipal` returned, merged over the baseline. | 26.1, 26.4, 26.25, 26.26 |
| `principal.caller` | `Reactive<string>` | Which browser, as against who they are. | 22.10, 26.5, 26.6, 26.7, 26.19, 26.22 |
| `principal.set` | `(claims: Record<string, unknown>) => Promise<void>` | Authenticates this caller. | 18.25, 26.8, 26.12, 26.16, 26.17, 26.18, 26.20, 26.21, 26.24 |
| `principal.clear` | `() => void` | Signs this caller out. | 18.25, 26.7, 26.9, 26.24 |
| `Principal` | `interface Principal { [claim: string]: unknown; authenticated: boolean; expiresAt?: string; error?: Failed<string, unknown> }` | The wire document. | 26.4, 26.10, 26.13, 26.14, 26.15, 26.25 |
| `authenticated` | `boolean` | Whether this caller presented a seal the server accepted. | 26.10 |
| `expiresAt` | `string \| undefined` | When the seal lapses. | 26.11 |
| `error` | `Failed<string, unknown> \| undefined` | The app's resolver having failed. | 26.3 |

## `config`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `config` | `Reactive<Config>` | The resolved configuration document. | 27.1, 27.9 |
| `Config` | `interface Config { [field: string]: unknown; APP_NAME: string; APP_VERSION: string; APP_DATA_DIR: string }` | The resolved document, widened by what each `onConfig`'s defaults return, and by declaration merging. | 27.12, 27.13 |
| `Env` | `Record<string, string \| undefined>` | The process environment as read, before coercion. | 27.2, 27.8 |
| `config.invalidate` | `() => void` | The trigger over the resolved configuration. | 7.2, 27.5 |
| `ConfigDefaults` | `(env: Env) => unknown` | The defaults function, synchronous by contract. | 27.4, 27.11 |
| `ConfigField` | `{ name: string; label: string; description: string \| undefined; input: 'text' \| 'number' \| 'checkbox' \| 'password' \| 'url' \| 'select'; options: string[] \| undefined; required: boolean; value: string }` | One input the start form asks for. | 38.72 |

### `ConfigOptions`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `schema` | `Schema<Config>` | The gate over the whole configuration document. | 27.7 |

## `server`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `server` | `<WebSocketData>() => Server<WebSocketData>` | The listening server. | 22.1, 42.9 |

## `reachable`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `reachable` | `(host: string) => Promise<boolean>` | Whether a host answers at all. | 23.10, 23.11, 23.12, 23.13 |

## `isServer`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `isServer` | `() => boolean` | Whether the work running is a server's. | 22.11, 12.7, 23.7, 23.8 |

## `abortSignal`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `abortSignal` | `() => AbortSignal` | The signal that says stop to the work it is called in, from the innermost owner that work runs under. | 7.38, 7.39, 7.45, 7.46, 7.47, 7.48, 7.49, 54.39 |

# Browser context

## `online`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `online` | `Reactive<boolean>` | Whether the caller can reach the app. | 23.7, 23.8, 18.33, 18.34, 41.32 |

## `media`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `media` | `(query: string) => Reactive<boolean>` | Whether the document matches a media query. | 23.30, 23.31, 23.32, 41.32 |

## `outbox`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `outbox` | `<Chosen extends Selection>(selection?: Chosen, pattern?: Partial<Args>) => QueuedCall[]` | The calls a browser has queued and not delivered, the refused ones included. | 46.1, 46.2, 46.3, 46.4, 46.5, 46.6, 46.7, 46.8, 46.9, 46.10, 46.14, 46.15, 46.16, 46.17, 46.20, 46.21, 18.35 |
| `rpc.outbox` | `(pattern?: Partial<Args>) => QueuedCall[]` | `outbox` narrowed to the handler's calls. | 46.1, 13.12 |
| `QueuedCall` | `{ id: string; method: 'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'; url: string; args: Record<string, JsonValue> \| undefined; queuedAt: number; attempts: number; value: Reactive<Value, Value, Failed<string, unknown>>; retry: () => void; discard: () => void }` | One call `outbox` holds. | 46.1, 46.10 |
| `call.value` | `Reactive<Value, Value, Failed<string, unknown>>` | The value a queued call settled. | 46.5, 46.7, 46.18, 46.19 |
| `call.retry` | `() => void` | Sends a queued call again. | 46.6, 46.12 |
| `call.discard` | `() => void` | Drops a queued call. | 46.13 |

# App and lifecycle

## `createApp`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `createApp` | `() => Promise<App>` | The app built and booted, with no socket bound. | 42.1, 42.2, 42.3, 42.4, 42.16, 42.22, 37.4, 37.6, 38.100 |
| `App` | `interface App` | What a host, a test or a script holds the app as. | 42.12, 42.13 |
| `App.fetch` | `(request: Request, options?: { principal?: Record<string, unknown>; caller?: string }) => Promise<Response>` | The whole request path, entered in process. | 42.5, 42.6, 42.20, 42.21 |
| `App.run` | `<Result>(fn: () => Result \| Promise<Result>, options?: { request?: Request; principal?: Record<string, unknown>; caller?: string }) => Promise<Result>` | One scope around a function, and nothing else. | 42.7, 42.8, 42.19, 42.21, 11.38 |
| `App.listen` | `(options?: { port?: number; hostname?: string; unix?: string }) => Promise<void>` | The socket, bound. | 42.9, 16.23, 16.56, 18.28, 18.29, 18.30, 7.30 |
| `App.stop` | `() => Promise<void>` | The drain and the teardown. | 42.10, 42.11, 42.15, 42.17, 37.4, 7.26, 7.27, 7.31, 7.37, 7.38, 7.40, 7.41, 7.42 |
| `App[Symbol.asyncDispose]` | `() => Promise<void>` | `App.stop`, under the name `await using` calls. | 42.14 |

## Environment variables

| Name | Type | Meaning | Rules |
| --- | --- | --- | --- |
| `PORT` | `number` | The listen port. | 36.1, 38.63, 38.64 |
| `APP_URL` | `string \| null` | The app's public URL. | 36.2, 19.17 |
| `NODE_ENV` | `string` | The environment name, verbatim. | 36.3, 36.16 |
| `APP_NAME` | `string` | The app's name, and `log`'s default namespace. | 27.3, 28.4, 38.87 |
| `APP_VERSION` | `string` | The version beside that name. | 27.3 |
| `APP_DATA_DIR` | `string` | The platform's per-user data directory. | 27.3, 36.4 |
| `ABIDE_UPDATE_KEY` | `string \| null` | The key `abide native` signs the native app's updates with. | 38.147 |
| `ABIDE_PRINCIPAL_SECRET` | `string \| null` | What seals the principal cookie. | 26.11, 36.5, 38.120, 38.175 |
| `ABIDE_PRINCIPAL_TTL` | `number` | The principal cookie's life, in ms. | 26.15, 26.16 |
| `ABIDE_APP_TOKEN` | `string \| null` | The bearer the remote CLI sends. | 36.6 |
| `ABIDE_APP_URL` | `string \| null` | Names an app somewhere else, for the remote CLI. | 36.6 |
| `ABIDE_RPC_TIMEOUT` | `number` | The default ms a call may go without progress. | 16.22, 16.58 |
| `ABIDE_BRIDGE_TOOLS` | `string` | The tools of the visitor's machine `/__abide/pairing` asks a bridge for, separated by commas. | 44.67 |
| `ABIDE_BRIDGE_FULL` | `boolean` | Whether `/__abide/pairing` asks a bridge for full access. | 44.67 |
| `ABIDE_BRIDGE_NOTE` | `string` | The app's note on why it asks, shown in the question a pairing link asks. | 44.67, 44.91 |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | `number` | The default ceiling on a mutation's body. | 16.13, 16.54, 16.55, 16.78 |
| `ABIDE_MAX_SOCKET_MESSAGE_SIZE` | `number` | The ceiling on a frame received over the socket mux, in bytes. | 18.28 |
| `ABIDE_MAX_SOCKET_SUBSCRIPTIONS` | `number` | How many values one connection to the socket mux may follow. | 18.31, 18.32 |
| `ABIDE_OFFLINE` | `boolean` | Whether the app keeps its pages and its bundle on the device, for when the network is gone. | 45.1, 45.2, 45.3, 45.4, 45.5, 45.6, 45.7, 45.8, 45.9, 45.10, 45.11, 45.12, 45.13, 45.14, 45.15, 45.16, 45.17, 45.18, 45.19, 45.20, 45.21, 45.22, 45.23, 45.24, 45.25, 45.26, 45.27, 45.28, 45.29 |
| `ABIDE_STOP_TIMEOUT` | `number` | How long `App.stop` drains, in ms. | 42.17, 42.18 |
| `ABIDE_MAX_STREAM_BUFFER_SIZE` | `number` | The cap on a stream transcript held in memory. | 36.18 |
| `ABIDE_MAX_LOG_BUFFER_COUNT` | `number` | How many lines `log.records` is trimmed back to. | 28.1 |
| `ABIDE_LOG_FORMAT` | `'tsv' \| 'json' \| null` | The machine log format. | 36.8 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `string \| null` | Where the app's lines and spans are sent as OTLP. | 36.19, 36.20, 36.21, 36.23 |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | `string \| null` | Where the app's lines are sent, in place of the endpoint's. | 36.19, 36.20 |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | `string \| null` | Where the app's spans are sent, in place of the endpoint's. | 36.19, 36.20 |
| `OTEL_EXPORTER_OTLP_HEADERS` | `string \| null` | The headers every export carries, as `name=value` pairs separated by commas. | 36.20 |
| `OTEL_SERVICE_NAME` | `string \| null` | The service every export is sent under. | 36.22 |
| `OTEL_SDK_DISABLED` | `'true' \| null` | Turns every export off. | 36.19 |
| `DEBUG` | `string \| null` | Log-namespace gating. | 28.6, 28.9, 28.10, 28.11 |
| `NO_COLOR` | `string \| null` | Refuses ansi anywhere. | 36.9 |
| `FORCE_COLOR` | `string \| null` | Asks for the readable form off a pipe. | 36.9 |

## `onStart`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onStart` | `(fn: (start: () => Promise<void>) => void \| Promise<void>) => () => void` | Wraps the app's boot, run once before it answers any request. | 37.4, 37.6, 37.13 |

## `onStop`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onStop` | `(fn: (stop: () => Promise<void>) => void \| Promise<void>) => () => void` | Wraps the app's teardown, run after in-flight requests drain. | 37.4, 37.6, 37.13, 38.180 |

## `onError`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onError` | `(fn: (error: unknown) => unknown) => () => void` | Runs on an unexpected error at the calling file's route, or in the browser while the calling component stands. | 37.5, 37.8, 37.13, 37.16, 37.17, 37.18, 37.21, 37.28, 12.6 |

## `onRefusal`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onRefusal` | `(fn: (refusal: Failed<string, unknown>, call: { method: 'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'; url: string; trace: string \| undefined }) => unknown) => () => void` | What the browser hands each refusal a call over http is answered with, below the calling component. | 37.13, 37.22, 37.23, 37.24, 37.25, 37.26, 37.27 |

## `onConfig`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onConfig` | `(fn: ConfigDefaults \| null, options?: ConfigOptions) => () => void` | The app's config defaults and their schema. | 27.3, 27.4, 27.6, 27.10, 27.13, 37.7, 37.13 |

## `onHealth`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onHealth` | `(report: () => unknown \| Promise<unknown>) => () => void` | The app's health reporter, merged over the baseline. | 25.2, 37.7, 37.13 |

## `onPrincipal`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onPrincipal` | `(resolve: (claims: unknown) => unknown \| Promise<unknown>) => () => void` | Turns the sealed claims into the fields `principal.resolved` holds in their place. | 26.4, 26.26, 37.7, 37.13 |

## `onPairing`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onPairing` | `(args: () => readonly string[]) => () => void` | The Claude Code arguments every pairing's command and install carry after `--`, for the person asking. | 37.7, 37.13, 44.76, 44.78 |

## `onReport`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onReport` | `(send: (report: Report) => void \| Promise<void>) => () => void` | Where the app's problem reports go. | 37.7, 37.13, 48.6, 48.8 |

## `onLauncher`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onLauncher` | `(options: () => LauncherOptions) => () => void` | The window the native app opens and the forms its launcher offers. | 38.80, 38.81, 38.83, 38.86, 38.102, 38.107, 38.156, 38.182, 38.187 |
| `LauncherOptions` | `{ width?: number; height?: number; minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number; titlebar?: 'standard' \| 'hidden' \| 'inset'; vibrancy?: 'titlebar' \| 'selection' \| 'menu' \| 'popover' \| 'sidebar' \| 'headerView' \| 'sheet' \| 'windowBackground' \| 'hudWindow' \| 'fullScreenUI' \| 'toolTip' \| 'contentBackground' \| 'underWindowBackground' \| 'underPageBackground'; appearance?: 'system' \| 'light' \| 'dark'; resizable?: boolean; fullScreen?: boolean; alwaysOnTop?: boolean; shadow?: boolean; rememberFrame?: boolean; inspector?: boolean; panelWidth?: number; panelHeight?: number; update?: string } & ({ start?: true \| 'immediately'; connect?: boolean } \| { start: false; connect?: true }) & ({ dock?: boolean; menuBarExtra?: boolean } \| { dock: 'window'; menuBarExtra: true })` | What an `onLauncher` may answer. | 38.80, 38.81, 38.142, 38.143, 38.144, 38.150, 38.151, 38.152, 38.154, 38.157, 38.158, 38.159, 38.160, 38.161, 38.162, 38.163, 38.165, 38.166, 38.168, 38.172, 38.173, 38.182, 38.183, 38.184, 38.185, 38.187 |
| `Launch` | `{ name: string; start: string \| undefined; connect: string \| undefined; fields: ConfigField[]; url: string; failure: { form: 'start' \| 'connect'; message: string; issues: Record<string, string[]> } \| undefined; focus: 'start' \| 'connect' \| undefined; icon: string \| undefined; accent: string \| undefined }` | The props a launch page is rendered with. | 38.82, 38.83, 38.87, 38.101 |

# Data and I/O

## `database`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `database` | `(file: string \| (() => string), options?: { migrations?: (string \| ((database: Database) => void))[]; openNewer?: boolean; open?: (database: Database) => void; strict?: boolean; readonly?: boolean; safeIntegers?: boolean }) => (() => Database) & { close: (options?: { remove?: boolean }) => void; changed: Reactive<number> }` | The opener of the app's `bun:sqlite` database `file`, from `@abide/abide/server`. | 36.4, 47.1, 47.2, 47.3, 47.4, 47.5, 47.6, 47.7, 47.8, 47.9, 47.10, 47.11, 47.12, 47.13, 47.14, 47.15, 47.16, 47.18, 47.19, 47.20, 47.21 |
| `opener.close` | `(options?: { remove?: boolean }) => void` | Closes the `Database` an opener holds, and with `remove` deletes the file it last opened. | 47.11, 47.16, 47.17 |
| `opener.changed` | `Reactive<number>` | How many times the opener has found another connection's commits to its file. | 47.22, 47.23, 47.24 |

## `table`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `table` | `<Row extends Record<string, unknown>>(database: Database \| (() => Database), name: string, options?: { key?: keyof Row & string }) => { readable: ReadableStream<Change<Row>>; writable: WritableStream<Row> }` | A table of the app's `bun:sqlite` database as a stream pair, its changes read out and rows upserted in, from `@abide/abide/server`. | 47.25, 47.26, 47.27, 47.28, 47.29, 47.30, 47.31 |
| `Change` | `<Row>{ op: 'insert' \| 'update' \| 'delete'; row: Row \| undefined; previous: Row \| undefined }` | One change to a row: what it is now and what it was. | 47.27 |

## `job`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `job` | `<Input = undefined>(name: string, options: { every: number \| (() => number); from?: 'end' \| 'start'; run: (input: Input \| undefined) => unknown; lastRun?: () => number \| undefined; paused?: Reactive<boolean> \| (() => boolean) }) => Job<Input>` | Work the server runs on a schedule, one run at a time, from `@abide/abide/server`. | 54.18, 54.19, 54.21, 54.23, 54.25, 54.26, 54.29, 54.38, 54.39 |
| `Job` | `<Input = undefined>{ status: Reactive<JobStatus>; runNow: (input?: Input) => Promise<JobStatus>; stop: () => Promise<JobStatus> }` | What `job` hands back. | 54.18 |
| `Job.status` | `Reactive<JobStatus>` | Where the job stands, one value for every caller. | 54.22, 54.24 |
| `Job.runNow` | `(input?: Input) => Promise<JobStatus>` | A run ahead of the schedule, handed the input it is called with. | 54.20, 54.26 |
| `Job.stop` | `() => Promise<JobStatus>` | The end of the job's schedule, and of its run in flight. | 54.26, 54.27 |
| `JobStatus` | `{ running: boolean; lastRun: string \| null; nextRun: string \| null; lastError: string \| null }` | Whether a run is going, when the last ended and the next is due, and the last run's failure. | 54.22, 54.23, 54.24, 54.25, 54.27 |

## `fetchData`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `fetchData` | `<T = unknown>(url: string \| URL, options?: FetchOptions<T>) => Promise<T \| FetchFailed>` | Another service's answer, read as its type says or as `as` names, asked with a deadline, retries and an optional cache, from `@abide/abide/server`. | 54.7, 54.8, 54.9, 54.10, 54.11, 54.12, 54.13, 54.14, 54.15, 54.16, 54.17, 54.31, 54.34 |
| `FetchOptions<T>` | `RequestInit & { as?: 'json' \| 'text' \| 'blob'; timeout?: number; retries?: number; backoff?: number \| ((retry: number) => number); ttl?: number; schema?: Schema<T> }` | `fetch`'s own options, with the reading, the deadline, the retries and their spacing, the cache and the gate beside them. | 54.7, 54.8, 54.9, 54.10, 54.12, 54.15, 54.17 |
| `FetchFailed` | `Failed<'FetchFailed', { status: number \| null; reason: 'timeout' \| 'network' \| 'status' \| 'shape' }>` | The refusal a fetch that gave up, or a `Response` `handle` read outside 2xx, settles to. | 15.9, 54.14, 54.16, 54.17, 54.31, 54.34 |

## `handle`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `handle` | `(response: Response) => Promise<unknown \| FetchFailed>` | A `Response` the app fetched itself, read as its `content-type` says: `fetch(url).then(handle)`. | 54.30, 54.31, 54.32, 54.33 |

# Assistant

## `assistant`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `assistant` | `(messages: AssistantMessage[], provider: Provider, options?: AssistantOptions) => AsyncGenerator<AssistantEvent>` | A conversation with a model, as the events it produces. | 44.1, 44.2, 44.3, 44.4, 44.21, 44.36, 44.37, 44.39, 44.57, 44.100, 44.101 |
| `AssistantMessage` | `{ role: 'user' \| 'assistant'; content: string \| AssistantContent[] }` | One turn of the transcript, as the Messages API takes it: its words, or its blocks in order. | 44.3, 44.4 |
| `AssistantContent` | `{ type: 'text'; text: string; citations?: Record<string, unknown>[]; cache_control?: { type: 'ephemeral'; ttl?: '5m' \| '1h' } } \| { type: 'image'; source: { type: 'base64'; media_type: 'image/png' \| 'image/jpeg' \| 'image/gif' \| 'image/webp'; data: string } \| { type: 'url'; url: string } \| { type: 'file'; file_id: string }; transformations?: { oversized_image?: 'downsize' \| 'error' }; cache_control?: { type: 'ephemeral'; ttl?: '5m' \| '1h' } } \| { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } \| { type: 'text'; media_type: 'text/plain'; data: string } \| { type: 'content'; content: string \| ({ type: 'text'; text: string; citations?: Record<string, unknown>[]; cache_control?: { type: 'ephemeral'; ttl?: '5m' \| '1h' } } \| { type: 'image'; source: { type: 'base64'; media_type: 'image/png' \| 'image/jpeg' \| 'image/gif' \| 'image/webp'; data: string } \| { type: 'url'; url: string } \| { type: 'file'; file_id: string }; transformations?: { oversized_image?: 'downsize' \| 'error' }; cache_control?: { type: 'ephemeral'; ttl?: '5m' \| '1h' } })[] } \| { type: 'url'; url: string } \| { type: 'file'; file_id: string }; title?: string; context?: string; citations?: { enabled: boolean }; cache_control?: { type: 'ephemeral'; ttl?: '5m' \| '1h' } } \| { type: 'search_result'; source: string; title: string; content: { type: 'text'; text: string; citations?: Record<string, unknown>[]; cache_control?: { type: 'ephemeral'; ttl?: '5m' \| '1h' } }[]; citations?: { enabled: boolean }; cache_control?: { type: 'ephemeral'; ttl?: '5m' \| '1h' } } \| { type: 'tool_use'; id: string; name: string; input: unknown; cache_control?: { type: 'ephemeral'; ttl?: '5m' \| '1h' } } \| { type: 'tool_result'; tool_use_id: string; content?: string \| Exclude<AssistantContent, { type: 'tool_use' \| 'tool_result' }>[]; is_error?: boolean; cache_control?: { type: 'ephemeral'; ttl?: '5m' \| '1h' } } \| { type: 'thinking'; thinking: string; signature: string } \| { type: 'redacted_thinking'; data: string }` | A piece of a turn, as the Messages API's content block for it: words, an image, a document, a search result, a tool call the model made, or what it answered. | 44.5, 44.36, 44.37, 44.38, 44.39, 44.55, 44.103, 53.28 |
| `AssistantEvent` | `{ type: 'message_start'; message: { id: string; type: 'message'; role: 'assistant'; model: string; content: AssistantContent[]; stop_reason: string \| null; stop_sequence: string \| null; usage: AssistantUsage } } \| { type: 'content_block_start'; index: number; content_block: AssistantContent } \| { type: 'content_block_delta'; index: number; delta: { type: 'text_delta'; text: string } \| { type: 'input_json_delta'; partial_json: string } \| { type: 'citations_delta'; citation: Record<string, unknown> } \| { type: 'thinking_delta'; thinking: string } \| { type: 'signature_delta'; signature: string } } \| { type: 'content_block_stop'; index: number } \| { type: 'message_delta'; delta: { stop_reason: string \| null; stop_sequence: string \| null }; usage: { output_tokens: number; input_tokens?: number \| null; cache_creation_input_tokens?: number \| null; cache_read_input_tokens?: number \| null; [field: string]: unknown } } \| { type: 'message_stop' } \| { type: 'ping' } \| { type: 'tool_result'; tool_use_id: string; content: AssistantContent[]; is_error: boolean; value: unknown } \| { type: 'permission'; id: string; name: string; input: unknown }` | What a conversation produces: each run as the Messages API streams it, what each tool call answered between runs with its value, and a permission prompt. | 44.2, 44.11, 44.28, 44.35, 44.48, 44.49, 44.81, 44.104 |
| `AssistantUsage` | `{ input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number \| null; cache_read_input_tokens?: number \| null; [field: string]: unknown }` | What a run used, as the Messages API counts it, and whatever else the provider reports. | 44.11 |
| `AssistantOptions` | `{ tools?: boolean; maxTurns?: number; signal?: AbortSignal }` | What `assistant` takes beside a provider. | 44.6, 44.8, 44.11, 44.57 |
| `Provider` | `{ run(messages: (AssistantMessage & { content: AssistantContent[] })[], tools: Toolbox, limits: { maxTurns: number; signal: AbortSignal }): AsyncGenerator<ProviderEvent> }` | What runs a conversation. | 44.2, 44.28, 44.39, 44.50, 44.57 |
| `ProviderEvent` | `Exclude<AssistantEvent, { type: 'tool_result' }> \| Omit<Extract<AssistantEvent, { type: 'tool_result' }>, 'value'>` | An `AssistantEvent` as a provider yields it, before `assistant` reads a call's value off the app's surface. | 44.2, 44.28, 44.35, 44.50, 44.104 |
| `Toolbox` | `{ list: ToolDefinition[]; call(name: string, input: unknown): Promise<ToolAnswer> }` | The app's MCP tools, called as the asker. | 44.6, 44.7, 44.35 |
| `ToolAnswer` | `{ content: ({ type: 'text'; text: string } \| { type: 'image'; data: string; mimeType: string })[]; isError: boolean }` | What a tool call answered, as MCP has it: its content, and whether it failed. | 20.21, 20.22, 44.35, 44.93 |
| `ToolDefinition` | `{ name: string; description: string; inputSchema: unknown; annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean }; outputSchema: unknown }` | A tool as the app's MCP surface lists it. | 20.14, 20.16, 20.19, 44.6 |

## `resultsOf`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `resultsOf` | `<Value>(messages: readonly AssistantMessage[], handler: ((...args: never) => Reactive<Value, never, unknown, unknown>) & { tool: string \| undefined }) => Value[]` | What a conversation's calls to one handler answered. | 20.13, 20.24, 44.51 |

## `assistantMessage`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `assistantMessage` | `{ (role: 'assistant', events: readonly AssistantEvent[]): AssistantMessage[]; (role: 'user' \| 'assistant', parts: readonly (string \| Blob \| URL \| AssistantContent)[]): Promise<AssistantMessage & { content: AssistantContent[] }> }` | A message as the Messages API holds it: what was written and attached, in the order given, or the messages an answer's events amount to. | 44.37, 44.52, 44.53, 44.54, 44.55, 44.105 |

## `provider`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `provider.claudeApi` | `(config: ClaudeApiConfig) => Provider` | The Claude Messages API as a provider. | 44.9, 44.10, 44.11, 44.12, 44.21, 44.35, 44.38, 44.104 |
| `ClaudeApiConfig` | `{ apiKey: string; baseURL?: string; model: string; max_tokens: number; system?: string \| unknown[]; tools?: unknown[]; [field: string]: unknown }` | A Messages API request body, less `messages` and `stream`, with the client's key and origin. | 44.9, 44.10 |
| `provider.claudeCode` | `(config?: ClaudeCodeConfig) => Provider` | The visitor's own Claude Code, reached through the bridge paired with their browser, as a provider. | 44.5, 44.13, 44.17, 44.18, 44.19, 44.33, 44.77, 44.78, 44.79, 44.81, 44.103 |
| `ClaudeCodeConfig` | `{ model?: string; fallbackModel?: string; systemPrompt?: string; appendSystemPrompt?: string; effort?: 'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'; maxBudgetUsd?: number; betas?: string[]; disallowedTools?: string[]; tools?: string[] }` | The Claude Code options a site may set for a turn, and the tools of the visitor's machine it asks for. | 44.15, 44.16, 44.29, 44.58 |
| `provider.claudeCode.bridge` | `(options?: { tools?: string[]; full?: boolean; note?: string }) => AsyncGenerator<BridgeStatus>` | This browser's pairing, as it changes. | 44.14, 44.20, 44.22, 44.32, 44.33, 44.34, 44.40, 44.56, 44.59, 44.60, 44.76, 44.85, 44.91 |
| `provider.claudeCode.callTool` | `(tool: string, input: unknown) => Promise<ToolAnswer>` | What one MCP tool of the visitor's machine answered, called through the bridge paired with their browser with no model, or by a turn where the bridge cannot make the call. | 44.93, 44.94, 44.95, 44.96, 44.97, 44.98, 44.99 |
| `provider.claudeCode.permit` | `(id: string, allow: boolean) => void` | The asking browser's answer to a `permission` event its bridge's turn is waiting on. | 44.83 |
| `BridgeStatus` | `{ paired: boolean; missing: string[]; command: string; link: string; install: string }` | Whether a bridge is paired, the tools it cannot make available, and the command and the link that pair one, with the command that installs what opens the link. | 44.20, 44.40, 44.56, 44.59, 44.60, 44.78 |
| `/__abide/bridge` | `GET`, `POST` | Where a bridge pairs, and is relayed its turns and calls. | 36.7, 44.14, 44.15, 44.19, 44.23, 44.26, 44.61, 44.63, 44.96, 44.97, 16.57, 16.78 |
| `/__abide/pairing` | `GET` | This browser's pairing, as it changes, for `pairing` to read. | 44.67, 44.68, 44.74, 44.75, 44.76, 18.36 |

## `pairing`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `pairing` | `(options?: { slowAfter?: number }) => { status: Reactive<BridgeStatus \| undefined, BridgeStatus \| undefined, Failed<'HttpError', undefined>>; step: Reactive<PairingStep>; copied: Reactive<boolean>; start: () => void; retry: () => void; copyInstall: () => Promise<void>; stop: () => void; [Symbol.dispose]: () => void }` | This browser's pairing with a Claude Code bridge, and the click that pairs one. | 44.69, 44.70, 44.71, 44.72, 44.73, 44.102, 53.41, 53.42, 53.48, 53.49 |
| `PairingStep` | `'connecting' \| 'slow' \| 'offline' \| 'unavailable' \| 'click' \| 'waiting' \| 'install' \| 'paired'` | Where a pairing stands, as the one thing a page shows for it. | 53.41, 53.42, 53.48, 53.49 |

# The native app

## `native`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `native` | `() => { version: string; name: string } \| undefined` | The version and shown name of the native app whose window the work running is for, a hint any client can claim. | 38.87, 38.140, 38.141 |
| `data-abide-titlebar` | `attribute` | The element a press drags the native app's window by. | 38.155, 38.164 |
| `--abide-titlebar-height` | `<length>` | The height of the titlebar the native app's page is drawn under. | 38.153 |
| `--abide-titlebar-inset` | `<length>` | The width the native app's window controls take from the page's start edge. | 38.153 |

## `pendingUpdate`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `pendingUpdate` | `Reactive<StagedUpdate \| undefined>` | The update the native app's window has staged, waiting for it to restart. | 38.142, 38.148, 41.32 |
| `StagedUpdate` | `class StagedUpdate { version: string; required: boolean; notes: string \| undefined }` | What `pendingUpdate` holds. | 38.146, 38.148 |
| `StagedUpdate.install` | `() => void` | Restarts the native app into the update. | 38.144, 38.145 |
| `UpdateFeed` | `{ version: string; file: string; sha256: string; required: boolean; notes: string \| null; signature: string }` | The signed feed `abide native` writes beside the zipped `.app`, which a native app reads its update from. | 38.143, 38.146, 38.147 |

## `onMenu`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onMenu` | `(read: () => readonly MenuItem[]) => () => void` | The menus a layout or a page adds to the native app's menu bar while it stands. | 38.88, 38.92, 38.170 |

## `menuItem`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `MenuItem` | `'separator' \| MenuEntry \| { label: string; key?: string; role?: MenuRole; href?: string; items?: MenuItem[] }` | One entry in the menu bar or in a menu under it. | 38.89, 38.90, 53.9 |
| `MenuRole` | `'about' \| 'hide' \| 'hideOthers' \| 'showAll' \| 'quit' \| 'connect' \| 'disconnect' \| 'close' \| 'undo' \| 'redo' \| 'cut' \| 'copy' \| 'paste' \| 'selectAll' \| 'reload' \| 'fullscreen' \| 'minimize' \| 'zoom' \| 'front' \| 'window' \| 'update'` | What the platform performs for a menu item. | 38.74, 38.89, 38.145, 38.149, 38.170, 38.177 |
| `menuItem` | `(item: { label: string; key?: string; href?: string }) => MenuEntry` | A menu item whose picks the page that filed it answers. | 38.91, 38.213 |
| `MenuEntry` | `class MenuEntry { label: string; key: string \| undefined; href: string \| undefined }` | What `menuItem` makes. | 38.91 |
| `MenuEntry.on` | `(answer: () => unknown) => () => void` | Files a function run each time the item is picked. | 38.91, 38.213, 38.214 |

# Operating

## `log`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `log` | `(...args: unknown[]) => void` | A message under the default namespace. | 28.1, 28.2 |
| `log.info` / `log.warning` / `log.error` / `log.debug` | `(...args: unknown[]) => void` | A line at one of four levels. | 28.3 |
| `log.named` | `(name: string) => Logger` | A logger under a named namespace. | 28.4, 28.5, 28.12 |
| `Logger` | `typeof log` | What `log.named` hands back. | 28.5 |
| `log.enabled` | `() => boolean` | Whether a gated line under this namespace would be written. | 28.6, 28.7 |
| `LogRecord` | `{ time: string; level: 'debug' \| 'info' \| 'warning' \| 'error'; namespace: string; message: string; trace: string; span: Span \| undefined }` | One line, as a value. | 24.3, 24.9 |
| `Span` | `{ id: string; parent: string; name: string; kind: 'server' \| 'internal'; duration: number; status: 'ok' \| 'error'; attributes: Record<string, string \| number> }` | A line's place in its trace, and how the work it timed went. | 24.4, 24.9, 24.10 |
| `log.records` | `Reactive<LogRecord[]>` | The lines kept, appended to as each is written. | 28.1 |
| `abide:request` | `debug` | One line per request. | 24.10, 28.8, 36.19 |
| `abide:socket` | `debug` | One line per frame on the socket mux. | 28.8 |
| `abide:lifecycle` | `debug` `error` | A lifecycle hook that ran or threw. | 28.8 |
| `abide:principal` | `debug` `warning` | A principal set or cleared. | 28.8 |
| `abide:health` | `warning` | An `onHealth` that threw or answered a non-object. | 25.2, 28.8 |
| `abide:mcp` | `debug` `warning` | A handler withheld from MCP, a tool call answered, or a tool published with no description. | 20.3, 20.9, 20.18, 28.8 |
| `abide:assistant` | `debug` | One line per conversation, once it ends. | 44.31 |
| `abide:openapi` | `warning` | A handler whose schema had no JSON Schema export. | 20.11, 28.8 |
| `abide:render` | `warning` | An `error.abide` that itself failed. | 28.8 |
| `abide:refuse` | `warning` | A message formatter that threw. | 15.13, 28.8 |
| `abide:reactive` | `warning` | A failed revalidation over a value still being served, a failed run of a polled one, or a failed `refreshes` after a write. | 4.12, 7.28, 16.102, 28.8 |
| `abide:watch` | `warning` | A `watch` effect or `Disposer` that threw. | 12.6, 28.8 |
| `abide:hydrate` / `abide:navigate` | `warning` | A hydration or a client-side navigation that went wrong in the browser. | 28.8, 41.10, 41.15, 41.24, 45.10 |

## `report`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `report` | `(options?: { trace?: string; failure?: unknown }) => ReportDraft` | A problem report a person can read, write and send. | 37.24, 48.1, 48.2, 48.3, 48.4, 48.5 |
| `ReportDraft` | `class ReportDraft { id: string; summary: Reactive<string>; description: Reactive<string>; traces: string[]; lines: Reactive<LogRecord[]>; markdown: Reactive<string>; open(): Promise<boolean>; send(): Promise<string> }` | A report not yet sent. | 48.6, 48.7, 48.8, 48.9, 48.12, 48.13 |
| `Report` | `{ id: string; summary: string; description: string; version: string; platform: string; route: string; traces: string[]; lines: LogRecord[]; markdown: string }` | What `onReport` is handed. | 48.7, 48.10, 48.11, 48.12 |

## `trace`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `trace` | `() => string` | The trace id of the operation this work belongs to. | 24.1 |
| `trace.sampled` | `() => boolean` | The caller's sampling decision, carried through verbatim. | 24.2 |
| `trace.span` | `<T>(name: string, body: () => T, options?: { timing?: boolean }) => T` | Opens a child span around a body. | 24.3, 24.4, 24.6, 24.7, 24.8, 24.9 |
| `trace.headers` | `() => Record<string, string>` | What an outbound request carries. | 24.5 |

## `health`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `health` | `Rpc<Health, undefined>` | The account of the app this call is in. | 16.4, 25.1, 25.2, 25.3 |
| `Health` | `interface Health { version: string; abide: string; startedAt: string }` | The app's health account, which an app widens with what its `onHealth` adds. | 25.4 |
| `version` | `string` | The app's version. | — |
| `abide` | `string` | The framework's version. | — |
| `startedAt` | `string` | When the process started, ISO-8601. | — |

# Testing and measurement

`@abide/harness`, a package of its own: three lanes, the report and gate vocabulary they share, the
rows a runner prints, and an adapter for an abide app.

## `mount`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `mount` | `(component: Component) => Promise<Mounted>` | A bound component, rendered into the document's body and hydrated there. | 38.119, 38.121, 38.134, 38.207 |
| `Mounted` | `{ stop(): void; [Symbol.dispose](): void }` | A component `mount` hydrated, until it is stopped. | 38.119 |

## `settled`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `settled` | `(options?: { timeout?: number }) => Promise<void>` | A wait until nothing a test started is still loading or pending. | 38.204, 38.205, 38.206 |

## `flushSync`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `flushSync` | `() => void` | Ends the turn: every `Effect` a write woke runs now. | 9.10, 12.11, 12.12 |

## `measure` — `@abide/harness/measure`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `measure` | `(body: () => void) => Work` | The work `body` did to the DOM, and what every published source counted while it ran. | 43.1, 43.3, 43.4, 43.6, 43.15, 43.19 |
| `Work` | `{ elementsMoved: number; markersMoved: number; textMoved: number; nodesCreated: number; attributesSet: number; classWrites: number; styleWrites: number; dataWrites: number; redundantDataWrites: number; listenersBound: number; published: PublishedWork }` | What an op did, one count per row. | 43.2, 43.6, 43.19 |

## `publishedBy` — `@abide/harness/measure`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `publishedBy` | `<Field extends string>(work: Work, source: string, fields: readonly Field[]) => Record<Field, number> \| null` | One source's counters off a `Work`. | 43.19, 43.20 |
| `PublishedWork` | `Record<string, Record<string, number>>` | The records sources publish, by source name. | 43.21 |

## `PUBLISHED_WORK_KEY` — `@abide/harness/measure`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `PUBLISHED_WORK_KEY` | `'__HARNESS_WORK__'` | The global a source publishes its record under. | 43.21 |

## `time` — `@abide/harness/measure`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `time` | `(spec: Omit<BatchSpec, 'emulated'>) => Batched` | A `batch` with whether the DOM is emulated filled in. | 43.6, 43.22, 49.2, 49.4, 49.5, 49.6 |

## `patchSet` — `@abide/harness/measure`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `patchSet` | `() => string[]` | Every DOM member the lane patches, counted or refused, as `Interface.member`. | 43.5 |

## `@abide/harness/preload`

| Name | Meaning | Rules |
| --- | --- | --- |
| `preload = ["@abide/harness/preload"]` | The `[test]` preload that registers a DOM with the measure lane's patches installed. | 43.4, 43.28, 43.35, 43.36, 43.37, 43.38, 43.39 |

## `traceOp` — `@abide/harness/engine`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `traceOp` | `(page: Page, op: string, body: () => Promise<void>) => Promise<Trace>` | One op in a Chromium page, traced. | 43.1 |
| `Trace` | `{ op: string; measures: { name: string; startNanoseconds: number; endNanoseconds: number }[]; counters: { recalcStyle: number; layout: number; paint: number; forcedLayout: number }; layers: { style: number; layout: number; script: number } }` | What the engine did over one traced op, and the user timing emitted inside it. | 43.13 |

## `shares` — `@abide/harness/engine`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `shares` | `(trace: Trace, spec: SharesSpec) => Shares` | The fraction of an op one layer took. | 43.13, 43.14 |
| `SharesSpec` | `{ layer: string; of: string; threshold: 'frame' \| 'interaction' }` | The layer, the op it is a share of, and the threshold it is judged against. | 43.13 |
| `Shares` | `{ op: string; layer: string; layerNanoseconds: number; opNanoseconds: number; ceilingCpu: number; ceilingObserved: number; threshold: 'frame' \| 'interaction'; underOneFrame: boolean; overTheThreshold: boolean }` | What `shares` hands back. | 43.14 |

## `measuresNamed` — `@abide/harness/engine`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `measuresNamed` | `(trace: Trace, name: string) => Trace['measures']` | Every user-timing measure in a trace with one name. | 43.43 |

## `durationOf` — `@abide/harness/engine`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `durationOf` | `(trace: Trace, name: string) => number` | The summed duration of the measures in a trace with one name. | 43.44, 43.45 |

## `bytes` — `@abide/harness/server`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `bytes` | `(of: unknown) => Promise<number>` | A payload's byte length, or the engine's shallow estimate of any other value. | 43.1 |

## `ticks` — `@abide/harness/server`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `ticks` | `(body: () => unknown) => Promise<number>` | The microtask turns `body`'s result took to settle. | 43.1 |

## `retained` — `@abide/harness/server`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `retained` | `(body: () => unknown) => Record<string, number>` | The live objects `body` left behind, by type. | 43.16 |

## `retainedPerRun` — `@abide/harness/server`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `retainedPerRun` | `(body: () => unknown, reps?: number) => { tagged: 'batch mean'; reps: number; perRep: Record<string, number>; growth: Record<string, number> }` | The objects each run of `body` leaves reachable, as a batch mean. | 43.17 |

## `closures` — `@abide/harness/server`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `closures` | `(body: () => unknown) => { 'Function': number; 'JSLexicalEnvironment': number }` | The functions and scopes `body` left behind. | 43.16 |

## `batch` — `@abide/harness/report`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `batch` | `(spec: BatchSpec) => Batched` | Each arm timed in interleaved batches, with an A/A floor. | 43.7, 43.8, 43.11, 43.12, 43.18, 43.22 |
| `BatchSpec` | `{ case: string; arms: Record<string, () => void>; emulated: 'dom' \| null; work?: Readonly<Record<string, Readonly<Record<string, number>>>>; n?: number; reps?: number; warmup?: number; budgetNanoseconds?: number }` | The arms `batch` interleaves, and the options that pin or bound the run. | 43.8, 43.22 |
| `Batched` | `{ case: string; n: number; reps: number; warmup: number; substrate: 'jsc' \| 'v8' \| 'spidermonkey' \| 'unknown'; floor: number; samples: Record<string, Sample> }` | What `batch` hands back. | 43.7 |
| `Sample` | `{ arm: string; case: string; n: number; reps: number; warmup: number; substrate: 'jsc' \| 'v8' \| 'spidermonkey' \| 'unknown'; emulated: 'dom' \| null; nanoseconds: number; p95: number; underOneFrame: boolean; work: Readonly<Record<string, number>> \| null }` | One arm's timing. | 43.11, 43.12 |

## `ratio` — `@abide/harness/report`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `ratio` | `(numerator: Sample, denominator: Sample, spec: RatioSpec) => Ratio` | One arm's time over another's, as the floor allows it to be said. | 43.7, 43.10 |
| `RatioSpec` | `{ floor: number; workFactor?: number }` | The floor and the work tolerance a `ratio` is judged against. | 43.7 |
| `Ratio` | `{ kind: 'ratio'; case: string; numerator: string; denominator: string; value: number; workDisagreement: string[] } \| { kind: 'underOneFrame'; case: string; numerator: string; denominator: string; workDisagreement: string[] } \| { kind: 'underTheFloor'; case: string; numerator: string; denominator: string; floor: number; workDisagreement: string[] }` | What `ratio` hands back. | 43.7 |

## `claimOf` — `@abide/harness/report`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `claimOf` | `(result: Ratio) => string` | A `Ratio` as the one line a report prints. | 43.7 |

## `emulatedDom` — `@abide/harness/report`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `emulatedDom` | `() => 'dom' \| null` | Whether the DOM in this process is emulated. | 43.22 |

## `THRESHOLDS` — `@abide/harness/report`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `THRESHOLDS` | `{ readonly frame: 16700000; readonly interaction: 100000000 }` | Where a cost crosses perception, in nanoseconds. | 43.14, 43.46 |

## `gate` — `@abide/harness/gate`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `gate` | `(name: string, spec: GateSpec, body: () => void \| Promise<void>) => void` | A test with a runnable revert. | 43.9 |
| `GateSpec` | `{ revert: () => unknown; worth: Record<string, number \| string> }` | A gate's revert and what the broken arm reports. | 43.9 |

## `spawned` — `@abide/harness/gate`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `spawned` | `(command: string[], options?: { cwd?: string; env?: Record<string, string \| undefined>; deadline?: number }) => Promise<{ exitCode: number; stdout: string; stderr: string }>` | A child process run to its end, awaited. | 43.24 |

## `atMost` — `@abide/harness/gate`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `atMost` | `<Counted extends object>(record: Counted, ceilings: { [Field in keyof Counted as Counted[Field] extends number \| null ? Field : never]?: number }) => void` | An assertion that each named field of a record is at most its ceiling. | 43.40, 43.41, 43.42 |

## `inAFreshProcess` — `@abide/harness/gate`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `inAFreshProcess` | `(source: string, workerId?: string, timeoutMilliseconds?: number) => Promise<{ ok: boolean; output: string }>` | Source run in a child bun with no DOM preloaded. | 43.25 |

## `inScope` — `@abide/harness/rows`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `RowItem` | `{ id: string; section: string; name: string }` | One entry a runner offers to run. | 43.26 |
| `RowState` | `'queued' \| 'running' \| 'done' \| 'broken'` | Where a row is in its run. | 43.27 |
| `TestRow` | `{ id: string; state: RowState; tests: number; failures: number; skipped: number; milliseconds: number; cases: TestCase[]; note: string }` | One test file's result. | 43.27 |
| `TestCase` | `{ name: string; milliseconds: number; skipped: boolean; failure: string \| null }` | One test in a file, as its report gave it. | 43.27 |
| `inScope` | `(item: RowItem, scope: string) => boolean` | Whether an item falls in a `--scope`. | 43.26 |

## `matchesFilter` — `@abide/harness/rows`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `matchesFilter` | `(item: RowItem, filter: string) => boolean` | Whether an item matches a `--filter`. | 43.26 |

## `rowsCommand` — `@abide/harness/runner`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `rowsCommand` | `<Item extends RowItem, Row>(items: Item[], run: (selected: Item[], emit: (row: Row) => void) => Promise<void>) => Promise<void>` | A runner's command line: its catalog under `--list`, else the rows of what it selects. | 43.26 |

## `testRows` — `@abide/harness/runner`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `testRows` | `(suites: TestSuite[], cwd: string) => Promise<void>` | Each test file of `suites` run in its own process, one `TestRow` per file. | 43.27 |
| `TestSuite` | `{ section: string; root: string; runner: 'bun'; pattern?: string } \| { section: string; root: string; runner: 'playwright'; projects: string[]; pattern?: string }` | One directory of test files, listed under one section. | 43.27 |

## `runBenches` — `@abide/harness/runner`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `runBenches` | `(root: string, only?: string) => Promise<Bench[]>` | Every bench under `root`'s `src`, run, with each arm's time per operation and the ceilings it went over. | 43.29, 43.30, 43.31, 43.32, 43.34 |
| `Bench` | `{ file: string; name: string; case: string; n: number; floor: number; arms: Record<string, number>; claim: string; over: string[] }` | One bench `runBenches` ran: its file, its case, and each arm's time per operation. | 43.29, 43.30, 43.31, 43.32 |
| `CEILINGS` | `Record<string, Record<string, number>>` | A bench file's export naming the most each arm of each of its benches may take, in milliseconds. | 43.29, 43.31, 43.32 |

| Name | Meaning | Rules |
| --- | --- | --- |
| `harness-bench [word]` | The command that runs `runBenches` over the directory it runs in and prints each bench. | 43.33, 43.34 |

## `measure` — `@abide/harness/abide`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `measure` | `(body: () => void) => AbideWork` | The work an op did to the DOM, with abide's own counters beside it. | 43.1, 43.19, 43.20, 43.23 |
| `AbideWork` | `Work & { wakes: number \| null; bindingRuns: number \| null; descents: number \| null }` | What `measure` hands back. | 43.23 |

## `@abide/harness/abide/preload`

| Name | Meaning | Rules |
| --- | --- | --- |
| `preload = ["@abide/harness/abide/preload"]` | The `[test]` preload that registers a DOM a test mounts into and measures, then abide's own. | 38.109, 38.119, 38.133 |

# CLI

## Commands

| Command | Meaning | Rules |
| --- | --- | --- |
| `abide scaffold <name>` | Writes a starter project. | 38.1, 38.42, 38.103, 38.104, 38.106, 38.112, 38.122, 38.124, 38.131, 38.132, 38.195, 38.218 |
| `abide run <file> [args…]` | Runs a script under the abide runtime. | 38.2, 38.57, 38.211 |
| `abide check [dir…]` | The type-checker over a `.abide` tree. | 38.3, 38.31, 38.32, 38.33, 38.40, 38.105, 38.123, 38.138, 38.196, 38.197, 38.209, 38.210, 38.212, 38.218 |
| `abide format [--check] [path…]` | The formatter over a `.abide` tree. | 38.25, 38.125, 38.126, 38.127, 38.128, 38.129, 38.137 |
| `abide routes [--json]` | Every address the app answers, the file answering it, what each matcher takes, the rungs each handler names, and where each hook is filed. | 38.108, 38.123, 38.135 |
| `abide dev [--port <n>] [--hostname <host>]` | Watches the project and keeps the app up. | 16.23, 16.56, 37.8, 37.9, 38.4, 38.14, 38.15, 38.16, 38.17, 38.19, 38.24, 38.25, 38.26, 38.28, 38.30, 38.35, 38.36, 38.37, 38.38, 38.41, 38.43, 38.58, 38.63, 38.64, 38.65, 38.94, 38.96, 38.97, 38.123, 38.136, 7.30 |
| `abide build` | Builds the client into content-hashed chunks and a manifest. | 38.43, 38.5, 38.18, 38.25, 38.26, 38.27, 38.30, 38.66, 38.94, 38.123, 38.139, 38.218 |
| `abide start [--port <n>] [--hostname <host>]` | Boots the built app. | 37.8, 37.10, 37.11, 37.12, 38.6, 38.100, 38.20, 38.21, 38.22, 38.23, 38.25, 38.26, 38.27, 38.28, 38.29, 38.58, 38.67, 38.68, 38.95, 38.97, 38.110, 38.123, 38.136, 38.139 |
| `abide [--url <origin>] [--port <n>] [--hostname <host>]` | The interactive shell — on the built app it boots, or on the running app `--url` names. | 37.8, 37.10, 37.11, 37.12, 38.6, 38.7, 38.53, 38.54, 38.55, 38.58, 38.59, 38.60, 38.62, 38.123, 38.136 |
| `abide call <address> [args]` | One call to one handler. | 38.8, 38.61, 38.110, 38.216 |
| `abide openapi [--url <origin>]` | The OpenAPI document printed rather than served. | 38.9, 38.25, 38.110, 38.111, 38.123 |
| `abide mcp [--url <origin>]` | The app's MCP server over stdio. | 38.9, 38.13, 38.25, 38.110, 38.123 |
| `abide watch <address> [args]` | A live subscription to one of the app's followed `GET`s. | 38.69 |
| `abide compile [--target] [--out] [--platforms]` | One standalone executable. | 37.8, 37.10, 37.11, 37.12, 38.10, 38.25, 38.26, 38.44, 38.45, 38.46, 38.47, 38.48, 38.49, 38.50, 38.51, 38.52, 38.56, 38.93, 38.97, 38.123, 38.136, 38.181 |
| `abide native [--out] [--required] [--notes <file>]` | A native app for the host platform, with a window on the app, and the update that installs it. | 38.10, 38.25, 38.26, 38.70, 38.71, 38.72, 38.73, 38.74, 38.75, 38.76, 38.77, 38.78, 38.79, 38.80, 38.81, 38.82, 38.83, 38.84, 38.85, 38.86, 38.87, 38.88, 38.89, 38.90, 38.91, 38.92, 38.101, 38.102, 38.123, 38.140, 38.146, 38.147, 38.174, 38.175, 38.176, 38.178, 38.179, 38.180, 38.181, 38.182, 38.186, 38.187, 38.188, 38.189, 38.190, 38.191, 38.192, 38.193, 38.194, 44.77, 44.80 |
| `abide lsp` | The `.abide` language server, over stdio. | 38.11, 38.34, 38.39, 38.98, 38.116, 38.117, 38.118, 38.130 |
| `abide upgrade [--check] [--from <version>]` | The migrations that move an app's own files past what each release since `--from` changed. | 38.25, 38.26, 38.198, 38.199, 38.200, 38.201, 38.202, 38.203, 38.215, 38.217 |
| `--help` · `-h` · `abide help` | Usage, generated from the command list. | 38.12, 38.113, 38.114 |
| `--version` · `-v` | The version of abide, or of the app a compiled executable holds. | 38.115 |

## `abide-bridge`

`@abide/bridge`, a package of its own: what a visitor runs to put their own Claude Code behind a
site's `provider.claudeCode`.

| Command | Meaning | Rules |
| --- | --- | --- |
| `abide-bridge <site> <code> [--full] [--claude <path>] [--env NAME=VALUE]… [-- <options>]` | This machine's Claude Code, paired with the browser a site minted the code for. | 44.15, 44.16, 44.24, 44.25, 44.27, 44.29, 44.30, 44.44, 44.45, 44.46, 44.47, 44.58, 44.61, 44.81, 44.82, 44.84, 44.94, 44.95, 44.96, 44.97 |
| `abide-bridge install [--full] [--claude <path>] [--env NAME=VALUE]… [-- <options>]` | What opens a site's `abide-bridge` links on this machine, registered. | 44.41, 44.42, 44.43, 44.44, 44.62, 44.64, 44.65, 44.86, 44.87, 44.88, 44.89, 44.90, 44.91, 44.92 |
| `abide-bridge uninstall` | `abide-bridge install`, undone. | 44.43 |
| `abide-bridge forget [<site>]` | The sites a link pairs with unasked, made to ask again. | 44.62, 44.66 |
