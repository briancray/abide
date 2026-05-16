import type { AppState } from '../types/AppState.ts'

// $state is intentionally mutable — Svelte reactivity model requires it
export const nav: AppState = $state({
    layouts: [],
    Page: undefined,
    params: {},
    data: {},
})
