// 49.4, 49.10, 49.11 — EVERY PARTS FUNCTION IN ONE SHAPE, listed here so a new one is a decision rather
// than an omission: each element's part names it as `data-part` (49.4), each option an app binds is
// optional and handed back (49.10), and the parts are a member per element there is one of and a
// function per item, never a reader taking no argument or an optional one that changes the answer
// (49.11).

import { afterEach, expect, test } from 'bun:test'

import { POST } from '#server'
import { addressed } from '#server/addressed.ts'
import {
    chart,
    type ChartParts,
    combobox,
    type ComboboxChip,
    type ComboboxParts,
    commandPalette,
    type CommandPaletteParts,
    type CommandParts,
    dialog,
    type DialogParts,
    dropzone,
    type DropzoneParts,
    type Form,
    form,
    type FormField,
    type Listbox,
    listbox,
    type Menu,
    menu,
    pie,
    type PieParts,
    range,
    type RangeEnd,
    type RangeParts,
    sortableTable,
    type SortableTableColumn,
    type SortableTableParts,
    type SortableTableRow,
    sparkline,
    type SparklineParts,
    type TabParts,
    type Tabs,
    tabs,
    time,
    type TimeAt,
    type TimeParts,
    type Tree,
    tree,
    type TreeNode,
} from '#shared'
import { host as promptsHost } from '#shared/prompts/host.ts'
import type { PromptsHost } from '#shared/prompts/host.ts'
import { collectWatches } from '#shared/reactive/watch.ts'
import { host as toastsHost } from '#shared/toasts/host.ts'
import type { ToastParts, ToastsHost } from '#shared/toasts/host.ts'
import { host as tooltipHost } from '#shared/tooltip/host.ts'
import type { TooltipHost } from '#shared/tooltip/host.ts'

afterEach(() => document.body.replaceChildren())

// A host stands as a component's setup stands it: its watches collected, and stopped after.
function standing<Parts>(make: () => Parts): Parts {
    const stops: (() => void)[] = []
    const previous = collectWatches(stops)
    const parts = make()
    collectWatches(previous)
    afterEach(() => {
        for (const stop of stops) stop()
    })
    return parts
}

type Row = { id: string; name: string }
const COLUMN = { key: 'name', label: 'Name' } as const
const ROW: Row = { id: 'ada', name: 'Ada' }
const COMMAND = { label: 'Open', run: () => {} }
// A handler, as `form` is handed one: what it posts to and how it is called.
const ADD = POST((args: { name: string }) => args)
addressed(ADD, '/deals/shape')

// 49.11 — the members a parts type may not have: a function taking nothing that answers a value, or
// one whose first argument is optional, so calling it two ways answers two things. A `Reactive`
// handed back is a value read by name, and a function answering nothing is an action.
type Misshapen<Parts> = {
    [Key in keyof Parts]-?: Parts[Key] extends { peek: unknown }
        ? never
        : Parts[Key] extends (...given: infer Given) => infer Answer
          ? Given extends []
              ? Answer extends void
                  ? never
                  : Key
              : [] extends Given
                ? Key
                : never
          : never
}[keyof Parts]

// Refused by the checker where `Parts` has a member 49.11 refuses, naming it.
function shaped<Parts>(
    ..._: [Misshapen<Parts>] extends [never] ? [] : [Misshapen<Parts>]
): void {}

// THE REVERT: type `Tabs`'s `panel` as `panel(key?: string)` again, and `bun run typecheck` names it.
test('every part is a member, a function of its item, or an action — 49.11', () => {
    shaped<Tabs>()
    shaped<TabParts>()
    shaped<Menu>()
    shaped<Listbox<string>>()
    shaped<Tree<string>>()
    shaped<TreeNode>()
    shaped<RangeParts>()
    shaped<RangeEnd>()
    shaped<CommandPaletteParts>()
    shaped<CommandParts>()
    shaped<ComboboxParts<string>>()
    shaped<ComboboxChip>()
    shaped<SortableTableParts<Row>>()
    shaped<SortableTableColumn>()
    shaped<SortableTableRow>()
    shaped<DialogParts>()
    shaped<TimeParts>()
    shaped<TimeAt>()
    shaped<ToastsHost>()
    shaped<ToastParts>()
    shaped<PromptsHost>()
    shaped<TooltipHost>()
    shaped<ChartParts>()
    shaped<PieParts>()
    shaped<SparklineParts>()
    shaped<Form<typeof ADD>>()
    shaped<FormField>()
    shaped<DropzoneParts>()
    expect(true).toBe(true)
})

