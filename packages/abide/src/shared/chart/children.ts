// 52.24, 52.53 — HOW A `Line`, `Column` OR `Area` REACHES THE `Chart` IT IS SLOTTED INTO: the chart
// shares one list under a key (10.5), and each child puts a getter for its series on it for as long as
// it is mounted. A getter rather than the series, so a prop that moves redraws the chart without the
// child leaving the list and coming back at its end.

import { reactive } from '../reactive/index.ts'
import type { Reactive } from '../reactive/Reactive.ts'
import { watch } from '../reactive/watch.ts'
import { register } from '../register.ts'
import type { Series } from './index.ts'

/** A child of a `Chart`, as the chart's list holds it. */
export type ChartChild = { series: () => Series }

/**
 * Puts `series` on the list of the `Chart` this child is slotted into, until the child is removed.
 *
 * The chart shares the list from its own `<script>`, where the compiler sees the call and opens the
 * scope it is held in; this finds it from below.
 */
export function joinChart(series: () => Series): void {
    const children: Reactive<readonly ChartChild[]> = reactive.share(
        'abide:chart',
        () => reactive<readonly ChartChild[]>([]),
    )
    const declared: ChartChild = { series }
    // `register` reads with `peek`, so the watch reads nothing and runs once: a read of the list would
    // rerun it on every sibling's arrival, taking this child off and putting it back at the end.
    watch(() => register(children, declared))
}
