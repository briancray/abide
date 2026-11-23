// 52.82-52.100 — `calendar`'s parts, spread by hand as 32.11 spreads them: an attribute per string read
// at the spread, a listener per `on<event>`, and the weeks rendered again as they change. What a
// template does with them is the CRM's tests'.

import { afterEach, expect, setSystemTime, test } from 'bun:test'

import { calendar, flushSync, reactive, watch } from '#shared'

const zoneBefore = process.env.TZ

afterEach(() => {
    document.body.replaceChildren()
    setSystemTime()
    if (zoneBefore === undefined) delete process.env.TZ
    else process.env.TZ = zoneBefore
})

function spread(element: HTMLElement, part: Record<string, unknown>): void {
    const names = Object.keys(part)
    for (const name of names)
        if (name.startsWith('on'))
            element.addEventListener(name.slice(2), part[name] as EventListener)
    watch(() => {
        for (const name of names) {
            if (name.startsWith('on')) continue
            const value = part[name]
            if (value === undefined || value === false)
                element.removeAttribute(name)
            else element.setAttribute(name, value === true ? '' : String(value))
        }
    })
}

// The grids as a page writes them: a grid per month, a cell per day, all rebuilt as the months
// change. Every grid's listeners are the same functions, so the root holds them once.
function render(view: ReturnType<typeof calendar>): HTMLElement {
    const root = document.createElement('div')
    document.body.append(root)
    watch(() => {
        root.replaceChildren()
        for (const shown of view.months) {
            const grid = document.createElement('div')
            spread(grid, shown.grid)
            for (const week of shown.weeks) {
                const row = document.createElement('div')
                for (const day of week) {
                    const cell = document.createElement('div')
                    spread(cell, day.cell)
                    cell.textContent = String(day.day)
                    row.append(cell)
                }
                grid.append(row)
            }
            root.append(grid)
        }
    })
    return root
}

const weeksOf = (view: ReturnType<typeof calendar>, index = 0) =>
    view.months[index]?.weeks ?? []
const dates = (view: ReturnType<typeof calendar>) =>
    weeksOf(view).flatMap((week) => week.map((day) => day.date))

function press(key: string, shiftKey = false) {
    ;(document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }),
    )
    flushSync()
}

const focused = () => (document.activeElement as HTMLElement).id.slice(-10)

// 52.82 — WHOLE WEEKS FROM THE WEEK'S FIRST DAY. November 2026 starts on a Sunday and ends on a
// Monday, so en-US's grid is five weeks, the last six days December's.
test('the weeks are whole, and the days of other months are marked outside', () => {
    const view = calendar({ month: reactive<string | undefined>('2026-11') })
    expect(weeksOf(view)).toHaveLength(5)
    expect(weeksOf(view)[0]?.[0]?.date).toBe('2026-11-01')
    expect(weeksOf(view)[4]?.[6]?.date).toBe('2026-12-05')
    const outside = weeksOf(view)
        .flat()
        .filter((day) => day.cell['data-outside'] === '')
        .map((day) => day.date)
    expect(outside).toEqual([
        '2026-12-01',
        '2026-12-02',
        '2026-12-03',
        '2026-12-04',
        '2026-12-05',
    ])
})

// 52.83 — EVERY DAY ONCE, IN ANY ZONE. March 2026 springs forward in New York and London, and
// October falls back; a grid stepped in local milliseconds repeats or drops a day there. THE REVERT:
// step `new Date(year, month, 1).getTime() + index * DAY`, and a fall-back month repeats a day.
test('a daylight-saving change drops and repeats no day, in every zone', () => {
    for (const zone of [
        'America/New_York',
        'Europe/London',
        'Australia/Lord_Howe',
    ]) {
        process.env.TZ = zone
        for (const month of ['2026-03', '2026-04', '2026-10', '2026-11']) {
            const view = calendar({
                month: reactive<string | undefined>(month),
            })
            const all = dates(view)
            for (let index = 1; index < all.length; index += 1)
                expect(
                    Date.parse(all[index] as string) -
                        Date.parse(all[index - 1] as string),
                ).toBe(86_400_000)
            expect(all.filter((date) => date.startsWith(month)).length).toBe(
                new Date(
                    Date.UTC(
                        Number(month.slice(0, 4)),
                        Number(month.slice(5)),
                        0,
                    ),
                ).getUTCDate(),
            )
        }
    }
})

