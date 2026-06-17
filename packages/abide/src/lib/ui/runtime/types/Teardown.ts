/*
The cleanup an effect or attachment body may return. Optionally async — abide runs
it but never awaits it, so teardown never blocks the reactive flush.
*/
export type Teardown = () => void | Promise<void>
