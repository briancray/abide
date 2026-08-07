// transport

// The suite module by NAME, statically: this page's bundle is then its own suite and nothing else.
// This page DOES ship TypeScript's scanner, because its elision case calls the real `elide` — the
// claim a reader comes here for is "the browser gets the address and not the body", and it is worth
// a page nobody profiles carrying the compiler that makes it.
import suite from '../demos/transport.ts'
import { page } from './page.ts'

page(suite)
