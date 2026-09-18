export type LogLevel = 'info' | 'warn' | 'error'

/**
 * Port de journalisation.
 *
 * Une librairie de logs appelee depuis 100 % des modules est le SPOF le plus
 * courant qui soit : elle contamine tout le code, et la remplacer devient un
 * chantier. Derriere cette interface de trois lignes, on peut brancher
 * `console`, un collecteur, ou rien du tout en test.
 */
export interface Logger {
  log(level: LogLevel, event: string, data?: Readonly<Record<string, unknown>>): void
}

export type LogSink = (line: string) => void

/**
 * Journal structure en JSON lines : lisible par un humain comme par un
 * agregateur. Le puits de sortie et l'horloge sont fournis par l'appelant,
 * pour que ce module n'atteigne ni `process` ni `Date`.
 */
export const createJsonLogger = (sink: LogSink, now: () => Date): Logger => ({
  log: (level, event, data) => {
    sink(JSON.stringify({ timestamp: now().toISOString(), level, event, ...data }))
  },
})

/** Aucun bruit dans la sortie des tests. */
export const silentLogger: Logger = { log: () => {} }
