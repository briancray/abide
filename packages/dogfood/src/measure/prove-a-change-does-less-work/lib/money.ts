const USD = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
})

/** Every amount goes through this one formatter. */
export const money = {
    format: (amount: number): string => USD.format(amount),
}
