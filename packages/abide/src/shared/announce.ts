// 50.50-50.53 — WHAT A SCREEN READER IS TOLD, with nothing shown: the one message `Announcer` holds, read
// out from its live region as it lands. A message replaces the last rather than joining a log, and each
// lands as an element of its own, so the same words said twice are read twice.
//
// `Toasts` keeps its own region rather than announcing through this one: a notice is seen, and the
// region a screen reader reads it from is the element the reader can also see and act on, its action
// button inside it. Said here as well, its words would be read twice.

import { isServer } from './isServer.ts'
import { reactive } from './reactive/index.ts'
import { standing } from './standing.ts'

/** How urgently a message interrupts what a screen reader is reading. */
export type AnnounceOptions = {
    /** `'polite'` waits for a pause; `'assertive'` interrupts. Default `'polite'`. */
    politeness?: 'polite' | 'assertive'
}

/** The message `Announcer` holds: its words, how urgently they are read, and which message it is. */
export type Announcement = {
    text: string
    politeness: 'polite' | 'assertive'
    /** Counts up per message, so a message keys an element of its own. */
    count: number
}

// One per request on a server, as every `reactive` without `global` is (11.32), and `announce` never
// writes it there (50.51).
export const said = reactive<Announcement | undefined>(undefined)

// 50.36 — the `Announcer` standing: the last holds the message.
export const announcers = standing('<Announcer />', 'abide:announce')

let count = 0

/** Has a screen reader read `text` out, from the app's `Announcer`. */
export function announce(text: string, options: AnnounceOptions = {}): void {
    if (isServer())
        throw new Error(
            'announce reads a message to a person, and a server has none to read it to. RULEBOOK 50.51.',
        )
    announcers.asked()
    count += 1
    said.set({ text, politeness: options.politeness ?? 'polite', count })
}

/** The parts `announce.host` hands back: `<div {...regions.polite}>`, and the message each region holds. */
export type AnnouncerHost = {
    /** The polite live region: `role="status"`, `aria-live="polite"`. */
    readonly polite: Record<string, unknown>
    /** The assertive live region: `role="alert"`, `aria-live="assertive"`. */
    readonly assertive: Record<string, unknown>
    /** What the region of `politeness` holds: the message, keyed by its `count`, or none — none where another host shows it. */
    said(politeness: 'polite' | 'assertive'): readonly Announcement[]
}

/**
 * The two live regions `announce` is read out from, as parts to spread, called from the script of the
 * one component that renders them — of several standing, the last holds the message (50.36).
 */
function host(): AnnouncerHost {
    const shows = announcers.stand()
    return {
        polite: {
            role: 'status',
            'aria-live': 'polite',
            'data-announce': 'polite',
        },
        assertive: {
            role: 'alert',
            'aria-live': 'assertive',
            'data-announce': 'assertive',
        },
        said(politeness) {
            const message = said()
            return shows() && message?.politeness === politeness
                ? [message]
                : []
        },
    }
}

announce.host = host
