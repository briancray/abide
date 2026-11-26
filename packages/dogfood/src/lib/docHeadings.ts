import { reactive } from '@abide/abide'

import type { Heading } from './Heading.ts'

/** The rail every docs page shares: `Section` files its heading, a reference page files its own, and `Doc` lists them. */
export const docHeadings = reactive.shared((): Heading[] => [])
