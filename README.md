# API Météo — TP1 « Gestion des dépendances, risques et maintenabilité »

API HTTP qui reçoit une adresse postale et renvoie les prévisions de
rayonnement solaire du lieu, en enchaînant deux services externes :

```
adresse ──▶ Nominatim (géocodage) ──▶ lat/lon ──▶ Open-Meteo (prévisions) ──▶ réponse
```

Le sujet impose couplage faible, inversion de contrôle et injection de
dépendances, avec un code testable et testé. Ce dépôt pousse la contrainte un
cran plus loin : **chaque dépendance du projet est un choix qu'on peut
justifier, isoler et remplacer.**

---

## Démarrage

Prérequis : **Node.js ≥ 24** (le projet s'exécute sans étape de build, grâce au
retrait natif des types TypeScript).

```bash
npm install     # 4 paquets, tous en devDependencies
npm start       # http://127.0.0.1:3000
```

```bash
npm test             # 142 tests unitaires + bout en bout, sans réseau (~1 s)
npm run typecheck    # tsc --noEmit
npm run verify       # typecheck + tests
npm run test:contract  # ⚠ sort sur le réseau : vérifie les vraies API
```

Configuration : voir `.env.example`. L'API démarre sans aucune variable.

---

## Endpoints

### `GET /weather?address=<adresse>`

```bash
curl 'http://127.0.0.1:3000/weather?address=Alès'
```

```json
{
  "address": "Alès",
  "location": {
    "label": "Alès, Gard, Occitanie, France métropolitaine, 30100, France",
    "latitude": 44.1253665,
    "longitude": 4.0852818
  },
  "forecast": {
    "timezone": "GMT",
    "hourly": [
      { "time": "2026-09-18T00:00", "shortwaveRadiation": 0 },
      { "time": "2026-09-18T09:00", "shortwaveRadiation": 431 }
    ]
  },
  "meta": {
    "degraded": false,
    "sources": { "geocoding": "live", "forecast": "live" }
  }
}
```

`meta.sources` indique la provenance de chaque donnée :

| Valeur | Signification |
|---|---|
| `live` | réponse directe du service |
| `cached` | cache encore valide, le service n'a pas été appelé |
| `stale` | **cache périmé servi parce que le service est tombé** |

Une réponse contenant du `stale` porte `meta.degraded: true`, l'en-tête
`Warning: 110 - "Response is stale"` et `Cache-Control: no-store`.

| Statut | Cas |
|---|---|
| `200` | prévisions disponibles (fraîches, en cache, ou périmées) |
| `400` | paramètre `address` absent, vide ou trop long |
| `404` | aucun lieu ne correspond à l'adresse |
| `503` | service externe indisponible et aucun secours en cache |

Les erreurs suivent le format `application/problem+json` (RFC 9457). Un `503`
dû aux seules prévisions **conserve le lieu déjà résolu** plutôt que de
renvoyer le client les mains vides :

```json
{
  "type": "urn:api-meteo:dependency-unavailable",
  "title": "Prévisions indisponibles",
  "status": 503,
  "detail": "Le service de previsions est indisponible (timeout).",
  "dependency": "forecast",
  "location": { "label": "Alès, Gard, France", "latitude": 44.12, "longitude": 4.08 },
  "meta": { "degraded": true, "sources": { "geocoding": "live", "forecast": "unavailable" } }
}
```

### `GET /health`

```json
{
  "status": "degraded",
  "dependencies": [
    { "name": "nominatim",  "dependency": "geocoding", "circuit": "closed", "healthy": true },
    { "name": "open-meteo", "dependency": "forecast",  "circuit": "open",   "healthy": false }
  ]
}
```

Cette sonde renvoie **toujours `200`**, même avec un circuit ouvert, et
**n'appelle aucun service externe**. Deux décisions volontaires :

- l'API est réellement vivante — elle sait encore servir du cache. Confondre sa
  santé avec celle de ses dépendances ferait redémarrer en boucle un service
  parfaitement sain parce qu'un tiers est tombé ;
- un `/health` qui interroge ses dépendances transforme la supervision en
  attaque par amplification.

---

## Architecture

```
                  ┌──────────────────────────────────────────┐
   HTTP  ────────▶│  interface/     serveur node:http,        │
                  │                 routeur, endpoints        │
                  └───────────────────┬──────────────────────┘
                                      │
                  ┌───────────────────▼──────────────────────┐
                  │  application/   cas d'usage              │
                  │                 getWeatherForAddress     │
                  └───────────────────┬──────────────────────┘
                                      │  ne connaît que des interfaces
                  ┌───────────────────▼──────────────────────┐
                  │  domain/        Address, Coordinates,    │
                  │                 Place, Forecast, ports,  │
                  │                 pannes, Result           │
                  └───────────────────▲──────────────────────┘
                                      │  implémente
                  ┌───────────────────┴──────────────────────┐
                  │  infrastructure/  Nominatim, Open-Meteo, │
                  │                   client fetch, horloge   │
                  └──────────────────────────────────────────┘

   resilience/    cache TTL, circuit breaker, décorateur — générique
   config/        lecture validée de l'environnement
   observability/ port de journalisation
   composition/   ⚡ racine de composition : le seul module qui câble le tout
```

