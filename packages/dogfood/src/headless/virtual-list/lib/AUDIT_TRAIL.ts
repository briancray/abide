// Every change made in the CRM this year, newest first: 5,000 of them, past the thousand rows at
// which mounting all of a list costs a frame (`bench:virtual`).
const WHO = ['Ada', 'Grace', 'Linus', 'Margaret']
const DID = [
    'moved a deal to Proposal',
    'logged a call',
    'edited a phone number',
    'closed a deal as won',
    'added a contact',
]
const NOW = Date.UTC(2026, 10, 20, 9)
const HOUR = 3_600_000

export const AUDIT_TRAIL = Array.from({ length: 5000 }, (_, index) => ({
    id: index,
    at: new Date(NOW - index * HOUR)
        .toISOString()
        .slice(0, 16)
        .replace('T', ' '),
    change: `${WHO[index % WHO.length]} ${DID[index % DID.length]}`,
}))
