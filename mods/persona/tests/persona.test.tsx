import type { FsEntry, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { aplicar, escolher, lerPersona, relativo } from '../hooks/personas'

const dir = (name: string): FsEntry => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })
const arq = (name: string): FsEntry => ({ name, kind: 'file', size: 10, mtimeMs: 0, isLink: false })

// Um projeto em /p com as personas em logs/personas e dependências que a busca pula.
const PASTAS: Record<string, FsEntry[]> = {
  '/p': [dir('logs'), dir('node_modules'), dir('.git'), dir('src'), arq('README.md')],
  '/p/logs': [dir('personas')],
  '/p/logs/personas': [arq('README.md'), arq('02-dono-salao.md'), arq('01-cliente-final.md'), arq('10-qa.md'), arq('notas.txt')],
  '/p/node_modules': [dir('personas')],
  '/p/src': [],
}
const ARQUIVOS: Record<string, string> = {
  '/p/logs/personas/01-cliente-final.md': '# Persona 1 — Cliente final\n\n## Quem é\n',
  '/p/logs/personas/02-dono-salao.md': '# Persona 2 — Dono do salão\n',
  '/p/logs/personas/10-qa.md': 'sem título\n',
}

/** O mundo sob o mod: a sessão em `cwd`, o disco acima e um campo de prompt. */
function projeto(on: On, cwd = '/p', rascunho = '') {
  const prompt = { text: rascunho }
  on('session.cwd', () => ({ value: cwd }))
  on('fs.list', (_, e) => ({ value: PASTAS[e.path] ?? [] }))
  on('fs.read', (_, e) => ({ value: ARQUIVOS[e.path] ?? '' }))
  on('fs.exists', (_, e) => ({ value: e.path === '/p/.git' }))
  on('prompt.read', () => ({ value: { text: prompt.text, cursor: prompt.text.length } }))
  on('prompt.fill', (_, e) => {
    prompt.text = e.text
    return { isFilled: true }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'persona' } }))
  return prompt
}

/** Roda `/persona <args>` como se a pessoa tivesse digitado. */
const comando = (args: string) =>
  ({
    command: 'persona',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  }) as const

const PAINEL = {
  plugin: 'persona',
  component: 'Pane',
  requestId: 'persona',
  props: {
    title: 'Personas',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('lê número e título da persona', async () => {
  expect(lerPersona('01-cliente-final.md', '# Persona 1 — Cliente final\n', 'a', 'b')).toEqual({
    numero: 1, titulo: 'Cliente final', caminho: 'a', pasta: 'b',
  })
  // Sem título no arquivo, vem do nome.
  expect(lerPersona('10-qa-mobile.md', 'texto', 'a', 'b').titulo).toBe('Qa mobile')
  expect(lerPersona('designer.md', '# Designer gráfico', 'a', 'b')).toMatchObject({ numero: null, titulo: 'Designer gráfico' })
})

test('caminho relativo ao diretório da sessão, absoluto fora dele', async () => {
  expect(relativo('/p', '/p/logs/personas/a.md')).toBe('logs/personas/a.md')
  expect(relativo('/p/mods/x', '/p/logs/personas/a.md')).toBe('/p/logs/personas/a.md')
  expect(relativo('/p', '/pp/a.md')).toBe('/pp/a.md')
})

test('escolhe por número ou por nome, sem acento', async () => {
  const lista = [
    lerPersona('01-cliente-final.md', '# Cliente final', 'x/01-cliente-final.md', 'x'),
    lerPersona('02-dono-salao.md', '# Dono do salão', 'x/02-dono-salao.md', 'x'),
    lerPersona('08-qa.md', '# QA', 'x/08-qa.md', 'x'),
  ]
  expect(escolher(lista, '8 01').achadas.map(p => p.numero)).toEqual([8, 1])
  expect(escolher(lista, 'salao').achadas.map(p => p.numero)).toEqual([2])
  expect(escolher(lista, 'qa, 99')).toMatchObject({ faltando: ['99'] })
})

test('monta o começo do prompt e soma personas sem perder o texto', async () => {
  expect(aplicar('', ['logs/personas/01-a.md'])).toBe('Claude, usando a persona @logs/personas/01-a.md, ')
  const um = aplicar('veja a página xpto', ['p/01.md'])
  expect(um).toBe('Claude, usando a persona @p/01.md, veja a página xpto')
  const dois = aplicar(um, ['p/02.md'])
  expect(dois).toBe('Claude, usando as personas @p/01.md e @p/02.md, veja a página xpto')
  expect(aplicar(dois, ['p/03.md', 'p/01.md'])).toBe(
    'Claude, usando as personas @p/01.md, @p/02.md e @p/03.md, veja a página xpto',
  )
  expect(aplicar('', ['minha pasta/a.md'])).toBe('Claude, usando a persona @"minha pasta/a.md", ')
})

test('/persona 2 1 põe as duas no prompt, achadas em logs/personas', async ($, on) => {
  const clock = mock.clock(on)
  const prompt = projeto(on)
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })

  const r = await $.command.run(comando('2 1'))
  expect(r.text).toBe('No prompt: 2 · Dono do salão, 1 · Cliente final')
  await clock.settle()
  expect(prompt.text).toBe(
    'Claude, usando as personas @logs/personas/02-dono-salao.md e @logs/personas/01-cliente-final.md, ',
  )
})

test('sessão numa subpasta acha as personas na raiz do repositório', async ($, on) => {
  const clock = mock.clock(on)
  const prompt = projeto(on, '/p/src')
  await $.command.run(comando('cliente'))
  await clock.settle()
  expect(prompt.text).toBe('Claude, usando a persona @/p/logs/personas/01-cliente-final.md, ')
})

test('/persona abre o painel e um clique põe a persona no prompt', async ($, on) => {
  const prompt = projeto(on, '/p', 'veja a página xpto')
  const r = await $.command.run(comando(''))
  expect(r.text).toBe('3 personas no painel Personas.')

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PAINEL, surface })
    expect((await ui.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual([
      '1 · Cliente final', '2 · Dono do salão', '10 · Qa', 'Atualizar lista', 'Fechar',
    ])
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PAINEL, surface: 'terminal' })
  await ui.press({ key: 'p:logs/personas/01-cliente-final.md' })
  expect(prompt.text).toBe('Claude, usando a persona @logs/personas/01-cliente-final.md, veja a página xpto')
  await ui.unmount()
})

test('sem pasta personas, explica o que criar', async ($, on) => {
  on('session.cwd', () => ({ value: '/vazio' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  const r = await $.command.run(comando(''))
  expect(r.text).toContain('Nenhuma persona encontrada')
})
