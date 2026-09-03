import { state } from 'abide'

// A state holding an OBJECT is the case you hit first: a form
// binding rewrites it per keystroke and a write through a member
// path copies down the path, each of them a new reference for a
// value that did not move. `structural` is the default, so every
// one of those collapses without the option being written.
export const filters = state({ status: 'open', assignee: null })
