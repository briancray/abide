// The `transcript` namespace: a conversation as a chat holds it, folded from the events an
// assistant handler streams. EACH IN A MODULE OF ITS OWN, so a page folding answers loads no more
// than it calls.
export { fold } from './fold.ts'
export { messages } from './messages.ts'
export { turn } from './turn.ts'
