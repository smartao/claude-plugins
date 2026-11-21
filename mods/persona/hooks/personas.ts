import type { Grupo, Persona } from '../types'

/** Pastas que a busca não abre: dependências, saídas de build e caches. */
export const IGNORAR = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', 'target', 'tmp',
  '__pycache__', 'venv', 'env',
])

const semAcento = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

// Os grupos, na ordem em que são testados: "seguranca-supabase" é técnica antes de
// qualquer outra coisa, "analista-comercial" é negócio, não técnica.
const GRUPOS: readonly [Grupo, RegExp][] = [
  ['tecnica', /segur|secur|postgres|banco|sql|database|dados|frontend|backend|mobile|\bqa\b|teste|\btest|devops|infra|\bapi\b|perform|acessib|arquitet|dev\b|desenvolv/],
  ['negocio', /comercial|venda|preco|marketing|operador|financ|produto|design|visual|\bux\b|conteudo|juridic|suporte|analista|negocio/],
  ['usuario', /cliente|usuari|dono|profission|paciente|aluno|comprador|leitor|visitante|consumidor|gestor|funcionari|atendente|morador|motorista/],
]

/** Cores dos grupos, legíveis em tema claro e escuro. */
export const CORES: Record<Exclude<Grupo, 'outra'>, string> = {
  usuario: '#4C8DF6',
  tecnica: '#E8743B',
  negocio: '#9B6BDF',
}
/** Para as que não caem em grupo nenhum: uma cor fixa por arquivo, sem repetir as dos grupos. */
const PALETA = ['#2BA89A', '#D4A72C', '#D9578C', '#6C9A3B']

export const NOMES_GRUPO: Record<Exclude<Grupo, 'outra'>, string> = {
  usuario: 'quem usa',
  tecnica: 'técnica',
  negocio: 'negócio',
}

// Emojis de um caractere só, sem seletor de variação, para não desalinhar o terminal.
const ICONES: readonly [RegExp, string][] = [
  [/segur|secur|lgpd|privacid/, '🔐'],
  [/postgres/, '🐘'],
  [/banco|sql|database|dados/, '💾'],
  [/\bqa\b|teste|\btest/, '🧪'],
  [/design|visual|\bux\b/, '🎨'],
  [/frontend|mobile|react|celular/, '📱'],
  [/backend|\bapi\b/, '🔌'],
  [/devops|infra|deploy/, '🚀'],
  [/perform/, '⚡'],
  [/acessib/, '♿'],
  [/comercial|venda|preco|financ/, '💼'],
  [/marketing|conteudo/, '📣'],
  [/operador|admin|suporte/, '🔧'],
  [/dono|gestor|empres|salao|loja/, '🏪'],
  [/profission|funcionari|atendente/, '👔'],
  [/cliente|usuari|consumidor|comprador|visitante|paciente|aluno/, '🙋'],
]
const ICONE_PADRAO = '👤'

/** Grupo e ícone pelo nome do arquivo e pelo título. */
export function classificar(arquivo: string, titulo: string): { grupo: Grupo; icone: string } {
  const texto = semAcento(`${arquivo.replace(/[-_.]+/g, ' ')} ${titulo}`)
  const grupo = GRUPOS.find(([, re]) => re.test(texto))?.[0] ?? 'outra'
  const icone = ICONES.find(([re]) => re.test(texto))?.[1] ?? ICONE_PADRAO
  return { grupo, icone }
}