**Toutes les flèches de dépendance pointent vers `domain/`.** Le domaine
n'importe rien. Les adaptateurs dépendent du métier, jamais l'inverse.

Cette règle n'est pas une convention : elle est **vérifiée par des tests**
(`tests/unit/architecture.test.ts`), qui lisent les imports de chaque fichier
et échouent dès qu'une flèche part dans le mauvais sens.

### Les trois exigences du sujet

| Exigence | Où la lire |
|---|---|
| **Couplage faible** | `src/domain/ports.ts` : le métier ne connaît que `GeocodingPort` et `ForecastPort`. Les mots « Nominatim » et « Open-Meteo » n'apparaissent que dans leurs adaptateurs et dans la racine de composition. |
| **Inversion de contrôle** | Aucun module ne va chercher ses dépendances. Aucun `new` dispersé, aucun singleton importé, aucun accès direct à `fetch`, `Date.now()` ou `process.env` hors des points d'entrée prévus. |
| **Injection de dépendances** | Par constructeur de fabrique : chaque `createX(deps)` reçoit ce dont il a besoin. `src/composition/container.ts` joue le rôle du conteneur IoC — en une trentaine de lignes explicites plutôt qu'avec une librairie de plus. |

### Isolation : une panne n'en entraîne pas une autre

Chaque service externe a **son propre cache et son propre disjoncteur**. Le
décorateur `withResilience` est générique et appliqué depuis l'extérieur : ni
l'adaptateur Nominatim, ni l'adaptateur Open-Meteo ne savent qu'ils sont
protégés.

| Panne | Comportement observé (testé de bout en bout) |
|---|---|
| Open-Meteo tombe, donnée en cache | `200`, `forecast: stale`, en-tête `Warning` |
| Open-Meteo tombe, rien en cache | `503` **avec le lieu déjà résolu** |
| Nominatim tombe, adresse déjà vue | `200`, `geocoding: stale` |
| Nominatim tombe, adresse inconnue | `503`, et **Open-Meteo n'est pas appelé** |
| Pannes répétées | circuit ouvert : le service en panne cesse d'être martelé |
| Le service revient | circuit semi-ouvert, une sonde, puis fermeture automatique |
| N'importe quelle panne | `/health` répond toujours, et l'autre service continue |

Les stratégies anti-SPOF listées dans le support sont toutes présentes :
**isoler derrière une interface**, **circuit breaker** et **cache pour un mode
dégradé**. Chaque appel sortant porte en outre un délai maximum obligatoire —
un test d'architecture interdit d'appeler le port HTTP sans `timeoutMs`.

---

## Dépendances

**Zéro dépendance de production.** Quatre paquets au total, tous en
`devDependencies` :

```
$ npm ls --all
api-meteo@1.0.0
├─┬ @types/node@26.6.1
│ └── undici-types@8.9.0
└─┬ typescript@7.0.2
  └── @typescript/typescript-darwin-arm64@7.0.2
```

| Besoin | Choix courant | Choix ici | Pourquoi |
|---|---|---|---|
| Serveur HTTP | Express, Fastify | `node:http` | Un routeur exact tient en 50 lignes qu'on maîtrise. |
| Client HTTP | axios, got | `fetch` natif | Injecté derrière `HttpClient` : remplaçable en un fichier. |
| Tests | Jest, Vitest | `node:test` | Intégré, aucune configuration, aucun transpileur. |
| Validation | zod, joi | gardes écrites à la main | Quatre prédicats dans `infrastructure/http/json.ts`. |
| TypeScript | tsc + build | retrait natif des types | Aucun artefact de build : `node src/main.ts`. |

L'inventaire complet — dépendances internes et externes, directes et
transitives, explicites et implicites, avec leur niveau de couplage — est dans
**[DEPENDANCES.md](./DEPENDANCES.md)**.

---

## Tests

142 tests, aucun accès réseau, environ une seconde.

| Suite | Objet |
|---|---|
| `tests/unit/domain/` | objets-valeurs et `Result` |
| `tests/unit/resilience/` | circuit breaker, cache TTL, décorateur |
| `tests/unit/infrastructure/` | client HTTP et adaptateurs, y compris réponses malformées |
| `tests/unit/application/` | cas d'usage, avec des doubles en mémoire |
| `tests/unit/interface/` | endpoints et routeur, sans socket |
| `tests/unit/config/` | validation de la configuration |
| `tests/unit/architecture.test.ts` | **règles d'architecture exécutables** |
| `tests/e2e/` | vrai serveur, vrai routeur, vrais adaptateurs, faux amonts |
| `tests/contract/` | ⚠ réseau, hors `npm test` : les vraies API tiennent-elles leur contrat ? |

Le code a été écrit en TDD : pour chaque module, les tests d'abord (rouge),
l'implémentation ensuite (vert).

Les tests de bout en bout montent **exactement la même application** que la
production, via la même racine de composition. Seuls `fetch` et l'horloge sont
remplacés — ce qui permet de simuler pannes, timeouts, expirations de cache et
ouvertures de circuit sans réseau et sans attendre.
