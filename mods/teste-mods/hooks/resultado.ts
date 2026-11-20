import type { Execucao } from '../types'

/** Saída de um processo, só o que o resumo precisa. */
export type Saida = { exitCode: number; stdout: string; stderr: string }

const ANSI = /\x1b\[[0-9;]*m/g

const texto = (s: Saida) => `${s.stdout}\n${s.stderr}`.replace(ANSI, '')

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/**
 * Junta as saídas de `claude plugin validate` e `claude plugin test` num
 * estado e numa linha curta. Erros de tipo contam como falha, mesmo que o
 * validate os chame de aviso.
 */
export function resumir(validate: Saida, teste: Saida | undefined): Pick<Execucao, 'estado' | 'resumo'> {
  const v = texto(validate)
  const errosTipo = (v.match(/error TS\d+/g) ?? []).length
  if (validate.exitCode !== 0 || /✘|Validation failed/.test(v)) {
    return { estado: 'falhou', resumo: 'validação falhou' }
  }
  if (errosTipo > 0) {
    return { estado: 'falhou', resumo: plural(errosTipo, 'erro de tipo', 'erros de tipo') }
  }
  if (teste === undefined) return { estado: 'ok', resumo: 'validado' }

  const t = texto(teste)
  const passou = Number(/(\d+) pass\b/.exec(t)?.[1] ?? 0)
  const falhou = Number(/(\d+) fail\b/.exec(t)?.[1] ?? 0)
  const total = passou + falhou

  if (falhou > 0) {
    return {
      estado: 'falhou',
      resumo: `${falhou} de ${plural(total, 'teste', 'testes')} ${falhou === 1 ? 'falhou' : 'falharam'}`,
    }
  }
  if (teste.exitCode !== 0) return { estado: 'falhou', resumo: 'testes não rodaram' }
  if (total === 0) return { estado: 'ok', resumo: 'validado, sem testes' }
  return { estado: 'ok', resumo: `${passou}/${total} testes` }
}

/** Uma execução como aparece na faixa: `✅ contexto 2/2 testes`. */
export function linha(x: Execucao): string {
  const icone = x.estado === 'rodando' ? '⏳' : x.estado === 'ok' ? '✅' : '❌'
  return `${icone} ${x.mod} ${x.estado === 'rodando' ? 'testando…' : x.resumo}`
}

// Comandos de Bash que podem mudar arquivos. `2>/dev/null` e `2>&1` não contam.
const MUTA = /(\bsed\s+(-\S+\s+)*-i|\bperl\s+-\w*i|(?<![0-9&=>])>(?!&)|\btee\b|\bmv\b|\bcp\b|\brm\b|\bmkdir\b|\btouch\b|\bpatch\b|\bpython3?\b|\bnode\b|\bgit\s+(checkout|restore|apply|reset|stash|mv|rm|revert|cherry-pick|merge|rebase|pull)\b)/

/**
 * Os caminhos que um comando de Bash pode ter alterado: as palavras com `/`,
 * quando o comando parece escrever algo. Uma aproximação: um caminho a mais só
 * custa uma rodada de testes à toa.
 */
export function caminhosDoBash(comando: string): string[] {
  if (!MUTA.test(comando)) return []
  return comando
    .split(/[\s'"`;|&()<>=]+/)
    .filter(p => p.includes('/') && !p.startsWith('-') && !p.includes('://') && !p.startsWith('/dev/'))
}

/** A linha da status line: as falhas quando há alguma, senão todos os mods. */
export function textoStatus(lista: readonly Execucao[]): string | undefined {
  if (lista.length === 0) return undefined
  const rodando = lista.filter(x => x.estado === 'rodando')
  if (rodando.length > 0) return `🧪 ⏳ ${rodando.map(x => x.mod).join(', ')}`
  const falhas = lista.filter(x => x.estado === 'falhou')
  const mostrar = falhas.length > 0 ? falhas : lista
  return `🧪 ${falhas.length > 0 ? '❌' : '✅'} ${mostrar.map(x => `${x.mod} ${x.resumo}`).join(' · ')}`
}
