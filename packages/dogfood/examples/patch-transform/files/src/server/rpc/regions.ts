import { GET } from 'abide/server'
import type { Region } from '#shared/regions'

const BOOKED: Region[] = [
    { id: 'north', name: 'North', orders: 120 },
    { id: 'south', name: 'South', orders: 80 },
    { id: 'east', name: 'East', orders: 64 },
    { id: 'west', name: 'West', orders: 91 },
]

export const getRegions = GET((): Region[] => BOOKED)
