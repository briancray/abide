import { subscribe } from './store.js'

const RATE = { USD: 1, EUR: 0.92, GBP: 0.79 }
const SIGN = { USD: '$', EUR: '€', GBP: '£' }

// One instance. Every one of them registers, and every one of them
// hands back the teardown its owner now has to hold and call — the
// bookkeeping the key does not have, multiplied by the instances.
export function money(amount) {
    const element = document.createElement('b')
    const stop = subscribe((currency) => {
        const shown = (amount * RATE[currency]).toFixed(2)
        element.textContent = `${SIGN[currency]}${shown}`
    })
    return { element, stop }
}
