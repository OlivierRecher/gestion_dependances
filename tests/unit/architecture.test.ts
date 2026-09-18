import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * Le graphe de dependances, verifie automatiquement.
 *
 * Le cours propose de lire les imports pour cartographier un projet. Le faire
 * a la main ne tient pas dans la duree : une regle d'architecture qu'aucun
 * test ne defend est une convention, pas une contrainte. Ces tests echouent
 * des qu'une fleche de dependance part dans le mauvais sens, ou qu'une
 * dependance cachee reapparait quelque part.
 */

const SRC = resolve(import.meta.dirname, '../../src')

const listSources = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listSources(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })

/**
 * Retire commentaires et chaines de caracteres avant analyse.
 *
 * Sans cela, une regle se declencherait sur le mot "fetch" ecrit dans un
 * commentaire, ou sur le "//" d'une URL. On veut verifier le code, pas la
 * prose qui l'entoure. (Les litteraux d'expression reguliere ne sont pas
 * traites : aucun de ceux du projet ne contient de guillemet.)
 */
const stripCommentsAndStrings = (code: string): string => {
  let out = ''
  let index = 0
  let quote: string | null = null

  while (index < code.length) {
    const char = code[index] ?? ''
    const next = code[index + 1]

    if (quote !== null) {
      if (char === '\\') {
        index += 2
        continue
      }
      if (char === quote) {
        quote = null
        out += char
      }
      index += 1
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char
      out += char
      index += 1
      continue
    }
    if (char === '/' && next === '/') {
      while (index < code.length && code[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (index < code.length && !(code[index] === '*' && code[index + 1] === '/')) index += 1
      index += 2
      continue
    }

    out += char
    index += 1
  }

  return out
}

const SOURCES = listSources(SRC).map((path) => {
  const raw = readFileSync(path, 'utf8')
  return {
    path,
    id: relative(SRC, path),
    layer: relative(SRC, path).split('/')[0] ?? '',
    raw,
    code: stripCommentsAndStrings(raw),
  }
})

const importsOf = (file: { raw: string }): string[] =>
  [...stripCommentsAndStrings(file.raw.replace(/'([^']*)'/gu, '"$1"')).matchAll(/from\s+"([^"]+)"/gu)]
    .map((match) => match[1] ?? '')

/** Couche visee par un import relatif, du point de vue du fichier importateur. */
const layerOf = (fileId: string, specifier: string): string | undefined => {
  if (!specifier.startsWith('.')) return undefined
  const target = relative(SRC, resolve(SRC, fileId, '..', specifier))
  return target.split('/')[0]
}

/** Ce que chaque couche a le droit de connaitre. */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  domain: ['domain'],
  resilience: ['domain', 'resilience'],
  application: ['domain', 'application'],
  infrastructure: ['domain', 'infrastructure'],
  config: ['domain', 'config'],
  observability: ['observability'],
  interface: ['domain', 'application', 'interface', 'observability'],
  // La racine de composition est la seule autorisee a tout voir : c'est son role.
  composition: [
    'domain', 'application', 'resilience', 'infrastructure',
    'config', 'interface', 'observability', 'composition',
  ],
}

describe('architecture : sens des dependances', () => {
  it('couvre toutes les couches presentes dans le code', () => {
    const layers = new Set(SOURCES.map((file) => file.layer).filter((layer) => layer.endsWith('.ts') === false))

    for (const layer of layers) {
      assert.ok(layer in ALLOWED, `la couche "${layer}" n a pas de regle declaree`)
    }
  })

  it('aucune couche ne depend d une couche qui lui est interdite', () => {
    const violations: string[] = []

    for (const file of SOURCES) {
      const allowed = ALLOWED[file.layer]
      if (allowed === undefined) continue

      for (const specifier of importsOf(file)) {
        const target = layerOf(file.id, specifier)
        if (target === undefined || allowed.includes(target)) continue
        violations.push(`${file.id} -> ${target} (${specifier})`)
      }
    }

    assert.deepEqual(violations, [])
  })

  it('le domaine ne connait aucun fournisseur externe', () => {
    const domain = SOURCES.filter((file) => file.layer === 'domain')

    assert.ok(domain.length > 0)
    for (const file of domain) {
      assert.doesNotMatch(file.code, /nominatim|open-?meteo|fetch|http/iu, file.id)
    }
  })

  it('le cas d usage ignore l existence du cache et du circuit breaker', () => {
    // `domain/failures.ts` nomme volontairement `circuit-open` : c'est un
    // diagnostic expose aux clients, pas une fuite d'implementation. Le cas
    // d'usage, lui, ne doit rien en savoir.
    const business = SOURCES.filter((file) => file.layer === 'application')

    assert.ok(business.length > 0)
    for (const file of business) {
      assert.doesNotMatch(file.code, /circuit|breaker|cache/iu, file.id)
    }
  })
})

describe('architecture : dependances cachees', () => {
  const forbidIn = (pattern: RegExp, allowedFiles: readonly string[], label: string): void => {
    const offenders = SOURCES
      .filter((file) => !allowedFiles.includes(file.id))
      .filter((file) => pattern.test(file.code))
      .map((file) => file.id)

    assert.deepEqual(offenders, [], `${label} doit rester confine a : ${allowedFiles.join(', ')}`)
  }

  it('l horloge systeme n est lue qu a un seul endroit', () => {
    forbidIn(/Date\.now\(\)|new Date\(\)/u, ['infrastructure/clock/system-clock.ts', 'main.ts'], 'l horloge')
  })

  it('l environnement du processus n est lu qu au demarrage', () => {
    forbidIn(/process\.env/u, ['main.ts'], 'process.env')
  })

  it('le processus n est manipule qu au demarrage', () => {
    forbidIn(/\bprocess\./u, ['main.ts'], 'process')
  })

  it('les modules natifs de node sont confines au transport', () => {
    forbidIn(/from\s+'node:/u, ['interface/http/server.ts'], 'les modules node:')
  })

  it('un seul module connait le client HTTP concret', () => {
    forbidIn(
      /globalThis\.fetch|\bRequestInit\b/u,
      ['infrastructure/http/fetch-http-client.ts', 'main.ts'],
      'le client fetch',
    )
  })

  it('aucun appel sortant ne peut se passer de delai maximum', () => {
    for (const file of SOURCES.filter((f) => /timeoutMs/u.test(f.code) === false)) {
      assert.doesNotMatch(file.code, /http\.get\(/u, `${file.id} appelle le port HTTP sans timeout`)
    }
  })

  it('aucun etat global mutable ne subsiste dans le code', () => {
    for (const file of SOURCES) {
      assert.doesNotMatch(file.code, /^(?:export )?(?:let|var) /mu, `${file.id} declare un etat au niveau module`)
    }
  })
})