// Every element part each parts function hands back, built with the least each takes.
function elementParts(): Record<string, unknown> {
    const view = tabs({ keys: ['a'] })
    const opener = menu()
    const nodes = tree<string>({ roots: ['a'], children: () => undefined })
    const slider = range({ label: 'Amount' })
    const palette = commandPalette({ commands: [COMMAND] })
    const box = combobox({ options: () => ['a'], multiple: true })
    const table = sortableTable({
        rows: [ROW],
        columns: [COLUMN],
        key: (row) => row.id,
    })
    const modal = dialog()
    const seen = time()
    const notices = standing(() => toastsHost())
    const asked = standing(() => promptsHost())
    const hints = standing(() => tooltipHost())
    const plot = chart({
        label: 'Won',
        series: () => [{ label: 'Won', values: [1, 2], kind: 'column' }],
    })
    const ring = pie({ label: 'Mix', slices: [{ label: 'a', value: 1 }] })
    const trend = sparkline({ label: 'Trend', values: [1, 2] })
    const deal = form(ADD)
    const drop = dropzone()
    const toast = {
        id: 1,
        text: 'Saved',
        tone: 'info',
        attributes: {},
    } as unknown as Parameters<ToastsHost['toast']>[0]
    return {
        'tabs.list': view.list,
        'tabs.panel': view.panel,
        'tabs.tab.button': view.tab('a').button,
        'tabs.tab.panel': view.tab('a').panel,
        'menu.trigger': opener.trigger,
        'menu.menu': opener.menu,
        'tree.tree': nodes.tree,
        'tree.node.item': nodes.node('a').item,
        'tree.node.group': nodes.node('a').group,
        'range.root': slider.root,
        'range.track': slider.track,
        'range.fill': slider.fill,
        'range.end.thumb': slider.end(0).thumb,
        'range.end.input': slider.end(0).input,
        'commandPalette.dialog': palette.dialog,
        'commandPalette.input': palette.input,
        'commandPalette.listbox': palette.listbox,
        'commandPalette.empty': palette.empty,
        'commandPalette.command.option': palette.command(COMMAND).option,
        'commandPalette.command.label': palette.command(COMMAND).label,
        'commandPalette.command.key': palette.command(COMMAND).key,
        'combobox.root': box.root,
        'combobox.input': box.input,
        'combobox.popup': box.popup,
        'combobox.listbox': box.listbox,
        'combobox.empty': box.empty,
        'combobox.chips': box.chips,
        'combobox.option': box.option('a'),
        'combobox.chip.chip': box.chip('a').chip,
        'combobox.chip.remove': box.chip('a').remove,
        'sortableTable.table': table.table,
        'sortableTable.column.header': table.column(COLUMN).header,
        'sortableTable.column.sort': table.column(COLUMN).sort,
        'sortableTable.column.cell': table.column(COLUMN).cell,
        'sortableTable.row.row': table.row(ROW).row,
        'sortableTable.row.select': table.row(ROW).select,
        'sortableTable.row.checkbox': table.row(ROW).checkbox,
        'sortableTable.row.detail': table.row(ROW).detail,
        'sortableTable.selectAll.select': table.selectAll.select,
        'sortableTable.selectAll.checkbox': table.selectAll.checkbox,
        'dialog.dialog': modal.dialog,
        'time.at.time': seen.at(0).time,
        'toasts.host.region': notices.region,
        'toasts.host.toast.toast': notices.toast(toast).toast,
        'toasts.host.toast.text': notices.toast(toast).text,
        'toasts.host.toast.action': notices.toast(toast).action,
        'toasts.host.toast.close': notices.toast(toast).close,
        'prompts.host.dialog': asked.dialog,
        'prompts.host.form': asked.form,
        'prompts.host.title': asked.title,
        'prompts.host.body': asked.body,
        'prompts.host.field': asked.field,
        'prompts.host.input': asked.input,
        'prompts.host.error': asked.error,
        'prompts.host.confirm': asked.confirm,
        'prompts.host.cancel': asked.cancel,
        'prompts.host.actions': asked.actions,
        'tooltip.host.hint': hints.hint,
        'chart.svg': plot.svg,
        'chart.tip': plot.tip,
        'chart.yTicks.grid': plot.yTicks[0]?.grid,
        'chart.yTicks.text': plot.yTicks[0]?.text,
        'chart.xTicks.text': plot.xTicks[0]?.text,
        'chart.marks.columns': plot.marks[0]?.columns,
        'chart.bars.rect': plot.bars[0]?.rect,
        'chart.points.circle': plot.points[0]?.circle,
        'pie.svg': ring.svg,
        'pie.slices.circle': ring.slices[0]?.circle,
        'sparkline.svg': trend.svg,
        'sparkline.line': trend.line,
        'sparkline.area': trend.area,
        'sparkline.bars': trend.bars,
        'sparkline.dot': trend.dot,
        'form.form': deal.form,
        'form.error': deal.error,
        'form.submit': deal.submit,
        'form.field.input': deal.field('name').input,
        'form.field.error': deal.field('name').error,
        'dropzone.host': drop.host,
        'dropzone.input': drop.input,
    }
}

