import type { Address } from '../../domain/address.ts'
import type { GeocodingService } from '../../domain/ports.ts'
import { ok } from '../../domain/result.ts'

/** Coordonnees fixes (Ales) : le mode demo ne sort jamais sur le reseau. */
const DEMO_COORDINATES = { latitude: 44.1279, longitude: 4.0817 }

/** Geocodeur simule : toute adresse est resolue, sans appel externe. */
export const createDemoGeocoder = (): GeocodingService => ({
  locate: (address: Address) => Promise.resolve(ok({ label: address, coordinates: DEMO_COORDINATES })),
})
