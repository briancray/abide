/*
Optional Svelte compiler configuration. Same shape as upstream Svelte.
Delete this file to use defaults.
*/

/** @type {import('belte').SvelteConfig} */
export default {
    compilerOptions: {
        // Opt in to top-level await inside Svelte components.
        experimental: { async: true },
    },
}