// THE REVERT: drop `'data-part': 'list'` from `tabs`'s list, and `tabs.list` is named.
test('every element part names its element as data-part — 49.4', () => {
    const unnamed: string[] = []
    for (const [name, part] of Object.entries(elementParts()))
        if (
            typeof (part as Record<string, unknown> | undefined)?.[
                'data-part'
            ] !== 'string'
        )
            unnamed.push(name)
    expect(unnamed).toEqual([])
})

// A `Reactive` the parts read and write: called for its value, and set.
const held = (value: unknown): boolean =>
    typeof value === 'function' &&
    typeof (value as { set?: unknown }).set === 'function'

// THE REVERT: hand back `combobox`'s parts without `value`, and `combobox.value` is named.
test('every option an app binds is optional and handed back, and every id is made — 49.10', () => {
    const view = tabs({ keys: ['a', 'b'] })
    const opener = menu()
    const nodes = tree<string>({ roots: ['a'], children: () => undefined })
    const slider = range({ label: 'Amount', min: 10, max: 40 })
    const palette = commandPalette({ commands: [COMMAND] })
    const box = combobox({ options: () => ['a', 'b'] })
    const table = sortableTable({
        rows: [ROW],
        columns: [COLUMN],
        key: (row) => row.id,
    })
    const modal = dialog()
    const keys = listbox({ options: () => ['a'] })
    const drop = dropzone()
    const handed: Record<string, unknown> = {
        'tabs.selected': view.selected,
        'menu.open': opener.open,
        'tree.expanded': nodes.expanded,
        'tree.selected': nodes.selected,
        'range.value': slider.value,
        'commandPalette.open': palette.open,
        'combobox.value': box.value,
        'sortableTable.sort': table.sort,
        'sortableTable.selected': table.selected,
        'dialog.open': modal.open,
        'dropzone.files': drop.files,
    }
    const missing: string[] = []
    for (const [name, value] of Object.entries(handed))
        if (!held(value)) missing.push(name)
    expect(missing).toEqual([])
    // Each starts from its default, and a write is what is read.
    expect(view.selected()).toBe('a')
    view.selected.set('b')
    expect(view.selected()).toBe('b')
    expect(slider.value()).toEqual([10, 40])
    expect(box.value()).toBeUndefined()
    expect(drop.files()).toEqual([])
    // An id made where none was given, readable among the parts.
    expect(box.id).toMatch(/^combobox-/)
    expect(box.input.id).toBe(box.id)
    expect(keys.id).toMatch(/^listbox-/)
    // A string is its own key and label.
    expect(box.option('a').id).toBe(
        keys.idOf('a').replace(keys.id, `${box.id}`),
    )
})

// 33.5 — AN OPTION HANDED AS AN ACCESSOR STAYS LIVE: a shipped component hands its props over as
// accessors, and the parts read them as they are used, so a prop that changes after mount reaches
// the markup. THE REVERT: destructure `labels` in `range` (or `label` in `commandPalette`, or `key` in
// `combobox`) at setup -> the old value stays.
test('options handed as accessors are read as they are used — 33.5', () => {
    let labels: readonly [string, string] = ['Least', 'Most']
    let named = 'Commands'
    let keyOf = (item: string) => item
    const slider = range({
        label: 'Amount',
        get labels() {
            return labels
        },
    })
    const palette = commandPalette({
        commands: [COMMAND],
        get label() {
            return named
        },
    })
    const box = combobox({
        options: () => ['a'],
        get key() {
            return keyOf
        },
    })
    const before = [
        slider.end(0).thumb['aria-label'],
        palette.listbox['aria-label'],
        box.option('a').id,
    ]
    labels = ['Floor', 'Ceiling']
    named = 'Actions'
    keyOf = (item) => `${item}-moved`
    const after = [
        slider.end(0).thumb['aria-label'],
        palette.listbox['aria-label'],
        box.option('a').id,
    ]
    expect(before.slice(0, 2)).toEqual(['Least', 'Commands'])
    expect(after.slice(0, 2)).toEqual(['Floor', 'Actions'])
    expect(after[2]).not.toBe(before[2])
})
