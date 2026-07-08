import type { AsyncComputed } from './AsyncComputed.ts'

/*
A writable async cell — what `linked(await …)` / `linked(getStream())` produce. Same
probe surface as `AsyncComputed<T>` plus `set(value)`, following the normal `linked`
write rule: a local write latches until the next *reseed* (a dependency change that
produces a new source). An arriving frame or a settling promise updates the value only
while unwritten, so a high-frequency stream never clobbers an in-progress edit; a
reseed clears the write and snaps the cell back to the live source.
*/
export interface AsyncState<T> extends AsyncComputed<T> {
    set(value: T): void
}
