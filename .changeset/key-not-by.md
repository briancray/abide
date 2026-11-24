---
'@abide/abide': minor
---

**What tells one element from another is `key`, everywhere.** `reactive`'s `by` option is now `key`, and a `{#for}` names its key with `key` where it used `by`: `{#for deal of deals key deal.id}`. It is the word the parts functions' `key`, the server's `table(…, { key })`, and every other framework's list key already use. A `{#for}` with no key still takes its `Reactive`'s, as it took its `by` (RULEBOOK 32.32), and a `GET`'s value carries `key` to its browser copy as it carried `by`.

`key` is a common name, so in a `{#for}` head it is the separator only where it follows the subject: `{#for letter of key}`, `{#for letter of a + key}` and `{#for letter of key.split('')}` all walk `key` and name no row key.

**Breaking**:

- `reactive(value, { by })` → `reactive(value, { key })`, and the same on `memo` and every value a body declares.
- `{#for item of list by expression}` → `{#for item of list key expression}`. `abide format` writes the new spelling once the source is changed; the build refuses nothing new, so a `by` left in a template is read as part of the subject and fails to type-check.