// 52.87 — THE LOCALE'S WEEK. Germany's starts on Monday, and `firstDay` overrides any locale's.
test("a week starts on the locale's first day, or on the one given", () => {
    const german = calendar({
        locale: 'de-DE',
        month: reactive<string | undefined>('2026-11'),
    })
    expect(german.weekdays.map((day) => day.short)).toEqual([
        'Mo',
        'Di',
        'Mi',
        'Do',
        'Fr',
        'Sa',
        'So',
    ])
    expect(german.weekdays[0]?.header.abbr).toBe('Montag')
    expect(weeksOf(german)[0]?.[0]?.date).toBe('2026-10-26')
    expect(german.months[0]?.label).toBe('November 2026')
    const saturday = calendar({
        firstDay: 6,
        month: reactive<string | undefined>('2026-11'),
    })
    expect(saturday.weekdays[0]?.name).toBe('Saturday')
    expect(weeksOf(saturday)[0]?.[0]?.date).toBe('2026-10-31')
})

// 52.84, 52.85 — TODAY IS THE ZONE'S. At 03:00 UTC on the 22nd it is still the 21st in Los Angeles,
// and with no month written the grid shows today's.
test("today is the zone's day, and the month shown with none written", () => {
    setSystemTime(new Date('2026-11-01T03:00:00Z'))
    const view = calendar({ timeZone: 'America/Los_Angeles' })
    expect(view.month()).toBe('2026-10')
    const today = weeksOf(view)
        .flat()
        .filter((day) => day.cell['data-today'] === '')
    expect(today.map((day) => day.date)).toEqual(['2026-10-31'])
    expect(today[0]?.cell['aria-current']).toBe('date')
})

