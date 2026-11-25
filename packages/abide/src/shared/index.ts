// The isomorphic authoring surface — what an app reaches through `@abide/abide`.
// Same callable, same name, same intent on both sides: the reactive value and the
// types its probes narrow to live here, and nothing in this seam may import #ui or
// #server.
//
// TWO FACTORIES OVER ONE TYPE. `reactive` holds a value and `memo` runs a body, and both hand back a
// `Reactive` — a channel is a `reactive` whose array every caller appends to.
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
    AssistantUsage,
} from './AssistantEvent.ts'
// 44.52-44.55, 44.105 — a message as a visitor writes it, or as an answer's events amount to it.
export { assistantMessage } from './assistantMessage.ts'
// 33.23 — an element's attributes, typed as a component's props.
export type { Attributes } from './Attributes.ts'
// 53.61-53.78, 53.99-53.101 — a scroll-snap carousel resting on a selection, as parts.
export { type Carousel, type CarouselOptions, carousel } from './carousel.ts'
// 51.30-51.41 — a sortable table's columns, its sort, and the order its rows are in.
export type { Column } from './Column.ts'
// 52.19-52.23, 52.53-52.57 — a chart as parts, with the arithmetic under it as its members; and a pie
// and a sparkline as parts.
export { type ChartOptions, type ChartParts, chart } from './chart/chart.ts'
export { type PieOptions, type PieParts, pie } from './chart/pie.ts'
export {
    type SparklineOptions,
    type SparklineParts,
    sparkline,
} from './chart/sparkline.ts'
export {
    type ComboboxChip,
    type ComboboxOptions,
    type ComboboxParts,
    combobox,
} from './combobox.ts'
export {
    type Command,
    type CommandPaletteOptions,
    type CommandPaletteParts,
    type CommandParts,
    commandPalette,
} from './commandPalette.ts'
// 53.31-53.40, 53.109 — a conversation over an assistant handler, as parts, and its calls to one handler.
export { type ChatCall } from './callsOf.ts'
export {
    type ChatOptions,
    type ChatParts,
    type ChatMessageParts,
    type ChatPermission,
    chat,
} from './chat.ts'
export { type Cookies, cookies } from './cookies.ts'
// 53.21, 53.23, 53.79 — the part copying on a click.
export { copy } from './copy.ts'
// 53.22, 53.54, 53.55, 53.103 — the write `copy` makes, for a handler of the app's own.
export { copyToClipboard } from './copyToClipboard.ts'
export { csp } from './csp.ts'
// 50.1-50.4 — a native modal as a part on a `<dialog>` of the app's own.
export { type DialogOptions, type DialogParts, dialog } from './dialog.ts'
// 53.12-53.16 — the part closing a panel from outside it.
export {
    type DismissibleOptions,
    type DismissibleParts,
    dismissible,
} from './dismissible.ts'
// 53.50, 53.58-53.60 — a scrolling element kept at its bottom, and the button taking a reader back down.
export {
    type Autoscroll,
    type AutoscrollOptions,
    autoscroll,
} from './autoscroll.ts'
// 32.101-32.108 — the part marking the edges a scrolling element can scroll toward.
export { scrollEdges } from './scrollEdges.ts'
// 53.17-53.20 — the parts taking dropped and pasted files.
export {
    type DropzoneOptions,
    type DropzoneParts,
    dropzone,
} from './dropzone.ts'
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
export { type FieldName, type Form, type FormField, form } from './form.ts'
export { handle } from './handle.ts'
export { type Health, health } from './health.ts'
export type { Issues, Paths } from './Issues.ts'
export type { JsonValue } from './JsonValue.ts'
// 51.1-51.8 — the keyboard over a list of keyed options, the one `combobox` runs on.
export { type Listbox, type ListboxOptions, listbox } from './listbox.ts'
export type { LabelRun } from './labelRuns.ts'
export type { Picked } from './Selection.ts'
export { isServer } from './isServer.ts'
export { jsonSchema } from './jsonSchema.ts'
export { type Logger, type LogRecord, log, type Span } from './log.ts'
// 52.8-52.16, 52.40-52.42 — markdown as markup safe to hand `raw`.
export { markdown } from './markdown/markdown.ts'
export type { MarkdownSection } from './markdown/markdownIncremental.ts'
export type { LinkTarget } from './markdown/sections.ts'
export { type Report, ReportDraft, report } from './report.ts'
export type { Sort } from './Sort.ts'
export { sortBy } from './sortBy.ts'
export type { Sections } from './sections.ts'
export { type ScrollSpyOptions, scrollSpy } from './scrollSpy.ts'
export {
    type VirtualList,
    type VirtualListEntry,
    type VirtualListOptions,
    type VirtualListSection,
    virtualList,
} from './virtualList.ts'
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
// 32.79-32.92 — the parts measuring the element they are spread on.
export { elementRect } from './element/elementRect.ts'
export { elementSize } from './element/elementSize.ts'
export { elementVisible } from './element/elementVisible.ts'
export { online } from './online.ts'
export { outbox, type QueuedCall } from './outbox.ts'
// 37.16 — the browser's `onError`. `@abide/abide/server` exports the server's over it.
export { onError } from './onError.ts'
export { onMenu } from './onMenu.ts'
// 44.69 — this browser's pairing with a Claude Code bridge, and the click that pairs one.
export { type PairingStep, pairing } from './pairing.ts'
// 37.22 — the browser's `onRefusal`, which has no server's.
export { onRefusal } from './onRefusal.ts'
// 58 — events appended and read in order, from a position or a named cursor.
export {
    type Ledger,
    type LedgerOptions,
    type Logged,
    type LogStore,
    ledger,
} from './ledger.ts'
// 57 — steps an item runs through, under a budget, with retries.
export { type Pipe, type PipeOptions, type PipeStatus, pipe } from './pipe.ts'
// 50.19, 50.20 — where a floating element sits beside its anchor.
export type { Side } from './place.ts'
export { type PopoverOptions, type PopoverParts, popover } from './popover.ts'
export { type Principal, principal } from './principal.ts'
export { props } from './props.ts'
export { Raw, raw } from './Raw.ts'
export {
    busy,
    deepEqual,
    type Disposer,
    type Effect,
    flushSync,
    type Identity,
    invalidate,
    isReactive,
    type Keyed,
    memo,
    NotLanded,
    type Reactive,
    type ReactiveOptions,
    reactive,
    ready,
    refresh,
    type Selection,
    type Shared,
    abortSignal,
    type Store,
    synced,
    type Transformer,
    watch,
} from './reactive/index.ts'
export {
    type SliderEnd,
    type SliderOptions,
    type SliderParts,
    slider,
} from './slider.ts'
export { refuse } from './refuse.ts'
// 44.51 — what a conversation's calls to one handler answered.
export { resultsOf } from './resultsOf.ts'
export { route } from './route.ts'
export {
    type SortableTableColumn,
    type SortableTableOptions,
    type SortableTableParts,
    type SortableTableRow,
    sortableTable,
} from './sortableTable.ts'
export { type TabParts, type Tabs, type TabsOptions, tabs } from './tabs.ts'
export { type Toggle, type ToggleOptions, toggle } from './toggle.ts'
export {
    type Disclosure,
    type DisclosureOptions,
    disclosure,
} from './disclosure.ts'
export {
    type Accordion,
    type AccordionOptions,
    accordion,
} from './accordion.ts'
export { type Clamp, type ClampOptions, clamp } from './clamp.ts'
export { type Spoiler, type SpoilerOptions, spoiler } from './spoiler.ts'
export {
    type Breadcrumbs,
    type BreadcrumbsOptions,
    breadcrumbs,
} from './breadcrumbs.ts'
export {
    type InlineEdit,
    type InlineEditOptions,
    inlineEdit,
} from './inlineEdit.ts'
export { type Meter, type MeterOptions, meter } from './meter.ts'
export { highlight } from './highlight.ts'
export { type ShrinkImageOptions, shrinkImage } from './shrinkImage.ts'
export { download } from './download.ts'
export {
    type Pagination,
    type PaginationOptions,
    pagination,
} from './pagination.ts'
export {
    type PanZoom,
    type PanZoomOptions,
    type PanZoomView,
    panZoom,
} from './panZoom.ts'
export { type Playback, type PlaybackOptions, playback } from './playback.ts'
export { type Drawer, type DrawerOptions, drawer } from './drawer.ts'
export { type Lightbox, type LightboxOptions, lightbox } from './lightbox.ts'
export {
    type Spinbutton,
    type SpinbuttonOptions,
    spinbutton,
} from './spinbutton.ts'
export {
    type SortableItem,
    type SortableList,
    type SortableListOptions,
    sortableList,
} from './sortableList.ts'
export { type Wizard, type WizardOptions, wizard } from './wizard.ts'
export {
    type Resizable,
    type ResizableOptions,
    resizable,
} from './resizable.ts'
export {
    type ToggleGroup,
    type ToggleGroupOptions,
    toggleGroup,
} from './toggleGroup.ts'
export { type Tree, type TreeNode, type TreeOptions, tree } from './tree.ts'
// 51.157-51.165 — a JSON value to search and inspect, as `tree`'s parts and a search field.
export {
    type JsonInspector,
    type JsonInspectorOptions,
    type JsonKind,
    type JsonRow,
    type JsonRowParts,
    jsonInspector,
} from './jsonInspector.ts'
// 52.72-52.77 — a time that stays current, as parts on a `<time>` of the app's own.
export { type TimeAt, type TimeOptions, type TimeParts, time } from './time.ts'
// 52.82-52.100 — months of days or a range the keys move through and pick, as parts on grids of the app's own.
export {
    type Calendar,
    type CalendarDay,
    type CalendarMonth,
    type CalendarOptions,
    type CalendarPick,
    type CalendarWeekday,
    calendar,
} from './calendar.ts'
// 52.102, 52.103 — the instant a day and a time name in a zone.
export { instantAt } from './instantAt.ts'
export * as outlet from './outlet.ts'
export * as tooltip from './tooltip/index.ts'
// 50.5 — the queued questions, shown where `prompts.host` is spread.
export * as prompts from './prompts/index.ts'
export type { PromptOptions } from './prompts/queue.ts'
// 50.12 — lists of notices, each shown where its `host` is spread, and the one abide builds.
export {
    type CloseReason,
    type Notice,
    type NoticeParts,
    type Notices,
    type NoticesHost,
    type NoticesHostOptions,
    type NoticesOptions,
    type NotifyOptions,
    notices,
} from './notices.ts'
export { toasts } from './toasts.ts'
// 50.49 — words read out to a screen reader, from the live regions `announce.host` hands back.
export {
    type Announcement,
    type AnnounceOptions,
    type AnnouncerHost,
    announce,
} from './announce.ts'
export { type TooltipOptions } from './tooltip/tips.ts'
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
export { validateJson } from './validateJson.ts'
