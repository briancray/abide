<script lang="ts">
let { data }: { data: { user: string } } = $props()
</script>

<h1 class="text-3xl font-bold">Dashboard</h1>
<p class="mt-2 text-slate-600">
  Hi, <strong>{data.user}</strong>. This page redirects to <code>/login</code> when no session
  cookie is present.
</p>
