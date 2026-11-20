/** Tipos aceitos no início da mensagem (ver ~/.claude/CLAUDE.md). */
export const TIPOS = [
  'feat', 'fix', 'refactor', 'chore', 'docs', 'test',
  'style', 'perf', 'build', 'ci', 'revert',
] as const

const ASSUNTO = new RegExp(`^(${TIPOS.join('|')})(\\([^()\\s][^()]*\\))?(!)?: \\S`)

/** Assuntos que o próprio git gera e que não devem ser barrados. */
const AUTOMATICOS = /^(Merge |Revert "|fixup! |squash! |amend! )/

// `"$(cat <<'EOF' ... EOF\n)"`: o jeito como o Claude costuma passar mensagens longas.
const HEREDOC = /"?\$\(\s*cat\s*<<-?\s*(['"]?)(\w+)\1[ \t]*\n([\s\S]*?)\n[ \t]*\2[ \t]*\n?\s*\)"?/g

const SEPARADORES = new Set(['&&', '||', ';', '|', '\n', '&'])

/**
 * Quebra um comando de shell em palavras, sem as aspas. Separadores (`&&`, `;`,
 * `|`, quebra de linha) viram palavras próprias. É uma aproximação do bash, mas
 * cobre o jeito como `git commit` aparece nos comandos do Claude.
 */
export function palavras(comando: string): string[] {
  const saida: string[] = []
  let atual = ''
  let temPalavra = false
  const fechar = () => {
    if (temPalavra) saida.push(atual)
    atual = ''
    temPalavra = false
  }

  for (let i = 0; i < comando.length; i++) {
    const c = comando.charAt(i)
    if (c === "'") {
      const fim = comando.indexOf("'", i + 1)
      const ate = fim === -1 ? comando.length : fim
      atual += comando.slice(i + 1, ate)
      temPalavra = true
      i = ate
    } else if (c === '"') {
      temPalavra = true
      for (i++; i < comando.length && comando.charAt(i) !== '"'; i++) {
        if (comando.charAt(i) === '\\' && '"\\$`\n'.includes(comando.charAt(i + 1))) i++
        atual += comando.charAt(i)
      }
    } else if (c === '\\') {
      if (comando.charAt(i + 1) !== '\n') atual += comando.charAt(i + 1)
      temPalavra = true
      i++
    } else if (c === ' ' || c === '\t') {
      fechar()
    } else if ('&|;\n'.includes(c)) {
      fechar()
      const dois = comando.slice(i, i + 2)
      if (dois === '&&' || dois === '||') {
        saida.push(dois)
        i++
      } else saida.push(c)
    } else {
      atual += c
      temPalavra = true
    }
  }
  fechar()
  return saida
}

/** Opções globais do git que consomem a palavra seguinte (`git -C dir commit`). */
const GLOBAIS_COM_VALOR = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])

/**
 * As mensagens de cada `git commit` do comando: as partes de `-m` juntadas por
 * linha em branco, como o git faz. `undefined` quando o commit não traz a
 * mensagem na linha de comando (editor, `-F`, `-C`, `--no-edit`), e aí não há
 * o que conferir.
 */
export function mensagensDeCommit(comando: string): (string | undefined)[] {
  const corpos: string[] = []
  const semHeredoc = comando.replace(HEREDOC, (_, _q, _tag, corpo: string) => {
    corpos.push(corpo)
    return ` __HEREDOC_${corpos.length - 1}__ `
  })
  const valor = (p: string) => p.replace(/__HEREDOC_(\d+)__/g, (_, n) => corpos[Number(n)] ?? '')

  const ps = palavras(semHeredoc)
  const at = (n: number): string => ps[n] ?? ''
  const mensagens: (string | undefined)[] = []

  for (let i = 0; i < ps.length; i++) {
    if (!/(^|\/)git$/.test(at(i))) continue
    // Pula as opções globais até achar o subcomando.
    let j = i + 1
    while (j < ps.length && at(j).startsWith('-')) {
      j += GLOBAIS_COM_VALOR.has(at(j)) ? 2 : 1
    }
    if (at(j) !== 'commit') continue

    const partes: string[] = []
    let semMensagem = false
    for (j++; j < ps.length && !SEPARADORES.has(at(j)); j++) {
      const p = at(j)
      if (p === '-m' || p === '--message') {
        partes.push(valor(at(++j)))
      } else if (p.startsWith('--message=')) {
        partes.push(valor(p.slice('--message='.length)))
      } else if (/^--(file|reuse-message|reedit-message|fixup|squash)(=|$)/.test(p) || p === '--no-edit') {
        semMensagem = true
      } else if (/^-[^-]/.test(p)) {
        // Grupo de opções curtas, como `-am "msg"` ou `-m"msg"`.
        for (let k = 1; k < p.length; k++) {
          if ('FCc'.includes(p.charAt(k))) {
            semMensagem = true
            break
          }
          if (p.charAt(k) === 'm') {
            const resto = p.slice(k + 1)
            partes.push(valor(resto !== '' ? resto : (at(++j))))
            break
          }
        }
      }
    }
    mensagens.push(partes.length > 0 && !semMensagem ? partes.join('\n\n') : undefined)
    i = j
  }
  return mensagens
}

/** O motivo da recusa, ou `undefined` quando a mensagem segue o padrão. */
export function problema(mensagem: string): string | undefined {
  const assunto = mensagem.trimStart().split('\n')[0]?.trimEnd() ?? ''
  if (AUTOMATICOS.test(assunto)) return undefined

  const m = ASSUNTO.exec(assunto)
  if (!m) return `o assunto "${assunto}" não segue \`<tipo>(<escopo opcional>): <descrição>\``
  if (m[3] === '!' && !/^BREAKING[ -]CHANGE: \S/m.test(mensagem)) {
    return 'o `!` marca mudança incompatível, mas falta o rodapé `BREAKING CHANGE: <o que quebra>`'
  }
  return undefined
}

/** Confere todo `git commit` do comando; devolve o texto da recusa, se houver. */
export function validarComando(comando: string): string | undefined {
  if (!/\bcommit\b/.test(comando)) return undefined
  for (const mensagem of mensagensDeCommit(comando)) {
    if (mensagem === undefined) continue
    const motivo = problema(mensagem)
    if (motivo) {
      return [
        `Commit recusado: ${motivo}.`,
        `Tipos aceitos: ${TIPOS.join(', ')}.`,
        'Exemplo: `feat(quota-semanal): mostra o ritmo da quota na status line`.',
        'Mudança incompatível: `feat!: ...` com o rodapé `BREAKING CHANGE: ...`.',
        'Refaça o commit com a mensagem corrigida.',
      ].join('\n')
    }
  }
  return undefined
}
