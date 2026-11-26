// 50.26, 50.27, 50.36, 50.47, 50.53 — WHERE `tooltip.tip` SHOWS, as parts an app spreads onto markup of
// its own: the one popover every hint on the page opens in, in the top layer, so no stacking context
// covers it and no scroller clips it. Called from the script of the one component that shows the hints;
// of several standing, the last shows them and the others show none.

import { anchored } from '../anchored.ts'
import { checkPopover } from '../checkParts.ts'
import type { Side } from '../place.ts'
import { derived, reactive, watch } from '../reactive/index.ts'
import { hints, shown } from './tips.ts'

/** The parts `tooltip.host` hands back: `<span {...shown.hint}>{shown.text}</span>`. */
export type TooltipHost = {
    /** The popover: its role, a manual popover, `data-open` while a hint shows, and the side it took. */
    readonly hint: Record<string, unknown>
    /** The text of the hint showing here, or none. */
    get text(): string | undefined
}

/** The popover `tooltip.tip` shows its hints in, as parts to spread. */
export function host(): TooltipHost {
    // 50.36 — this host, among the ones standing; the last shows the hint.
    const shows = hints.stand()
    const open = derived(() => (shows() ? shown() : undefined))
    const element = reactive<HTMLElement | undefined>(undefined)
    // The side taken, which a flip can change from the one asked for.
    const placed = reactive<Side>('top')

    watch(() => {
        const popover = element()
        const tip = open()
        if (popover === undefined || tip === undefined) return
        return anchored(
            tip.anchor,
            popover,
            {
                // Every placement option the tip was given, as `popover` takes them; `delay` is the
                // tip's own and `place` reads past it.
                ...tip.options,
                side: tip.options.side ?? 'top',
                // 50.47 — a hint is never the pointer's target.
                interactive: false,
                box: tip.box,
            },
            (placement) => placed.set(placement.side),
        )
    })

    return {
        // 50.53 — every attribute the popover needs is written by the server, so it is a closed popover
        // before the page hydrates.
        hint: {
            role: 'tooltip',
            'data-tooltip': 'hint',
            popover: 'manual',
            get 'data-open'() {
                return open() === undefined ? undefined : ''
            },
            get 'data-side'() {
                return placed()
            },
            'bind:element': (popover: HTMLElement) => {
                if (process.env.NODE_ENV !== 'production')
                    checkPopover('tooltip.host', popover)
                element.set(popover)
                return () => element.set(undefined)
            },
        },
        get text() {
            return open()?.text
        },
    }
}
