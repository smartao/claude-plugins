/** Contagem de tokens, nos nomes curtos do painel. */
export type Tokens = { entrada: number; saida: number; cacheLido: number; cacheEscrito: number }

/** Um turno terminado: o da conversa principal ou o de um subagente. */
export type Turno = Tokens & { n: number; duracaoMs: number; modelo: string; agente: boolean }

/** Uma janela de quota (`five_hour`, `seven_day`). */
export type Limite = { tipo: string; usado: number; resetaEm?: string }

/** A última medição de uso que a sessão informou. */
export type Leitura = {
  limites: Limite[]
  contexto?: { percent?: number; tokens?: number; janela: number }
  custo?: { usd: number; precoDesconhecido: boolean }
  inicio: number
}

declare module 'claude-code' {
  interface PluginState {
    'painel-consumo': {
      leitura: Shaped<Leitura | null>
      turnos: Shaped<Turno[]>
      total: Shaped<Tokens & { turnos: number }>
      agora: number
    }
  }
}
