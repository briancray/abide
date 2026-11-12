// The `observe` namespace: adaptors a `bind:element` takes, each measuring its element into a
// `Reactive` or a callback (32.9). EACH IN A MODULE OF ITS OWN, so a page using one loads none of
// the others' observers (`pageWeight.test.ts`).
export { rect } from './rect.ts'
export { size } from './size.ts'
export { visible } from './visible.ts'
