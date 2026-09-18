import { err, ok, type Result } from '../../domain/result.ts'

/**
 * Garde-fous de lecture de JSON tiers.
 *
 * Le format de reponse d'une API externe est une dependance implicite : rien
 * ne le verrouille, il peut changer sans previs. Ces fonctions transforment ce
 * risque silencieux -- `undefined` qui se propage jusqu'au client -- en une
 * erreur explicite et locale.
 *
 * Ecrites a la main : une librairie de validation serait une dependance de
 * plus pour quatre predicats.
 */
export const parseJson = (body: string): Result<unknown, 'invalid-json'> => {
  try {
    return ok(JSON.parse(body) as unknown)
  } catch {
    return err('invalid-json')
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

/** Accepte un nombre ou sa forme textuelle : Nominatim renvoie `"44.12"`. */
export const asFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || value.trim() === '') return undefined

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export const asArray = (value: unknown): readonly unknown[] | undefined =>
  Array.isArray(value) ? value : undefined

export const asStringArray = (value: unknown): readonly string[] | undefined => {
  const items = asArray(value)
  if (items === undefined) return undefined

  const strings = items.map(asString)
  return strings.every((item) => item !== undefined) ? strings : undefined
}

/** Les series numeriques d'Open-Meteo peuvent contenir des trous (`null`). */
export const asNullableNumberArray = (value: unknown): readonly (number | null)[] | undefined => {
  const items = asArray(value)
  if (items === undefined) return undefined

  const numbers = items.map((item) => (item === null ? null : asFiniteNumber(item)))
  return numbers.every((item) => item !== undefined) ? (numbers as readonly (number | null)[]) : undefined
}
