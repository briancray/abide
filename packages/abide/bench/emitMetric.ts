/*
Emits one benchmark metric in a machine-readable line the gate (`gate.ts`) greps,
alongside the human-readable bench output. Lower is always better — every metric
is a time (ms or µs/op), so the gate's regression check is a single direction.
The `##METRIC` prefix is unlikely to collide with ordinary bench prose.
*/
export function emitMetric(name: string, value: number, unit: string): void {
    console.log(`##METRIC ${name} ${value} ${unit}`)
}
