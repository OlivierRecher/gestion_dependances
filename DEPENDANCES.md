# Inventaire des dépendances

> Exercice du Jour 1 : inventorier au moins 10 dépendances d'un projet, les
> classer (interne/externe, directe/transitive, explicite/implicite), évaluer
> leur couplage, et désigner la plus inquiétante.

Appliqué à ce projet.

---

## 1. Inventaire

| # | Dépendance | Nature | Interne / Externe | Directe / Transitive | Explicite / Implicite | Couplage | Isolée derrière |
|---|---|---|---|---|---|---|---|
| 1 | **Nominatim** (OpenStreetMap) | Service HTTP tiers | Externe | Directe | Explicite | **Faible** | `GeocodingPort` + `nominatim-geocoder.ts` |
| 2 | **Open-Meteo** | Service HTTP tiers | Externe | Directe | Explicite | **Faible** | `ForecastPort` + `open-meteo-forecaster.ts` |
| 3 | **Format de réponse Nominatim** (`display_name`, `lat`, `lon`, `[] = introuvable`) | Contrat de données | Externe | Directe | **Implicite** | **Faible** | `toPlace()`, un seul fichier |
| 4 | **Format de réponse Open-Meteo** (séries parallèles `hourly.time` / `hourly.shortwave_radiation`) | Contrat de données | Externe | Directe | **Implicite** | **Faible** | `toForecast()`, un seul fichier |
| 5 | **Politique d'usage Nominatim** (`User-Agent` obligatoire, quota) | Contrainte contractuelle | Externe | Directe | **Implicite** | Moyen | Configuration + traduction du `429` |
| 6 | **Runtime Node.js ≥ 24** | Plateforme | Externe | Directe | **Implicite** | **Fort** | `engines` dans `package.json` |
| 7 | **`node:http`** | Module natif | Externe | Directe | Explicite | **Faible** | `interface/http/server.ts`, seul importateur |
| 8 | **`fetch` (global)** | API de plateforme | Externe | Directe | **Implicite** | **Faible** | `HttpClient` + injection de `FetchLike` |
| 9 | **Horloge système** (`Date.now()`) | Contexte d'exécution | Externe | Directe | **Implicite** | **Faible** | `ClockPort` + `system-clock.ts` |
| 10 | **Variables d'environnement** | Configuration | Externe | Directe | **Implicite** | **Faible** | `loadConfig(env)`, `env` passé en paramètre |
| 11 | **`process`** (`exitCode`, signaux, `stdout`) | Contexte d'exécution | Externe | Directe | **Implicite** | **Faible** | `main.ts` uniquement |
| 12 | **TypeScript** | Outil de dev | Externe | Directe | Explicite | **Faible** | `devDependency`, aucun artefact en production |
| 13 | **`@types/node`** | Types de dev | Externe | Directe | Explicite | **Faible** | `devDependency` |
| 14 | **`undici-types`** | Types | Externe | **Transitive** (via `@types/node`) | **Implicite** | **Faible** | Types uniquement, aucun code exécuté |
| 15 | **`@typescript/typescript-darwin-arm64`** | Binaire natif | Externe | **Transitive** (via `typescript`) | **Implicite** | **Faible** | Outil de dev, dépend de la plateforme |
| 16 | **`node:test` / `node:assert`** | Harnais de test | Externe | Directe | Explicite | Moyen (tests only) | Intégré au runtime |
| 17 | `domain/` ← `application/` | Module | **Interne** | Directe | Explicite | Moyen (voulu) | — |
| 18 | `domain/ports.ts` ← `infrastructure/` | Module | **Interne** | Directe | Explicite | **Faible** | Le domaine ignore ses adaptateurs |
| 19 | `resilience/` ← `composition/` | Module | **Interne** | Directe | Explicite | **Faible** | Décorateur générique, applicable ailleurs |
| 20 | Contrat HTTP public (`/weather`, `/health`, formes JSON) | API exposée | **Interne→Externe** | Directe | Explicite | **Fort** (nos clients) | DTO distincts des types du domaine |

