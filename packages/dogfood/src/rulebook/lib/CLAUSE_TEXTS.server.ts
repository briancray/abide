import { rulebookClauses } from '#src/rulebook/lib/rulebookClauses.ts'

import RULEBOOK from '../../../../../docs/RULEBOOK.md' with { type: 'text' }

/** Each RULEBOOK clause's text by its number, read once for every server reader. */
export const CLAUSE_TEXTS = new Map<string, string>()
for (const clause of rulebookClauses(RULEBOOK))
    CLAUSE_TEXTS.set(clause.id, clause.text)
