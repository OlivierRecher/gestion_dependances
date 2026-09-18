export type LogLevel = 'info' | 'warn' | 'error'

/** Port de journalisation : derriere, `console`, un collecteur, ou rien en test. */
export interface Logger {
  log(level: LogLevel, event: string, data?: Readonly<Record<string, unknown>>): void
}

export type LogSink = (line: string) => void

/** Journal en JSON lines ; le puits et l'horloge sont injectes, jamais lus depuis `process`/`Date`. */
export const createJsonLogger = (sink: LogSink, now: () => Date): Logger => ({
  log: (level, event, data) => {
    sink(JSON.stringify({ timestamp: now().toISOString(), level, event, ...data }))
  },
})

/** Aucun bruit dans la sortie des tests. */
export const silentLogger: Logger = { log: () => {} }

/** Rend un logger incapable de faire tomber son appelant : perdre une ligne vaut mieux que perdre le service. */
export const neverThrows = (logger: Logger): Logger => ({
  log: (level, event, data) => {
    try {
      logger.log(level, event, data)
    } catch {
      // par definition, impossible de journaliser cet echec
    }
  },
})