// 52.86, 52.88 — ONE DAY IN THE TAB ORDER, and the arrows move it by a day and by a week; Home and End
// go to the ends of its week. THE REVERT: step ArrowDown by one day, and the 11th lands on the 12th.
test('the arrows move a day and a week, Home and End to the ends of the week', () => {
    const selected = reactive<string | undefined>('2026-11-11')
    const view = calendar({ selected })
    const grid = render(view)
    expect(grid.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
    ;(grid.querySelector('[tabindex="0"]') as HTMLElement).focus()
    expect(focused()).toBe('2026-11-11')
    press('ArrowDown')
    expect(focused()).toBe('2026-11-18')
    press('ArrowLeft')
    expect(focused()).toBe('2026-11-17')
    press('Home')
    expect(focused()).toBe('2026-11-15')
    press('End')
    expect(focused()).toBe('2026-11-21')
    press('ArrowUp')
    expect(focused()).toBe('2026-11-14')
    expect(grid.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
})

// 52.89, 52.90 — PAGING BY KEY keeps the day where the month has it, and the month follows. THE
// REVERT: drop the clamp, and January's 31st pages to March 3rd.
test("PageDown keeps the day where the month has it, and shows the day's month", () => {
    const selected = reactive<string | undefined>('2027-01-31')
    const view = calendar({ selected })
    const grid = render(view)
    ;(grid.querySelector('[tabindex="0"]') as HTMLElement).focus()
    press('PageDown')
    expect(focused()).toBe('2027-02-28')
    expect(view.month()).toBe('2027-02')
    press('PageUp', true)
    expect(focused()).toBe('2026-02-28')
    press('ArrowRight')
    expect(focused()).toBe('2026-03-01')
    expect(view.month()).toBe('2026-03')
    expect(view.months[0]?.label).toBe('March 2026')
})

// 52.91, 52.92, 52.95 — ENTER PICKS THE ACTIVE DAY, a click the one it lands in.
test('Enter picks the day focused, and a click the day clicked', () => {
    const selected = reactive<string | undefined>('2026-11-11')
    const view = calendar({ selected })
    const grid = render(view)
    ;(grid.querySelector('[tabindex="0"]') as HTMLElement).focus()
    press('ArrowRight')
    press('Enter')
    expect(selected.peek()).toBe('2026-11-12')
    const picked = grid.querySelectorAll('[aria-selected=true]')
    expect(picked).toHaveLength(1)
    expect(picked[0]?.hasAttribute('data-selected')).toBe(true)
    ;(document.getElementById(`${view.id}-2026-12-02`) as HTMLElement).click()
    flushSync()
    expect(selected.peek()).toBe('2026-12-02')
    expect(view.month()).toBe('2026-12')
    expect(focused()).toBe('2026-12-02')
})

// 52.93 — THE BUTTONS PAGE THE MONTH and leave focus on themselves.
test('previous and next show the month before and after, focus staying put', () => {
    const view = calendar({ month: reactive<string | undefined>('2026-01') })
    const back = document.createElement('button')
    const on = document.createElement('button')
    spread(back, view.previous)
    spread(on, view.next)
    document.body.append(back, on)
    back.focus()
    back.click()
    flushSync()
    expect(view.month()).toBe('2025-12')
    expect(document.activeElement).toBe(back)
    on.click()
    on.click()
    expect(view.month()).toBe('2026-02')
    expect(back.getAttribute('aria-controls')).toBe(
        view.months[0]?.grid.id as string,
    )
})

// 52.96 — MONTHS SIDE BY SIDE ARE ONE CALENDAR: one day in the tab order across every grid, the arrows
// crossing from one grid into the next without paging, and a day another grid holds focusable only
// there. THE REVERT: give an outside copy its id, and December 1st has two cells by one id.
test('two months share one tab stop, and the arrows cross between their grids', () => {
    const selected = reactive<string | undefined>('2026-11-30')
    const view = calendar({ selected, months: 2 })
    expect(view.months.map((shown) => shown.label)).toEqual([
        'November 2026',
        'December 2026',
    ])
    const root = render(view)
    expect(root.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
    expect(root.querySelectorAll(`[id="${view.id}-2026-12-01"]`)).toHaveLength(
        1,
    )
    const copy = weeksOf(view, 0)
        .flat()
        .find((day) => day.date === '2026-12-01')
    expect(copy?.cell.id).toBeUndefined()
    expect(copy?.cell.tabindex).toBeUndefined()
    ;(root.querySelector('[tabindex="0"]') as HTMLElement).focus()
    press('ArrowRight')
    expect(focused()).toBe('2026-12-01')
    expect(view.month()).toBe('2026-11')
    expect(root.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
    // 52.90 — out past the last month shown, the months page by the one month that shows it.
    press('PageDown')
    expect(focused()).toBe('2027-01-01')
    expect(view.month()).toBe('2026-12')
    expect(view.next['aria-controls']).toBe(
        `${view.months[0]?.grid.id} ${view.months[1]?.grid.id}`,
    )
})

// 52.97, 52.98 — A RANGE: the first pick a start, the next its end, swapped where it falls before
// the start, and a pick after that a start again. THE REVERT: drop the swap, and the end lands before
// the start with no day between them picked.
test('a range picks a start, then an end, swapped where it falls before the start', () => {
    const selected = reactive<
        readonly [string, string | undefined] | undefined
    >(undefined)
    const view = calendar({
        range: true,
        selected,
        month: reactive<string | undefined>('2026-11'),
    })
    const root = render(view)
    const click = (date: string) => {
        ;(document.getElementById(view.idOf(date)) as HTMLElement).click()
        flushSync()
    }
    expect(
        root.querySelector('[role=grid]')?.getAttribute('aria-multiselectable'),
    ).toBe('true')
    click('2026-11-20')
    expect(selected.peek()).toEqual(['2026-11-20', undefined])
    expect(root.querySelectorAll('[aria-selected=true]')).toHaveLength(1)
    click('2026-11-17')
    expect(selected.peek()).toEqual(['2026-11-17', '2026-11-20'])
    const picked = [...root.querySelectorAll('[data-selected]')].map((cell) =>
        cell.id.slice(-10),
    )
    expect(picked).toEqual([
        '2026-11-17',
        '2026-11-18',
        '2026-11-19',
        '2026-11-20',
    ])
    expect(root.querySelectorAll('[aria-selected=true]')).toHaveLength(4)
    expect(
        document
            .getElementById(view.idOf('2026-11-17'))
            ?.hasAttribute('data-range-start'),
    ).toBe(true)
    expect(
        document
            .getElementById(view.idOf('2026-11-20'))
            ?.hasAttribute('data-range-end'),
    ).toBe(true)
    click('2026-11-25')
    expect(selected.peek()).toEqual(['2026-11-25', undefined])
})

// 52.99 — THE PREVIEW follows the keys while a range has a start and no end, and is gone once it
// has one. THE REVERT: read the preview from the day picked rather than the day focused, and it
// never leaves the start.
test('while a range has no end, the days up to the one focused are previewed', () => {
    const selected = reactive<
        readonly [string, string | undefined] | undefined
    >(['2026-11-10', undefined])
    const view = calendar({ range: true, selected })
    const root = render(view)
    ;(document.getElementById(view.idOf(view.active)) as HTMLElement).focus()
    press('ArrowRight')
    press('ArrowRight')
    const previewed = () =>
        [...root.querySelectorAll('[data-preview]')].map((cell) =>
            cell.id.slice(-10),
        )
    expect(previewed()).toEqual(['2026-11-10', '2026-11-11', '2026-11-12'])
    press('Enter')
    expect(selected.peek()).toEqual(['2026-11-10', '2026-11-12'])
    expect(previewed()).toEqual([])
})

// 52.100 — ACTIVE AND IDOF put focus on the day the keys move from, from outside the grid: what a
// popover opening on the calendar does.
test('active is the day in the tab order, and idOf its cell', () => {
    const view = calendar({
        selected: reactive<string | undefined>('2026-11-11'),
    })
    const root = render(view)
    expect(view.active).toBe('2026-11-11')
    const cell = document.getElementById(view.idOf(view.active))
    expect(cell).toBe(root.querySelector('[tabindex="0"]'))
    cell?.focus()
    press('ArrowDown')
    expect(view.active).toBe('2026-11-18')
    expect(document.activeElement?.id).toBe(view.idOf('2026-11-18'))
})
