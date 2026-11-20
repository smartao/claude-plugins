import type { Execucao } from '../types'

/** Saída de um processo, só o que o resumo precisa. */
export type Saida = { exitCode: number; stdout: string; stderr: string }

const ANSI = /\x1b\[[0-9;]*m/g

const texto = (s: Saida) => `${s.stdout}\n${s.stderr}`.replace(ANSI, '')

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** Quantas linhas de detalhe guardar por mod. */
const MAX_LINHAS = 60

/**
 * Os problemas que o validate aponta, um por linha, com o arquivo à frente:
 * `hooks/register.ts:9:9 TS2322: ...`. Ignora a seção "Plugin directory
 * checks", que trata de publicar no catálogo (README, LICENSE, ícone) e não
 * muda o resultado da validação.
 */
export function problemasValidate(saida: string, pasta: string): string[] {
  const principal = saida.split(/^Plugin directory checks/m)[0] ?? ''
  const problemas: string[] = []
  let arquivo = ''
  let emErro = false
  for (const bruta of principal.split('\n')) {
    const l = bruta.trim()
    const validando = /^Validating [^:]+: (.+)$/.exec(l)
    if (validando) {
      const caminho = validando[1] ?? ''
      arquivo = caminho.startsWith(`${pasta}/`) ? caminho.slice(pasta.length + 1) : caminho
      emErro = false
      continue
    }
    if (l.startsWith('✘ Found')) emErro = true
    else if (l.startsWith('⚠') || l.startsWith('✔')) emErro = false

    const ts = /^❯ line (\d+), column (\d+): error (TS\d+): (.*)$/.exec(l)
    if (ts) problemas.push(`${arquivo}:${ts[1]}:${ts[2]} ${ts[3]}: ${ts[4]}`)
    else if (emErro && l.startsWith('❯ ')) problemas.push(`${arquivo}: ${l.slice(2)}`)
  }
  return problemas
}

/** Cada teste que falhou, com a mensagem de erro logo abaixo. */
export function falhasTeste(saida: string): string[] {
  const linhas: string[] = []
  let dentro = false
  for (const bruta of saida.split('\n')) {
    if (bruta.startsWith('(fail)')) {
      dentro = true
      linhas.push(bruta.replace(/\s*\[[\d.]+ms\]$/, ''))
    } else if (bruta.startsWith('(') || /^\s*\d+ (pass|fail)\b/.test(bruta)) {
      dentro = false
    } else if (dentro && bruta.trim() !== '') {
      linhas.push(`  ${bruta.trim()}`)
    }
  }
  return linhas
}

/**
 * Junta as saídas de `claude plugin validate` e `claude plugin test` num
 * estado, numa linha curta e no detalhe da falha. Erros de tipo contam como
 * falha, mesmo que o validate os chame de aviso.
 */
export function resumir(
  pasta: string,
  validate: Saida,
  teste: Saida | undefined,
): Pick<Execucao, 'estado' | 'resumo' | 'detalhe'> {
  const v = texto(validate)
  const problemas = problemasValidate(v, pasta)
  const errosTipo = problemas.filter(p => / TS\d+: /.test(p)).length
  const validacaoFalhou = validate.exitCode !== 0 || /Validation failed/.test(v)

  const t = teste === undefined ? '' : texto(teste)
  const passou = Number(/(\d+) pass\b/.exec(t)?.[1] ?? 0)
  const falhou = Number(/(\d+) fail\b/.exec(t)?.[1] ?? 0)
  const total = passou + falhou
  const falhas = falhasTeste(t)
  const testesNaoRodaram = teste !== undefined && teste.exitCode !== 0 && falhou === 0

  const partes: string[] = []
  if (validacaoFalhou) partes.push('validação falhou')
  if (errosTipo > 0) partes.push(plural(errosTipo, 'erro de tipo', 'erros de tipo'))
  if (falhou > 0) {
    partes.push(`${falhou} de ${plural(total, 'teste', 'testes')} ${falhou === 1 ? 'falhou' : 'falharam'}`)
  }
  if (testesNaoRodaram) partes.push('testes não rodaram')

  if (partes.length === 0) {
    const resumo = teste === undefined ? 'validado' : total === 0 ? 'validado, sem testes' : `${passou}/${total} testes`
    return { estado: 'ok', resumo, detalhe: '' }
  }

  const detalhe: string[] = []
  if (problemas.length > 0) detalhe.push('claude plugin validate:', ...problemas.map(p => `  ${p}`))
  else if (validacaoFalhou) detalhe.push('claude plugin validate:', ...ultimas(v))
  if (falhas.length > 0) detalhe.push('claude plugin test:', ...falhas)
  else if (testesNaoRodaram) detalhe.push('claude plugin test:', ...ultimas(t))
  return { estado: 'falhou', resumo: partes.join(' · '), detalhe: cortar(detalhe).join('\n') }
}

/** As últimas linhas com texto de uma saída, para quando nada mais explica a falha. */
function ultimas(s: string, n = 15): string[] {
  return s.split('\n').filter(l => l.trim() !== '').slice(-n).map(l => `  ${l.trim()}`)
}

function cortar(linhas: string[]): string[] {
  if (linhas.length <= MAX_LINHAS) return linhas
  return [...linhas.slice(0, MAX_LINHAS), `  … mais ${linhas.length - MAX_LINHAS} linhas`]
}

/** O pedido que vai ao Claude quando a pessoa aperta "Pedir correção". */
export function pedidoCorrecao(falhas: readonly Execucao[]): string {
  const blocos = falhas.map(
    x => `Mod \`${x.mod}\` (${x.pasta}): ${x.resumo}.\n\n\`\`\`\n${x.detalhe}\n\`\`\``,
  )
  return [
    `O teste-mods encontrou problemas ${falhas.length === 1 ? 'neste mod' : 'nestes mods'}:`,
    ...blocos,
    'Corrija e confira com `claude plugin validate` e `claude plugin test`.',
  ].join('\n\n')
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
