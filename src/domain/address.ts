import { err, ok, type Result } from './result.ts'

/** Type marque : une Address ne s'obtient que via createAddress, donc toujours validee. */
export type Address = string & { readonly __brand: 'Address' }

export type InvalidAddress = {
  readonly kind: 'invalid-address'
  readonly reason: 'empty' | 'too-long'
}

const MAX_LENGTH = 256

export const createAddress = (raw: string): Result<Address, InvalidAddress> => {
  const normalized = raw.trim().replace(/\s+/gu, ' ')

  if (normalized.length === 0) return err({ kind: 'invalid-address', reason: 'empty' })
  if (normalized.length > MAX_LENGTH) return err({ kind: 'invalid-address', reason: 'too-long' })

  return ok(normalized as Address)
}