**Constat.** Sur 20 entrées, **10 sont implicites** : formats de données,
horloge, environnement, runtime, contexte du processus. C'est exactement ce que
le support désigne comme la catégorie la plus dangereuse — invisible dans le
`package.json`, invisible dans les imports.

Le travail d'architecture a consisté à **rendre chacune explicite** : une
interface, un paramètre injecté, ou un fichier unique qui la contient.

---

## 2. La dépendance la plus inquiétante

### 🔴 Le runtime Node.js ≥ 24 (ligne 6)

C'est la seule dépendance à **couplage fort** que nous ne contrôlons pas.

**Pourquoi elle inquiète, selon les critères du cours :**

- **Fréquence** — 100 % des modules s'exécutent dessus.
- **Rôle métier** — sans elle, rien ne tourne. SPOF absolu.
- **Contrôle** — nous ne pouvons ni la corriger ni la remplacer.
- **Non isolée** — aucune interface ne peut s'interposer entre un programme et
  son runtime.

**Ce qui l'aggrave dans ce projet précisément :** nous nous appuyons sur le
retrait natif des types TypeScript et sur `node:test`, deux fonctionnalités
récentes. C'est le prix assumé du « zéro dépendance » — nous avons déplacé le
risque des paquets npm vers la plateforme.

**Ce qui l'atténue :**

- `engines: { node: ">=24" }` échoue tôt et bruyamment ;
- le code reste du TypeScript standard, compilable par `tsc` si le retrait
  natif disparaissait (`erasableSyntaxOnly` garantit qu'aucune syntaxe
  non-effaçable ne s'est glissée dans le code) ;
- `node:test` est remplaçable par Vitest sans toucher une ligne de logique :
  les tests n'utilisent que `describe` / `it` / `assert`.

### 🟠 Mention : Nominatim (ligne 1)

Couplage faible côté code, mais c'est la dépendance la plus **fragile
opérationnellement** : service bénévole, quota d'une requête par seconde, et
blocage sans `User-Agent` identifiable.

Les parades sont en place — cache, circuit breaker, traduction du `429` en
`rate-limited`, `User-Agent` configurable — et elle reste remplaçable en un
fichier (API Adresse de l'État, Photon, Google).

---

## 3. Les quatre méthodes de recherche du cours, appliquées

| Méthode | Résultat sur ce projet |
|---|---|
| **1. Repérer les imports** | Aucun import de paquet tiers dans `src/`. Uniquement des imports relatifs et `node:http`. Automatisé dans `tests/unit/architecture.test.ts`. |
| **2. Traquer les appels réseau** | Deux destinations, toutes deux passant par `HttpClient`. Un test interdit d'appeler le port HTTP sans délai maximum. |
| **3. Lire les manifestes** | `package.json` : `dependencies: {}`. `npm ls --all` : 4 paquets. `npm audit` : 0 vulnérabilité. |
| **4. Suivre l'accès aux ressources** | Aucune base de données, aucun fichier, aucun secret. Le seul état est le cache en mémoire, borné par `CACHE_MAX_ENTRIES`. |

### Les dépendances cachées, transformées en règles exécutables

Le support cite quatre sources classiques de dette technique. Chacune est
désormais tenue par un test qui échoue si elle réapparaît ailleurs :

| Dépendance cachée | Règle appliquée |
|---|---|
| Configuration et environnement | `process.env` n'est lisible que dans `main.ts` |
| Singletons et état global | aucun `let` / `var` au niveau module dans `src/` |
| Outils externes | aucun module `node:` hors de `interface/http/server.ts` |
| Contexte d'exécution (horloge) | `Date.now()` n'existe que dans `system-clock.ts` |

```bash
npm run test:arch
```

---

## 4. Commandes d'audit

```bash
npm audit --audit-level=low   # 0 vulnérabilité
npm ls --all                  # arbre complet : 4 paquets
npm outdated                  # dérive de versions
```

Les versions sont épinglées à l'exact (`--save-exact`) : aucune mise à jour ne
peut arriver sans qu'on la décide.
