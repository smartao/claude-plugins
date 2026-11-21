/** O tipo de persona, que dá a cor do ícone e do número no painel. */
export type Grupo = 'usuario' | 'tecnica' | 'negocio' | 'outra'

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
  /** Um emoji: o `icone:` do arquivo, ou escolhido pelo nome. */
  icone: string
  grupo: Grupo
  /** A cor do ícone e do número: o `cor:` do arquivo, ou a do grupo. */
  cor: string
  /** Uma linha sobre o foco: a coluna Foco do README da pasta, ou o começo de "## Quem é". */
  foco: string
}

declare module 'claude-code' {
  interface PluginState {
    persona: {
      lista: Shaped<Persona[]>
      /** Os caminhos das personas que estão no começo do prompt agora. */
      marcadas: string[]
    }
  }
}
