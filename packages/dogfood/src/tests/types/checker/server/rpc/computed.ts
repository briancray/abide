// Endpoints whose argument types have to be COMPUTED, which is where the token scanner stops and the
// checker starts. Nothing imports this: it is a fixture for `abide/compiler/shapes`, and the point of
// each declaration is that its shape is not spelled anywhere a scanner could read it.

import { GET, POST } from 'abide/server'
import type { Full, Role } from '#tests/types/checker/sample.ts'

/** `Omit` — the create form of a record, which is how a create endpoint is usually typed. */
export const create = POST((args: Omit<Full, 'id'>) => ({ ...args, id: 1 }))

/** `Pick`, and an `enum` member: a value declaration the scanner has no way to read as a type. */
export const byRole = GET((args: { role: Role; only: Pick<Full, 'id' | 'name'> }) => args.only)

/** A generic alias, instantiated. */
export const boxed = GET((args: Box<string>) => args.value)

type Box<T> = { value: T; count: number }
