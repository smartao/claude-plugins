/** O que fazer com uma chamada: recusar de vez, ou perguntar à pessoa. */
export type Veredito = { nivel: 'bloquear' | 'perguntar'; motivo: string }

/** Onde a sessão está: a pasta do projeto e a home, para resolver caminhos. */
export type Contexto = { cwd: string; home: string }

/** Pastas cujo apagamento não tem volta e nunca é o que se quer. */
const CRITICAS = new Set([
  '/', '/home', '/root', '/usr', '/etc', '/var', '/boot', '/bin', '/sbin',
  '/lib', '/lib64', '/opt', '/srv', '/sys', '/proc', '/dev', '/mnt', '/media',
])

/** Pastas temporárias, onde apagar fora do projeto é rotina. */
const TEMPORARIAS = ['/tmp/', '/var/tmp/']

/** Prefixos que só mudam como o comando roda, não o que ele faz. */
const PREFIXOS = new Set(['sudo', 'command', 'builtin', 'nohup', 'time', 'exec', 'env', 'rtk', 'xargs'])

const SEPARADORES = new Set(['&&', '||', ';', '|', '\n', '&'])

/**
 * Quebra um comando de shell em palavras, sem as aspas. Separadores (`&&`, `;`,
 * `|`, quebra de linha) viram palavras próprias. Uma aproximação do bash que
 * basta para achar os comandos e os seus argumentos.
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

/** Os comandos simples de uma linha de shell, cada um como lista de palavras. */
function segmentos(comando: string): string[][] {
  const lista: string[][] = [[]]
  for (const p of palavras(comando)) {
    if (SEPARADORES.has(p)) lista.push([])
    else lista[lista.length - 1]?.push(p)
  }
  return lista.filter(s => s.length > 0)
}

/** Tira `sudo`, `env X=1`, `rtk` e afins da frente do comando. */
function semPrefixo(seg: string[]): string[] {
  let i = 0
  while (i < seg.length) {
    const p = seg[i] ?? ''
    if (PREFIXOS.has(p) || /^\w+=/.test(p)) i++
    else if (i > 0 && p.startsWith('-') && seg[i - 1] === 'sudo') i++
    else break
  }
  return seg.slice(i)
}

/** Normaliza `p` como caminho absoluto, resolvendo `.`, `..`, `~` e `$HOME`. */
export function absoluto(base: string, home: string, p: string): string {
  const expandido = p.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, home)
  const bruto = expandido.startsWith('/') ? expandido : `${base}/${expandido}`
  const partes: string[] = []
  for (const parte of bruto.split('/')) {
    if (parte === '' || parte === '.') continue
    if (parte === '..') partes.pop()
    else partes.push(parte)
  }
  return '/' + partes.join('/')
}

const dentro = (caminho: string, pasta: string) =>
  caminho === pasta || caminho.startsWith(pasta === '/' ? '/' : `${pasta}/`)

/** Um alvo de apagamento: bloquear, perguntar ou deixar passar. */
function avaliarAlvo(alvo: string, base: string, ctx: Contexto, acao: string): Veredito | undefined {
  // Uma variável pode estar vazia: `rm -rf $DIR/` vira `rm -rf /`.
  if (/\$(?!HOME\b|\{HOME\})/.test(alvo)) {
    return { nivel: 'perguntar', motivo: `${acao} com variável no caminho (${alvo}), que pode estar vazia` }
  }
  // `pasta/*` apaga tudo dentro da pasta: conta como a própria pasta.
  const semGlob = alvo.replace(/\/?\*$/, '') || (alvo.startsWith('/') ? '/' : '.')
  const caminho = absoluto(base, ctx.home, semGlob)

  if (CRITICAS.has(caminho) || caminho === ctx.home || dentro(ctx.home, caminho)) {
    return { nivel: 'bloquear', motivo: `${acao} em ${caminho}, uma pasta do sistema ou a sua home` }
  }
  if (TEMPORARIAS.some(t => caminho.startsWith(t))) return undefined
  if (dentro(ctx.cwd, caminho)) {
    return { nivel: 'perguntar', motivo: `${acao} em ${caminho}, que contém o projeto inteiro` }
  }
  if (!dentro(caminho, ctx.cwd)) {
    return { nivel: 'perguntar', motivo: `${acao} em ${caminho}, fora do projeto (${ctx.cwd})` }
  }
  return undefined
}