/** Um campo `nome: valor` do começo do arquivo (com ou sem bloco `---`), ou undefined. */
export function campo(conteudo: string, nome: string): string | undefined {
  const inicio = conteudo.split('\n', 15)
  const re = new RegExp(String.raw`^${nome}\s*:\s*(.+?)\s*$`, 'i')
  for (const linha of inicio) {
    const m = re.exec(linha)
    if (m?.[1]) return m[1].replace(/^["']|["']$/g, '')
  }
  return undefined
}

/** Tira negrito, itálico, código e links do markdown de uma linha. */
const textoPuro = (s: string) =>
  s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim()

const MAX_FOCO = 80
const cortar = (s: string) => (s.length > MAX_FOCO ? `${s.slice(0, MAX_FOCO - 1).trimEnd()}…` : s)

/**
 * O foco de cada arquivo pela tabela do README da pasta: a coluna "Foco" (ou a
 * última) da linha que cita o arquivo `.md`.
 */
export function focosDoReadme(readme: string): Map<string, string> {
  const focos = new Map<string, string>()
  let coluna = -1
  for (const linha of readme.split('\n')) {
    if (!linha.trim().startsWith('|')) {
      coluna = -1
      continue
    }
    const celulas = linha.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
    if (celulas.every(c => /^:?-+:?$/.test(c))) continue
    const iFoco = celulas.findIndex(c => semAcento(textoPuro(c)) === 'foco')
    if (iFoco >= 0) {
      coluna = iFoco
      continue
    }
    const arquivo = celulas.map(c => /([^\s/()[\]]+\.md)\b/i.exec(c)?.[1]).find(Boolean)
    const foco = celulas[coluna >= 0 ? coluna : celulas.length - 1]
    if (arquivo && foco && !/\.md\b/i.test(foco)) focos.set(arquivo, cortar(textoPuro(foco)))
  }
  return focos
}

/** Sem README: a primeira linha de texto depois de "## Quem é" (ou do título). */
export function focoDoArquivo(conteudo: string): string {
  const linhas = conteudo.split('\n')
  let i = linhas.findIndex(l => /^##\s+quem\s/i.test(semAcento(l)))
  if (i < 0) i = linhas.findIndex(l => /^#\s/.test(l))
  for (const linha of linhas.slice(i + 1)) {
    if (/^#/.test(linha)) break
    const puro = textoPuro(linha.replace(/^\s*[-*>]\s+/, ''))
    if (puro !== '' && !/^\w+\s*:/.test(puro)) return cortar(puro)
  }
  return ''
}

/** Lê a persona de um arquivo; `foco` vem do README da pasta, quando houver. */
export function lerPersona(arquivo: string, conteudo: string, caminho: string, pasta: string, foco?: string): Persona {
  const num = /^(\d+)/.exec(arquivo)
  const cabecalho = /^#\s+(.+?)\s*$/m.exec(conteudo)?.[1]
  const titulo = cabecalho?.replace(/^persona\s*\d*\s*[—–:-]\s*/i, '').trim() || tituloDoArquivo(arquivo)
  const { grupo, icone } = classificar(arquivo, titulo)
  const cor = campo(conteudo, 'cor') ?? (grupo === 'outra' ? PALETA[hash(arquivo) % PALETA.length] : CORES[grupo])
  return {
    numero: num ? Number(num[1]) : null,
    titulo,
    caminho,
    pasta,
    icone: campo(conteudo, 'icone') ?? campo(conteudo, 'ícone') ?? icone,
    grupo,
    cor: cor ?? CORES.usuario,
    foco: foco ?? focoDoArquivo(conteudo),
  }
}

function hash(s: string): number {
  let h = 0
  for (const c of s) h = (h * 31 + (c.codePointAt(0) ?? 0)) >>> 0
  return h
}

function tituloDoArquivo(arquivo: string): string {
  const base = arquivo.replace(/\.md$/i, '').replace(/^\d+[-_ ]*/, '').replace(/[-_]+/g, ' ').trim()
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : arquivo
}

export function ordenar(lista: Persona[]): Persona[] {
  return [...lista].sort(
    (a, b) =>
      a.pasta.localeCompare(b.pasta) ||
      (a.numero ?? Infinity) - (b.numero ?? Infinity) ||
      a.caminho.localeCompare(b.caminho),
  )
}

/** Caminho de `alvo` para o `@`: relativo a `cwd` quando está dentro dele, senão absoluto. */
export function relativo(cwd: string, alvo: string): string {
  if (alvo === cwd) return '.'
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`
  return alvo.startsWith(base) ? alvo.slice(base.length) : alvo
}

/**
 * Resolve os argumentos de `/persona`: um número escolhe pela numeração do arquivo
 * (`5` ou `05`), um texto pelo nome do arquivo ou título (`cliente`, `qa`).
 */
export function escolher(lista: readonly Persona[], args: string): { achadas: Persona[]; faltando: string[] } {
  const achadas: Persona[] = []
  const faltando: string[] = []
  for (const termo of args.split(/[\s,]+/).filter(Boolean)) {
    const t = semAcento(termo)
    const candidatas = /^\d+$/.test(t)
      ? lista.filter(p => p.numero === Number(t))
      : lista.filter(p => semAcento(p.caminho.slice(p.caminho.lastIndexOf('/') + 1)).includes(t) || semAcento(p.titulo).includes(t))
    if (candidatas.length === 0) faltando.push(termo)
    for (const p of candidatas) if (!achadas.includes(p)) achadas.push(p)
  }
  return { achadas, faltando }
}

/** A menção de um caminho no prompt; com espaço, entre aspas. */
export const mencao = (caminho: string) => (/\s/.test(caminho) ? `@"${caminho}"` : `@${caminho}`)

/** O começo do prompt para as personas dadas por menção. */
export function prefixo(mencoes: readonly string[]): string {
  if (mencoes.length === 1) return `Claude, usando a persona ${mencoes[0]}, `
  const lista = `${mencoes.slice(0, -1).join(', ')} e ${mencoes[mencoes.length - 1]}`
  return `Claude, usando as personas ${lista}, `
}

const MENCAO = String.raw`@(?:"[^"]+"|[^\s,]+)`
const PREFIXO = new RegExp(String.raw`^Claude, usando (?:a persona|as personas) (${MENCAO}(?:(?:, | e )${MENCAO})*), `)

/** As menções do prefixo deste mod no começo do rascunho, como estão escritas. */
function mencoesDoPrefixo(rascunho: string): { mencoes: string[]; resto: string } {
  const atual = PREFIXO.exec(rascunho)
  if (!atual) return { mencoes: [], resto: rascunho }
  return { mencoes: (atual[1] ?? '').match(new RegExp(MENCAO, 'g')) ?? [], resto: rascunho.slice(atual[0].length) }
}

/** Os caminhos das personas que o rascunho já cita no começo. */
export const extrair = (rascunho: string): string[] =>
  mencoesDoPrefixo(rascunho).mencoes.map(m => m.replace(/^@"?|"$/g, ''))

/**
 * O rascunho com as personas no começo. Se o rascunho já começa com o prefixo
 * deste mod, a persona nova entra na mesma frase; o resto do texto fica.
 */
export function aplicar(rascunho: string, caminhos: readonly string[]): string {
  const { mencoes, resto } = mencoesDoPrefixo(rascunho)
  const todas = [...mencoes]
  for (const m of caminhos.map(mencao)) if (!todas.includes(m)) todas.push(m)
  return prefixo(todas) + resto
}

export const rotulo = (p: Persona) => (p.numero === null ? p.titulo : `${p.numero} · ${p.titulo}`)
