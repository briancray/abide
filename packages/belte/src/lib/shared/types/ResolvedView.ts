import type { Component } from 'svelte'

/*
The mounted shape of one resolved route: the page (or error) component plus
the nearest layout wrapping it, ready for App.svelte's `state.render` slot.
*/
export type ResolvedView = {
    Page: Component
    Layout: Component | undefined
}
