// logging

// The suite module by NAME, statically: this page's bundle is then its own suite and nothing else.
// Reaching it through the registry would put every suite in the graph — and `compiler` brings
// TypeScript's scanner, so `/logging` would ship a compiler it never runs.
import suite from '../demos/logging.ts'
import { page } from './page.ts'

page(suite)
