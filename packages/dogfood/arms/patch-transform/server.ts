const BOOKED = [
    { id: 'north', name: 'North', orders: 120 },
    { id: 'south', name: 'South', orders: 80 },
    { id: 'east', name: 'East', orders: 64 },
    { id: 'west', name: 'West', orders: 91 },
]

Bun.serve({
    routes: {
        '/api/regions': () => Response.json(BOOKED),
    },
})
