/*
The per-request list of in-flight async-cell promises registered during an SSR
render. `createAsyncCell` pushes each settling promise here (server-side only);
`settleAsyncCells` drains and awaits them between a component's cell declarations
and its template, so the resolved values bake into the first-pass HTML (ADR-0019
Tier-2) instead of the template peeking `undefined`.
*/
export type PendingAsyncCells = {
    promises: Promise<unknown>[]
}
