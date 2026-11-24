/** What each stage a deal moves through means, in a sentence. */
export const STAGE_MEANINGS: Record<string, string> = {
    lead: 'Someone showed interest. Nobody has talked to them yet.',
    qualified: 'They have a budget and a reason to buy.',
    proposal: 'A quote is out, waiting on an answer.',
    won: 'Signed. It counts toward the target.',
}
