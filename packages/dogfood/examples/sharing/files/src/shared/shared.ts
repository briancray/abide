// An OPT-IN TIGHTENING, not a precondition: a key declared here is
// checked against it, and a key that is not is inferred from the
// thunk. What the registry buys is that two modules cannot
// disagree about the value under one name.
declare module 'abide' {
    interface Shared {
        currency: 'USD' | 'EUR' | 'GBP'
    }
}

export {}
