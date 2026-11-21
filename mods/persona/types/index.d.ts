/** Uma persona achada numa pasta `personas/` do projeto. */
export type Persona = {
  /** O número do início do nome do arquivo (`01-cliente-final.md` → 1), ou null sem número. */
  numero: number | null
  /** O título do arquivo sem o prefixo "Persona N —" (`Cliente final`). */
  titulo: string
  /** O caminho que vai no `@` do prompt: relativo ao diretório da sessão, ou absoluto fora dele. */
  caminho: string
  /** A pasta `personas/` onde ela está, no mesmo formato de `caminho`. */
  pasta: string
}

declare module 'claude-code' {
  interface PluginState {
    persona: { lista: Shaped<Persona[]> }
  }
}
