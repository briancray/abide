// The isomorphic authoring surface — what an app reaches through `@abide/abide`.
// Same callable, same name, same intent on both sides: the reactive value and the
// types its probes narrow to live here, and nothing in this seam may import #ui or
// #server.
//
// ONE FACTORY. `state`, `memo` and `channel` are gone — `reactive` carries all three through its
// overloads, a channel being a value whose array every caller appends to.
//
// ONE REFUSAL TYPE beside it. `Failed` is the only thing a producer answers in place of a
// value (15.1), so it is in this seam rather than the server's: the same object crosses a
// wire, fills `s.error` and narrows through `s.isError`.
//
// EVERY NAME HERE HAS A REGISTRY ROW. What only compiled `.abide` output calls — the escaping, the
// prop cells, the share scope — is on the two entries the compiler emits imports from,
// `@abide/abide/runtime` and `@abide/abide/server/runtime`, and `coverage.test.ts` holds this
// barrel to the registry so it cannot regrow there.

// 44 — a conversation as a page sends it and is handed it back: the server's `assistant` yields it.
export type {
    AssistantContent,
    AssistantEvent,
    AssistantMessage,
} from './AssistantEvent.ts'
// 53.24-53.30 — a conversation as a chat holds it, and the namespace folding an answer into one.
export type { AssistantTurn, AssistantTurnPart } from './AssistantTurn.ts'
// 33.23 — an element's attributes, typed as a component's props.
export type { Attributes } from './Attributes.ts'
// 51.31-51.43 — a sortable table's columns, its sort, and the order its rows are in.
export type { Column } from './Column.ts'
// 52.19-52.23, 52.54-52.58 — a chart as parts, with the arithmetic under it as its members; and a pie
// and a sparkline as parts. `Chart`, `Pie` and `Sparkline` are default markup over them (49.9).
export { type ChartOptions, type ChartParts, chart } from './chart/chart.ts'
export { type PieOptions, type PieParts, pie } from './chart/pie.ts'
export {
    type SparklineOptions,
    type SparklineParts,
    sparkline,
} from './chart/sparkline.ts'
export {
    type ComboboxOptions,
    type ComboboxParts,
    combobox,
} from './combobox.ts'
export {
    type Command,
    type CommandPaletteOptions,
    type CommandPaletteParts,
    commandPalette,
} from './commandPalette.ts'
export { type Cookies, cookies } from './cookies.ts'
// 53.21-53.23 — the `bind:element` adaptor copying text on a click.
export { copyText } from './copyText.ts'
export { csp } from './csp.ts'
// 53.12-53.16 — the `bind:element` adaptor closing a panel from outside it.
// 50.1-50.4 — a native modal as a part on a `<dialog>` of the app's own.
export { type DialogOptions, type DialogParts, dialog } from './dialog.ts'
export { dismissible } from './dismissible.ts'
// 53.53 — the `bind:element` adaptor keeping a scrolling element at its bottom.
export { followBottom } from './followBottom.ts'
// 53.17-53.20 — the `bind:element` adaptor taking dropped and pasted files.
export { dropzone } from './dropzone.ts'
// 38.141 — which native window the work running is for.
export { native } from './native.ts'
// 38.148 — the update the native app's window has staged.
export { pendingUpdate, type StagedUpdate } from './pendingUpdate.ts'
export { type Failed, isFailed } from './Failed.ts'
// 53.1-53.11 — keyboard shortcuts, the fields they stand aside for, and a binding as a person reads it.
export { type Hotkey, hotkeys } from './hotkeys.ts'
export { isEditableTarget } from './isEditableTarget.ts'
export { keyLabel } from './keyLabel.ts'
export { type Menu, type MenuOptions, menu } from './menu.ts'
// 52.1-52.7 — numbers, money and time as words, the same on both sides.
export * as format from './format/index.ts'
// 25 — the account of the app.
export type { FetchFailed } from './fetchFailed.ts'
// 56.1-56.12 — a form over a handler, checked against its args document before the call.
export { type FieldName, type Form, form } from './form.ts'
export { handle } from './handle.ts'
export { type Health, health } from './health.ts'
// 44.52-44.55 — a pasted, dropped or picked image as a turn's piece.
export { imageFiles, imagePiece } from './imagePiece.ts'
export type { Issues, Paths } from './Issues.ts'
export type { JsonValue } from './JsonValue.ts'
// 51.1-51.8 — the keyboard over a list of keyed options, the one `Combobox.abide` runs on.
export { type Listbox, type ListboxOptions, listbox } from './listbox.ts'
export { isServer } from './isServer.ts'
export { jsonSchema } from './jsonSchema.ts'
export { type Logger, type LogRecord, log, type Span } from './log.ts'
// 52.8-52.16, 52.40-52.42 — markdown as markup safe to hand `raw`.
export { markdown } from './markdown/markdown.ts'
export type { LinkTarget } from './markdown/sections.ts'
export { type Report, ReportDraft, report } from './report.ts'
export type { Sort } from './Sort.ts'
export { sortRows } from './sortRows.ts'
export {
    type VirtualRows,
    type VirtualRowsOptions,
    virtualRows,
} from './virtualRows.ts'
export type { Middleware } from './Middleware.ts'
export type { Params } from './matchRoute.ts'
// 38.88 — a native app's menu items, and the hook a route's layouts and page file them with.
export {
    type MenuEntry,
    type MenuItem,
    type MenuRole,
    menuItem,
} from './menuItem.ts'
// `navigate` ALONE, of everything routing needs. This barrel is what an app resolves through the
// bare `@abide/abide` specifier, and the matcher, the pattern grammar and `routeOf` are reached by path
// from the two places that have them — the build and the client router. Putting them here would
// widen the public surface with names no clause or registry row gives an author, and drag both
// modules into the static closure of the entry every page imports.
export { media } from './media.ts'
export { navigate } from './navigate.ts'
// 32.79-32.92 — the measuring adaptors a `bind:element` takes.
export * as observe from './observe/index.ts'
export { online } from './online.ts'
export { outbox, type QueuedCall } from './outbox.ts'
// 37.16 — the browser's `onError`. `@abide/abide/server` exports the server's over it.
export { onError } from './onError.ts'
export { onMenu } from './onMenu.ts'
// 44.69 — this browser's pairing with a Claude Code bridge, and the click that pairs one.
export { pairing } from './pairing.ts'
// 37.22 — the browser's `onRefusal`, which has no server's.
export { onRefusal } from './onRefusal.ts'
// 50.19 — where a floating element sits beside its anchor.
export { type Placement, type PlaceOptions, place, type Side } from './place.ts'
export { popover } from './popover.ts'
export { type Principal, principal } from './principal.ts'
// 50.5 — a question or a message shown in the app's `Prompts`, as one namespace.
export { props } from './props.ts'
export { Raw, raw } from './Raw.ts'
export {
    busy,
    type Disposer,
    type Effect,
    flushSync,
    type Identity,
    invalidate,
    isReactive,
    type Keyed,
    NotLanded,
    type Reactive,
    type ReactiveOptions,
    reactive,
    ready,
    refresh,
    type Selection,
    type Shared,
    stopSignal,
    type Store,
    structural,
    synced,
    type Transformer,
    watch,
} from './reactive/index.ts'
export { type RangeOptions, type RangeParts, range } from './range.ts'
export { refuse } from './refuse.ts'
// 44.51 — what a conversation's calls to one handler answered.
export { resultsOf } from './resultsOf.ts'
export { route } from './route.ts'
export {
    type SortableTableOptions,
    type SortableTableParts,
    sortableTable,
} from './sortableTable.ts'
export { type Tabs, type TabsOptions, tabs } from './tabs.ts'
export { type Tree, type TreeOptions, tree } from './tree.ts'
// 52.73-52.78 — a time that stays current, as parts on a `<time>` of the app's own.
export { type TimeOptions, type TimeParts, time } from './time.ts'
export * as transcript from './transcript/index.ts'
export { type Hint, type TooltipOptions } from './tooltip/tips.ts'
export { tooltip } from './tooltip/tooltip.ts'
export type { Schema, StandardSchemaV1 } from './Schema.ts'
// 8.22, 8.34, 8.37 — the `Store`s, as one namespace: `store.web`, `store.indexedDB`, `store.cookies`.
// `@abide/abide/server` exports its own over this one, with the two a server alone has.
export * as store from './stores.ts'
// 30.1 — the address builder, and the types that read a route literal for it.
export {
    type HasParams,
    type HasSegments,
    type OptionalNames,
    type ParamsOf,
    type Query,
    type RequiredNames,
    type RestNames,
    type RouteLiteral,
    type RouteParams,
    type Routes,
    url,
} from './url.ts'
// 50.12 — notices shown in the app's `Toasts`, as one namespace.
export { validateJson } from './validateJson.ts'
