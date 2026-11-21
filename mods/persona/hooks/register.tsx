import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { Persona } from '../types'
import { aplicar, escolher, IGNORAR, lerPersona, ordenar, relativo, rotulo } from './personas'

// Mude o `shape` quando os campos de Persona mudarem: descarta o que uma versão antiga guardou.
const lista = atom({ plugin: 'persona', key: 'lista' } as const, [], { shape: 'persona-1' })

const COMANDO = 'persona'
const PAINEL = 'persona'
const TITULO = 'Personas'

/** Quão fundo a busca desce a partir da raiz do projeto. */
const PROFUNDIDADE = 5
/** Quantas pastas a busca abre no máximo, para não varrer um projeto enorme. */
const MAX_PASTAS = 3000

/** As pastas chamadas `personas` sob `raiz`, sem entrar em ocultas nem em dependências. */
async function acharPastas($: EngineInterface, raiz: string): Promise<string[]> {
  const achadas: string[] = []
  let fila = [raiz]
  let abertas = 0
  for (let nivel = 0; nivel <= PROFUNDIDADE && fila.length > 0; nivel++) {
    const proxima: string[] = []
    for (const dir of fila) {
      if (++abertas > MAX_PASTAS) return achadas
      const itens = await $.fs.list(dir).catch(() => [])
      for (const item of itens) {
        if (item.kind !== 'dir' || item.name.startsWith('.') || IGNORAR.has(item.name)) continue
        const caminho = `${dir}/${item.name}`
        if (item.name.toLowerCase() === 'personas') achadas.push(caminho)
        else proxima.push(caminho)
      }
    }
    fila = proxima
  }
  return achadas
}

/** A raiz do repositório git que contém `dir`, ou undefined. */
async function raizGit($: EngineInterface, dir: string): Promise<string | undefined> {
  for (let d = dir; d !== '' && d !== '/'; d = d.slice(0, d.lastIndexOf('/'))) {
    if (await $.fs.exists(`${d}/.git`)) return d
  }
  return undefined
}

/**
 * As personas do projeto: busca a partir do diretório da sessão e, sem nada ali
 * (sessão aberta numa subpasta), a partir da raiz do repositório git.
 */
async function carregar($: EngineInterface): Promise<Persona[]> {
  const cwd = await $.session.cwd()
  let pastas = await acharPastas($, cwd)
  if (pastas.length === 0) {
    const raiz = await raizGit($, cwd)
    if (raiz !== undefined && raiz !== cwd) pastas = await acharPastas($, raiz)
  }

  const achadas: Persona[] = []
  for (const pasta of pastas) {
    const itens = await $.fs.list(pasta).catch(() => [])
    for (const item of itens) {
      if (item.kind !== 'file' || !/\.md$/i.test(item.name) || /^readme\.md$/i.test(item.name)) continue
      const absoluto = `${pasta}/${item.name}`
      const conteudo = await $.fs.read(absoluto, { length: 4096 }).catch(() => '')
      achadas.push(lerPersona(item.name, conteudo, relativo(cwd, absoluto), relativo(cwd, pasta)))
    }
  }
  return ordenar(achadas)
}

/** Põe as personas no começo do prompt, mantendo o que já estava escrito; sem campo de prompt, copia. */
async function usar($: EngineInterface, escolhidas: readonly Persona[], surface?: RenderSurface): Promise<void> {
  const caixa = await $.prompt.read().catch(() => undefined)
  const texto = aplicar(caixa?.text ?? '', escolhidas.map(p => p.caminho))
  const preenchido = await $.prompt.fill({ text: texto, mode: 'replace' }).catch(() => undefined)
  if (preenchido?.isFilled) return
  const copiado = await $.ui.copy({ text: texto, surface }).catch(() => undefined)
  $.ui.toast(copiado?.isCopied ? 'Persona copiada: cole no prompt com Ctrl+V' : 'Não consegui colocar a persona no prompt')
}

/** A lista em texto, para quando o painel não abre ou o argumento não bate. */
const listaEmTexto = (personas: readonly Persona[]) =>
  personas.map(p => `  ${rotulo(p)}  (${p.caminho})`).join('\n')

const semPersonas = (cwd: string) =>
  `Nenhuma persona encontrada: crie uma pasta personas/ com um .md por persona em ${cwd}.`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const resultado = await next(e)
    await $.command.register({
      name: COMANDO,
      description: 'Lista as personas do projeto para pôr no prompt; "/persona 5 6 8" ou "/persona qa" já coloca',
    })
    return resultado
  })

  on('command.run', { command: COMANDO }, async ($, e) => {
    const personas = await carregar($)
    await update($, lista, () => personas)
    if (personas.length === 0) return { text: semPersonas(await $.session.cwd()) }

    const args = e.args.trim()
    if (args !== '') {
      const { achadas, faltando } = escolher(personas, args)
      if (achadas.length === 0) {
        return { text: `Nenhuma persona bate com "${args}". As do projeto:\n${listaEmTexto(personas)}` }
      }
      // Fora do comando: o campo do prompt só fica livre depois que o comando termina.
      $.clock.after(0, () => void usar($, achadas))
      const aviso = faltando.length > 0 ? ` (sem persona para: ${faltando.join(', ')})` : ''
      return { text: `No prompt: ${achadas.map(rotulo).join(', ')}${aviso}` }
    }

    const aberto = await $.ui.open({ id: PAINEL, title: TITULO })
    if (aberto.isPlaced) return { text: `${personas.length} personas no painel ${TITULO}.` }
    return { text: `Personas do projeto (use /persona <número>):\n${listaEmTexto(personas)}` }
  })

  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const personas = await read($, lista)
    const pastas = [...new Set(personas.map(p => p.pasta))]

    return (
      <Box flexDirection="column">
        {personas.length === 0 && <Text dimColor>Nenhuma persona encontrada neste projeto.</Text>}
        {personas.length > 0 && <Text dimColor>Clique para pôr no começo do prompt; clique em outra para somar.</Text>}
        {pastas.map(pasta => (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold>{pasta}</Text>
            {personas
              .filter(p => p.pasta === pasta)
              .map(p => (
                <Button key={`p:${p.caminho}`} label={rotulo(p)} onPress={press => usar($, [p], press.surface)} />
              ))}
          </Box>
        ))}
        <Text> </Text>
        <Box>
          <Button key="atualizar" label="Atualizar lista" onPress={async () => {
              const nova = await carregar($)
              await update($, lista, () => nova)
            }} />
          <Text> </Text>
          <Button key="fechar" label="Fechar" onPress={() => $.ui.close({ id: PAINEL })} />
        </Box>
      </Box>
    )
  })
}
