// The `observe` namespace: parts, each measuring the element it is spread on into a
// `Reactive` or a callback (32.9). EACH IN A MODULE OF ITS OWN, so a page using one loads none of
// the others' observers (`pageWeight.test.ts`).
export { rect } from './rect.ts'
export { size } from './size.ts'
export { visible } from './visible.ts'