/** Opções globais do git que consomem a palavra seguinte (`git -C dir push`). */
const GIT_GLOBAIS_COM_VALOR = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])

function avaliarGit(args: string[]): Veredito | undefined {
  let i = 0
  while (i < args.length && (args[i] ?? '').startsWith('-')) {
    i += GIT_GLOBAIS_COM_VALOR.has(args[i] ?? '') ? 2 : 1
  }
  const sub = args[i]
  const resto = args.slice(i + 1)
  const tem = (...opcoes: string[]) => resto.some(r => opcoes.includes(r))
  const curta = (letra: string) => resto.some(r => /^-[a-zA-Z]+$/.test(r) && r.includes(letra))
  const perguntar = (motivo: string): Veredito => ({ nivel: 'perguntar', motivo })

  switch (sub) {
    case 'push':
      if (tem('--force') || curta('f')) return perguntar('git push --force reescreve o histórico remoto')
      if (resto.some(r => /^\+[^-]/.test(r))) return perguntar('git push com +refspec força a atualização remota')
      if (tem('--delete', '--mirror') || curta('d') || resto.some(r => /^:[^:]/.test(r))) {
        return perguntar('git push apaga ou espelha refs remotas')
      }
      return undefined
    case 'reset':
      return tem('--hard') ? perguntar('git reset --hard descarta as mudanças não commitadas') : undefined
    case 'clean':
      return tem('--force') || curta('f') ? perguntar('git clean -f apaga arquivos não rastreados') : undefined
    case 'checkout':
    case 'restore': {
      const alvos = resto.filter(r => !r.startsWith('-'))
      return alvos.some(a => a === '.' || a === ':/' || a === '*')
        ? perguntar(`git ${sub} . descarta as mudanças de todos os arquivos`)
        : undefined
    }
    case 'branch':
      return tem('-D') || (tem('--delete') && tem('--force'))
        ? perguntar('git branch -D apaga o branch mesmo sem merge')
        : undefined
    case 'stash':
      return resto[0] === 'drop' || resto[0] === 'clear' ? perguntar(`git stash ${resto[0]} apaga stashes`) : undefined
    default:
      return undefined
  }
}

const mais = (a: Veredito | undefined, b: Veredito | undefined) =>
  !a ? b : !b ? a : a.nivel === 'bloquear' || b.nivel !== 'bloquear' ? a : b

