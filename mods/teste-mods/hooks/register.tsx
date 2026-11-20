import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { Execucao } from '../types'
import { caminhosDoBash, linha, pedidoCorrecao, resumir, textoStatus } from './resultado'

// Mude o `shape` quando os campos de Execucao mudarem: descarta o que uma versão antiga guardou.
const execucoes = atom({ plugin: 'teste-mods', key: 'execucoes' } as const, [], { shape: 'execucoes-2' })
const oculto = atom({ plugin: 'teste-mods', key: 'oculto' } as const, false)
// Pastas de mods editadas e ainda não testadas. Fica em $.state, e não numa
// variável do módulo, para sobreviver ao recarregamento de um mod em edição.
const pendentes = atom({ plugin: 'teste-mods', key: 'pendentes' } as const, [])

/** Quanto tempo cada comando pode levar antes de ser abortado. */
const LIMITE_MS = 120_000
/** Quanto tempo o ✅ fica na status line quando tudo passou. */
const OK_VISIVEL_MS = 60_000

const PAINEL = 'teste-mods'
const TITULO = 'Testes de mods'
const COMANDO = 'teste-mods'

const FERRAMENTAS_DE_EDICAO = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

/** Normaliza `p` como caminho absoluto, resolvendo `.`, `..` e `~`. */
export function absoluto(cwd: string, home: string, p: string): string {
  const base = p.startsWith('~/') ? home + p.slice(1) : p.startsWith('/') ? p : `${cwd}/${p}`
  const partes: string[] = []
  for (const parte of base.split('/')) {
    if (parte === '' || parte === '.') continue
    if (parte === '..') partes.pop()
    else partes.push(parte)
  }
  return '/' + partes.join('/')
}

let cwd = '/'
let home = ''
let rodando = false
// Conta as rodadas, para um timer antigo não limpar o status de uma nova.
let rodada = 0
// Caminho -> pasta do mod que o contém (ou null), para não repetir buscas no disco.
const cache = new Map<string, string | null>()

async function pastaDoMod($: EngineInterface, caminho: string): Promise<string | null> {
  let dir = absoluto(cwd, home, caminho)
  const visitados: string[] = []
  let achado: string | null = null
  for (let i = 0; i < 12 && dir !== '/'; i++) {
    const salvo = cache.get(dir)
    if (salvo !== undefined) {
      achado = salvo
      break
    }
    visitados.push(dir)
    if (await $.fs.exists(`${dir}/.claude-plugin/plugin.json`)) {
      achado = dir
      break
    }
    dir = dir.slice(0, dir.lastIndexOf('/')) || '/'
  }
  for (const v of visitados) cache.set(v, achado)
  return achado
}

async function marcar($: EngineInterface, caminhos: string[]): Promise<void> {
  const pastas = new Set<string>()
  for (const c of caminhos) {
    const pasta = await pastaDoMod($, c)
    if (pasta) pastas.add(pasta)
  }
  if (pastas.size > 0) await update($, pendentes, atual => [...new Set([...atual, ...pastas])])
}

async function rodarUm($: EngineInterface, pasta: string): Promise<void> {
  const mod = pasta.slice(pasta.lastIndexOf('/') + 1)
  const gravar = (x: Execucao) =>
    update($, execucoes, atual => [...atual.filter(a => a.pasta !== pasta), x]).then(() =>
      mostrarStatus($),
    )

  await gravar({ mod, pasta, estado: 'rodando', resumo: '', detalhe: '' })
  let x: Execucao
  try {
    const opcoes = { cwd: pasta, timeoutMs: LIMITE_MS }
    const validate = await $.process.run(['claude', 'plugin', 'validate', pasta], opcoes)
    const teste =
      validate.exitCode === 0
        ? await $.process.run(['claude', 'plugin', 'test', pasta], opcoes)
        : undefined
    x = { mod, pasta, ...resumir(pasta, validate, teste) }
  } catch (erro) {
    x = { mod, pasta, estado: 'falhou', resumo: 'não rodou', detalhe: String(erro) }
  }
  await gravar(x)
  if (x.estado === 'falhou') {
    $.ui.toast(`🧪 ${x.mod}: ${x.resumo} · detalhes no painel ${TITULO}`, { timeoutMs: 8000 })
  }
}

// A status line repete a faixa: o VSCode não desenha a faixa acima do prompt.
async function mostrarStatus($: EngineInterface): Promise<void> {
  $.ui.status(textoStatus(await read($, execucoes)))
}

// Esvazia a fila de pendentes, um mod por vez.
async function processar($: EngineInterface): Promise<void> {
  if (rodando) return
  rodando = true
  try {
    for (;;) {
      const fila = await read($, pendentes)
      if (fila.length === 0) break
      rodada += 1
      await update($, pendentes, () => [])
      await update($, oculto, () => false)
      // Uma nova rodada substitui a anterior na faixa.
      await update($, execucoes, atual => atual.filter(a => fila.includes(a.pasta)))
      for (const pasta of fila) await rodarUm($, pasta)
    }
  } finally {
    rodando = false
  }

  // Falha: abre o painel com os detalhes. Tudo passou: fecha o painel, e o ✅
  // sai da status line depois de um tempo.
  const esta = rodada
  if ((await read($, execucoes)).some(x => x.estado === 'falhou')) {
    void $.ui.open({ id: PAINEL, title: TITULO })
  } else {
    void $.ui.close({ id: PAINEL })
    $.clock.after(OK_VISIVEL_MS, () => {
      if (rodada === esta && !rodando) $.ui.status(undefined)
    })
  }
}

const falhas = async ($: EngineInterface) =>
  (await read($, execucoes)).filter(x => x.estado === 'falhou')

