---
"@abide/abide": minor
---

Add a path-addressed hydration-divergence signal on the DEBUG-gated `hydrate` channel (`DEBUG=hydrate`, or `localStorage['abide-debug'] = 'hydrate'` in the browser). With the channel off, behavior is unchanged — a claim divergence still throws the hard guard and the router recovers cold. With it on: a **text** divergence warns with the render-path of the enclosing component/branch/row and keeps hydrating, so one reload surfaces every mismatch instead of aborting at the first; a **structural** divergence names its path before throwing; and an **attribute** divergence — previously invisible, since binding always overwrote the server value — now warns too. The render-path is coarse (it locates the component, the detail names the value) and the compiled class/style/prop setters aren't covered yet. No new public API.
