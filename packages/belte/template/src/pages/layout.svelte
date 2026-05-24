<!--
Root layout. Wraps every page below src/pages/. Nest a layout.svelte deeper
to wrap a subtree (e.g. src/pages/admin/layout.svelte). Layouts compose
root-to-leaf and run on both the server (during SSR) and the client (after
hydration).
-->
<script lang="ts">
import '../app.css'

let { children }: { children: import('svelte').Snippet } = $props()
</script>

<svelte:head>
    <title>belte app</title>
</svelte:head>

<header>
    <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
    </nav>
</header>
<main>
    {@render children()}
</main>
