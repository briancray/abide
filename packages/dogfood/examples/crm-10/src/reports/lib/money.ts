const USD = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
})

/** One formatter for every won deal's amount, built once rather than per amount. */
export const money = {
    format: (amount: number): string => USD.format(amount),
}
