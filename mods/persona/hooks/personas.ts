import type { Persona } from '../types'

/** Pastas que a busca não abre: dependências, saídas de build e caches. */
export const IGNORAR = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', 'target', 'tmp',
  '__pycache__', 'venv', 'env',
])

/** Título legível a partir do nome do arquivo e do conteúdo dele. */
export function lerPersona(arquivo: string, conteudo: string, caminho: string, pasta: string): Persona {
  const num = /^(\d+)/.exec(arquivo)
  const titulo = /^#\s+(.+?)\s*$/m.exec(conteudo)?.[1]
  const semPrefixo = titulo?.replace(/^persona\s*\d*\s*[—–:-]\s*/i, '').trim()
  return {
    numero: num ? Number(num[1]) : null,
    titulo: semPrefixo || tituloDoArquivo(arquivo),
    caminho,
    pasta,
  }
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

const semAcento = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

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

/**
 * O rascunho com as personas no começo. Se o rascunho já começa com o prefixo
 * deste mod, a persona nova entra na mesma frase; o resto do texto fica.
 */
export function aplicar(rascunho: string, caminhos: readonly string[]): string {
  const atual = PREFIXO.exec(rascunho)
  const ja = atual ? ((atual[1] ?? '').match(new RegExp(MENCAO, 'g')) ?? []) : []
  const resto = atual ? rascunho.slice(atual[0].length) : rascunho
  const todas = [...ja]
  for (const m of caminhos.map(mencao)) if (!todas.includes(m)) todas.push(m)
  return prefixo(todas) + resto
}

export const rotulo = (p: Persona) => (p.numero === null ? p.titulo : `${p.numero} · ${p.titulo}`)
