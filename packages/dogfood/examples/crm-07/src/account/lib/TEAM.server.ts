/** The people who sign in to the CRM, by the email they sign in with. */
export const TEAM = [
    { id: 'maya', email: 'maya@crm.example', name: 'Maya Chen', role: 'admin' },
    { id: 'theo', email: 'theo@crm.example', name: 'Theo Park', role: 'sales' },
] as const

declare module '@abide/abide' {
    // What `onPrincipal` in signIn.ts adds; absent while nobody is signed in.
    interface Principal {
        name?: string
        role?: string
    }
}
