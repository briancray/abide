import type { Component } from 'svelte'

export type AppState = {
    layouts: Array<{ key: string; Component: Component }>
    Page: Component | undefined
    params: Record<string, string>
    data: Record<string, unknown>
}