/** Avalia um comando de Bash; devolve o veredito mais severo, se houver. */
export function avaliarBash(comando: string, ctx: Contexto): Veredito | undefined {
  let veredito: Veredito | undefined
  let base = ctx.cwd

  if (/\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/.test(comando)) {
    veredito = mais(veredito, { nivel: 'perguntar', motivo: 'executa um script baixado da internet' })
  }

  // Redirecionamentos (`> arquivo`, `>> arquivo`): para disco cru ou para segredos.
  for (const m of comando.matchAll(/(?<![0-9&])>>?\s*([^\s;&|<>]+)/g)) {
    const alvo = m[1] ?? ''
    if (/^\/dev\/(sd|nvme|hd|vd|mmcblk)/.test(alvo)) {
      veredito = mais(veredito, { nivel: 'bloquear', motivo: `escreve direto no disco ${alvo}` })
    } else {
      veredito = mais(veredito, avaliarArquivo(absoluto(base, ctx.home, alvo), ctx))
    }
  }

  for (const bruto of segmentos(comando)) {
    const seg = semPrefixo(bruto)
    const [cmd = '', ...args] = seg
    const nome = cmd.slice(cmd.lastIndexOf('/') + 1)

    if (nome === 'cd') {
      base = absoluto(base, ctx.home, args[0] ?? '~')
    } else if (['bash', 'sh', 'zsh', 'dash'].includes(nome) && args[0] === '-c' && args[1]) {
      veredito = mais(veredito, avaliarBash(args[1], { ...ctx, cwd: base }))
    } else if (nome === 'rm') {
      const fim = args.indexOf('--')
      const opcoes = (fim === -1 ? args : args.slice(0, fim)).filter(a => a.startsWith('-'))
      const alvos = fim === -1 ? args.filter(a => !a.startsWith('-')) : [...args.slice(0, fim).filter(a => !a.startsWith('-')), ...args.slice(fim + 1)]
      const recursivo = opcoes.some(o => o === '--recursive' || (/^-[a-zA-Z]+$/.test(o) && /[rR]/.test(o)))
      if (recursivo) {
        for (const alvo of alvos) veredito = mais(veredito, avaliarAlvo(alvo, base, ctx, 'rm -r'))
      }
      for (const alvo of alvos) veredito = mais(veredito, avaliarArquivo(absoluto(base, ctx.home, alvo), ctx, 'apaga'))
    } else if (nome === 'git') {
      veredito = mais(veredito, avaliarGit(args))
    } else if (nome === 'dd' && args.some(a => /^of=\/dev\/(sd|nvme|hd|vd|mmcblk)/.test(a))) {
      veredito = mais(veredito, { nivel: 'bloquear', motivo: 'dd escrevendo direto num disco' })
    } else if (nome.startsWith('mkfs') || nome === 'wipefs' || nome === 'shred') {
      veredito = mais(veredito, { nivel: 'bloquear', motivo: `${nome} apaga dados sem volta` })
    } else if ((nome === 'chmod' || nome === 'chown') && args.some(a => /^-[a-zA-Z]*R/.test(a) || a === '--recursive')) {
      for (const alvo of args.filter(a => !a.startsWith('-')).slice(1)) {
        veredito = mais(veredito, avaliarAlvo(alvo, base, ctx, `${nome} -R`))
      }
      if (nome === 'chmod' && args.includes('777')) {
        veredito = mais(veredito, { nivel: 'perguntar', motivo: 'chmod -R 777 abre os arquivos para todos' })
      }
    } else if (nome === 'tee') {
      for (const alvo of args.filter(a => !a.startsWith('-'))) {
        veredito = mais(veredito, avaliarArquivo(absoluto(base, ctx.home, alvo), ctx))
      }
    }
  }
  return veredito
}

/** Arquivos de exemplo, que não guardam segredo de verdade. */
const EXEMPLO = /\.(example|sample|template|dist)(\.|$)/

/** Escrever (ou apagar) um arquivo de segredos: chaves, credenciais, `.env`. */
export function avaliarArquivo(caminho: string, ctx: Contexto, acao = 'escreve em'): Veredito | undefined {
  const absolutoCaminho = absoluto(ctx.cwd, ctx.home, caminho)
  const nome = absolutoCaminho.slice(absolutoCaminho.lastIndexOf('/') + 1)
  const segredo =
    (/^\.env(\..+)?$/.test(nome) && !EXEMPLO.test(nome)) ||
    /^\.?credentials(\.json)?$/.test(nome) ||
    /\.(pem|key|p12|pfx|keystore)$/.test(nome) ||
    /^id_(rsa|dsa|ecdsa|ed25519)/.test(nome) ||
    /\/\.(ssh|gnupg)\//.test(absolutoCaminho) ||
    /\/\.aws\/credentials$/.test(absolutoCaminho) ||
    /\/\.netrc$/.test(absolutoCaminho)
  return segredo ? { nivel: 'perguntar', motivo: `${acao} ${absolutoCaminho}, um arquivo de segredos` } : undefined
}
