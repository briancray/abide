---
'@abide/abide': minor
---

After-success on a kept call is `saving.then(onDone)` — one argument. A `then` given no `onFailed` no longer reports the refusal it passes through as an unhandled rejection: the refusal already stands on `saving.error()` (RULEBOOK 2.15). An `await` still throws it, and a throw from `onDone` itself is still reported. The `() => {}` second argument every after-success site carried can go. The talk-to-the-server guide also covers a press-once form (`disabled={saving.busy() || saving.ready()}`), a union-typed kept value whose step needs one call's answer (keep that call under its own `const`), and a step that is not a call under the same busy flag and error (`saving = file.text().then((csv) => importDeals({ csv }))`).
