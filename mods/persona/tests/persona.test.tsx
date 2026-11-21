import type { FsEntry, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { aplicar, classificar, CORES, escolher, extrair, focoDoArquivo, focosDoReadme, lerPersona, relativo } from '../hooks/personas'

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
  '/p/logs/personas/02-dono-salao.md': '# Persona 2 — Dono do salão\n\n## Quem é\n**Seu Jorge**, dono do salão há 20 anos.\n',
  '/p/logs/personas/10-qa.md': 'icone: 🦊\nsem título\n',
  '/p/logs/personas/README.md': [
    '| # | Arquivo | Foco |',
    '| --- | --- | --- |',
    '| 1 | [01-cliente-final.md](01-cliente-final.md) | Agendar pelo celular, sem login |',
  ].join('\n'),
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
  on('prompt.submit', (_, e) => ({ text: e.text }))
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
  expect(lerPersona('01-cliente-final.md', '# Persona 1 — Cliente final\n', 'a', 'b', 'Agendar')).toEqual({
    numero: 1, titulo: 'Cliente final', caminho: 'a', pasta: 'b',
    icone: '🙋', grupo: 'usuario', cor: CORES.usuario, foco: 'Agendar',
  })
  // Sem título no arquivo, vem do nome.
  expect(lerPersona('10-qa-mobile.md', 'texto', 'a', 'b').titulo).toBe('Qa mobile')
  expect(lerPersona('designer.md', '# Designer gráfico', 'a', 'b')).toMatchObject({ numero: null, titulo: 'Designer gráfico' })
})

test('ícone e grupo pelo nome, com ícone e cor do arquivo por cima', async () => {
  const casos: [string, string, string][] = [
    ['01-cliente-final.md', '🙋', 'usuario'],
    ['02-dono-salao.md', '🏪', 'usuario'],
    ['03-profissional.md', '👔', 'usuario'],
    ['04-operador-saas.md', '🔧', 'negocio'],
    ['05-seguranca-supabase.md', '🔐', 'tecnica'],
    ['06-postgres-agenda.md', '🐘', 'tecnica'],
    ['07-frontend-mobile.md', '📱', 'tecnica'],
    ['08-qa.md', '🧪', 'tecnica'],
    ['09-designer-grafico.md', '🎨', 'negocio'],
    ['10-analista-comercial.md', '💼', 'negocio'],
    ['11-astronauta.md', '👤', 'outra'],
  ]
  for (const [arquivo, icone, grupo] of casos) expect({ arquivo, ...classificar(arquivo, '') }).toEqual({ arquivo, icone, grupo })

  // "terapia" não é "api", nem "contestação" é "test".
  expect(classificar('terapia-contestacao.md', '').grupo).toBe('outra')
  const propria = lerPersona('x.md', '---\nicone: 🦊\ncor: "#123456"\n---\n# Raposa', 'x.md', '.')
  expect(propria).toMatchObject({ icone: '🦊', cor: '#123456', titulo: 'Raposa' })
  // Sem grupo, a cor vem da paleta e não muda entre leituras.
  expect(lerPersona('11-astronauta.md', '', 'a', 'b').cor).toBe(lerPersona('11-astronauta.md', '', 'a', 'b').cor)
})

test('foco pela coluna Foco do README, ou pelo "Quem é"', async () => {
  const readme = [
    '# Personas',
    '| # | Arquivo | Subagente | Foco |',
    '| --- | --- | --- | --- |',
    '| 1 | [01-cliente-final.md](01-cliente-final.md) | `persona-cliente-final` | Agendar pelo celular, **sem login** |',
    '',
    '| Fase | Personas |',
    '| --- | --- |',
    '| 1. Setup | 5, 6, 8 |',
  ].join('\n')
  expect([...focosDoReadme(readme)]).toEqual([['01-cliente-final.md', 'Agendar pelo celular, sem login']])

  const arquivo = '# Persona 1 — Cliente final\n\n## Quem é\n**Dona Cida, 55 anos**, cliente fiel.\n\n## O que quer\n- x\n'
  expect(focoDoArquivo(arquivo)).toBe('Dona Cida, 55 anos, cliente fiel.')
  expect(focoDoArquivo('# Só título\n')).toBe('')
  expect(focoDoArquivo(`# T\n${'a'.repeat(100)}`)).toHaveLength(80)
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
  expect(extrair(aplicar(dois, ['minha pasta/a.md']))).toEqual(['p/01.md', 'p/02.md', 'minha pasta/a.md'])
  expect(extrair('veja a página xpto')).toEqual([])
})

test('/persona 2 1 põe as duas no prompt, achadas em logs/personas', async ($, on) => {
  const clock = mock.clock(on)
  const prompt = projeto(on)
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })

  const r = await $.command.run(comando('2 1'))
  expect(r.text).toBe('No prompt: 🏪 2 · Dono do salão, 🙋 1 · Cliente final')
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
    const botoes = await ui.findAll({ type: 'Button' })
    // O terminal desenha ícone e cor dentro do botão; desktop e VSCode, botão
    // nativo só com o nome, e número e ícone ao lado, como texto.
    expect(botoes.map(b => b.props.label)).toEqual(
      surface === 'terminal'
        ? ['1 · Cliente final', '2 · Dono do salão', '10 · Qa', 'Atualizar lista', 'Fechar']
        : ['Cliente final', 'Dono do salão', 'Qa', 'Atualizar lista', 'Fechar'],
    )
    // Atalho só de 1 a 9.
    expect(botoes.slice(0, 3).map(b => b.props.hotkey)).toEqual(['1', '2', undefined])
    if (surface === 'terminal') expect(botoes[2]?.text).toContain('🦊')
    else expect(await ui.find({ type: 'Text', text: /🦊/ })).toBeDefined()
    // Foco do README para a 1, do "Quem é" para a 2.
    expect(await ui.find({ type: 'Text', text: /Agendar pelo celular/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Seu Jorge, dono do salão/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PAINEL, surface: 'terminal' })
  const cliente = 'p:logs/personas/01-cliente-final.md'
  expect((await ui.find({ type: 'Button', key: cliente }))?.text).not.toContain('✓')
  await ui.press({ key: cliente })
  expect(prompt.text).toBe('Claude, usando a persona @logs/personas/01-cliente-final.md, veja a página xpto')
  // Já no prompt: ganha o ✓, que some quando a mensagem é enviada.
  expect((await ui.find({ type: 'Button', key: cliente }))?.text).toContain('✓')
  const vscode = await $.ui.mount({ ...PAINEL, surface: 'vscode' })
  expect(await vscode.find({ type: 'Text', text: /✓/ })).toBeDefined()
  await $.prompt.submit({ text: prompt.text, origin: { kind: 'composer' }, wait: false } as const)
  expect((await ui.find({ type: 'Button', key: cliente }))?.text).not.toContain('✓')
  expect(await vscode.find({ type: 'Text', text: /✓/ })).toBeUndefined()
  await vscode.unmount()
  await ui.unmount()
})

test('sem pasta personas, explica o que criar', async ($, on) => {
  on('session.cwd', () => ({ value: '/vazio' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  const r = await $.command.run(comando(''))
  expect(r.text).toContain('Nenhuma persona encontrada')
})