/** Manda ao Claude um pedido de correção com os detalhes das falhas. */
async function pedirCorrecao($: EngineInterface, lista: readonly Execucao[]): Promise<string> {
  if (lista.length === 0) return 'Nenhuma falha para corrigir.'
  await $.prompt.submit({ text: pedidoCorrecao(lista), asUser: true })
  return `Pedido de correção de ${lista.map(x => x.mod).join(', ')} enviado ao Claude.`
}

/** Põe o pedido de correção no campo do prompt, para editar antes de mandar; sem campo, copia. */
async function colarNoPrompt($: EngineInterface, lista: readonly Execucao[], surface: RenderSurface) {
  const texto = pedidoCorrecao(lista)
  const colado = await $.prompt.fill({ text: texto, mode: 'append' }).catch(() => undefined)
  if (colado?.isFilled) return
  const copiado = await $.ui.copy({ text: texto, surface })
  $.ui.toast(copiado.isCopied ? 'Detalhes copiados: cole no chat com Ctrl+V' : 'Não consegui colar nem copiar os detalhes')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const resultado = await next(e)
    cwd = e.cwd
    home = /^(\/home\/[^/]+|\/Users\/[^/]+|\/root)/.exec(e.cwd)?.[1] ?? ''
    await $.command.register({
      name: COMANDO,
      description: 'Mostra os resultados do teste-mods; "/teste-mods corrigir" pede a correção ao Claude',
    })
    // Depois de recarregar o próprio mod, retoma o que ficou na fila.
    if ((await read($, pendentes)).length > 0) $.clock.after(0, () => void processar($))
    return resultado
  })

  on('tool.call', async ($, e, next) => {
    const resultado = await next(e)
    if (resultado.deny !== undefined || resultado.isError) return resultado

    const entrada = e as unknown as { file_path?: unknown; notebook_path?: unknown; command?: unknown }
    const caminhos: string[] = []
    if (FERRAMENTAS_DE_EDICAO.has(e.tool)) {
      const p = entrada.file_path ?? entrada.notebook_path
      if (typeof p === 'string') caminhos.push(p)
    } else if (e.tool === 'Bash' && typeof entrada.command === 'string') {
      caminhos.push(...caminhosDoBash(entrada.command))
    }
    if (caminhos.length > 0) await marcar($, caminhos)
    return resultado
  })

  on('turn.complete', async ($, e, next) => {
    const resultado = await next(e)
    if (e.agentId === undefined && (await read($, pendentes)).length > 0) {
      // Fora do turno: os testes não seguram o fim da resposta.
      $.clock.after(0, () => void processar($))
    }
    return resultado
  })

  on('command.run', { command: COMANDO }, async ($, e) => {
    if (e.args.trim() === 'corrigir') {
      const lista = await falhas($)
      if (lista.length === 0) return { text: 'Nenhuma falha para corrigir.' }
      // Um prompt mandado de dentro do comando esperaria o turno que o próprio comando segura.
      $.clock.after(0, () => void pedirCorrecao($, lista))
      return { text: `Pedindo ao Claude a correção de ${lista.map(x => x.mod).join(', ')}.` }
    }
    const aberto = await $.ui.open({ id: PAINEL, title: TITULO })
    return { text: aberto.isPlaced ? `Painel ${TITULO} aberto.` : `Painel não abriu: ${aberto.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const lista = await read($, execucoes)
    const ruins = lista.filter(x => x.estado === 'falhou')

    return (
      <Box flexDirection="column">
        {lista.length === 0 && <Text dimColor>Nenhum mod testado nesta sessão ainda.</Text>}
        {lista
          .filter(x => x.estado !== 'falhou')
          .map(x => (
            <Text dimColor>{linha(x)}</Text>
          ))}
        {ruins.map(x => (
          <Box flexDirection="column">
            <Text> </Text>
            <Text color="red" bold>
              {linha(x)}
            </Text>
            <Text dimColor>{x.pasta}</Text>
            {x.detalhe.split('\n').map(l => (
              <Text>{l}</Text>
            ))}
            <Box>
              <Button key={`corrigir:${x.pasta}`} label="Pedir correção ao Claude" onPress={() => pedirCorrecao($, [x]).then(t => $.ui.toast(t))} />
              <Text> </Text>
              <Button key={`colar:${x.pasta}`} label="Colar no prompt" onPress={press => colarNoPrompt($, [x], press.surface)} />
            </Box>
          </Box>
        ))}
        <Text> </Text>
        <Box>
          {ruins.length > 1 && (
            <Button key="corrigir-todos" label="Corrigir todos" onPress={() => pedirCorrecao($, ruins).then(t => $.ui.toast(t))} />
          )}
          {ruins.length > 1 && <Text> </Text>}
          <Button key="fechar-painel" label="Fechar" onPress={() => $.ui.close({ id: PAINEL })} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const lista = await read($, execucoes)
    if (e.props.hasSurvey || lista.length === 0 || (await read($, oculto))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const falhou = lista.some(x => x.estado === 'falhou')
    return (
      <Box>
        <Text color={falhou ? 'red' : undefined} dimColor={!falhou}>
          🧪 {lista.map(linha).join(' · ')}{' '}
        </Text>
        {falhou && (
          <Button key="detalhes" label="Detalhes" onPress={() => $.ui.open({ id: PAINEL, title: TITULO })} />
        )}
        {falhou && <Text> </Text>}
        {falhou && (
          <Button key="corrigir" label="Corrigir" onPress={async () => $.ui.toast(await pedirCorrecao($, await falhas($)))} />
        )}
        {falhou && <Text> </Text>}
        <Button key="fechar" label="Fechar" onPress={async () => {
            await update($, oculto, () => true)
            $.ui.status(undefined)
          }} />
      </Box>
    )
  })
}
