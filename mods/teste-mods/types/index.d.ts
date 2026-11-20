/** O resultado de validar e testar um mod. */
export type Execucao = {
  /** Nome da pasta do mod. */
  mod: string
  /** Caminho absoluto da pasta do mod. */
  pasta: string
  estado: 'rodando' | 'ok' | 'falhou'
  /** Uma linha curta: "6/6 testes", "2 erros de tipo", "1 de 6 testes falhou". */
  resumo: string
}

declare module 'claude-code' {
  interface PluginState {
    'teste-mods': { execucoes: Execucao[]; oculto: boolean; pendentes: string[] }
  }
}
