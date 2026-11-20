import { expect, mock, test } from 'claude-code/testing'

import { absoluto } from '../hooks/register'
import { caminhosDoBash, pedidoCorrecao, resumir, textoStatus } from '../hooks/resultado'

const saida = (exitCode: number, stdout: string) => ({ exitCode, stdout, stderr: '' })

const VALIDOU = saida(0, '✔ Validation passed with warnings')
const PASSOU = saida(0, '(pass) a\n(pass) b\n\n 2 pass\n 0 fail\nRan 2 tests')

// Trechos reais da saída de `claude plugin validate` e `claude plugin test`.
const VALIDATE_COM_ERROS = saida(0, [
  'Validating hooks: /m/x/hooks/register.ts',
  '',
  '⚠ Found 1 warning:',
  '',
  "  ❯ line 9, column 9: error TS2322: Type 'boolean' is not assignable to type 'number'.",
  '',
  'Validating hooks: /m/x/tests/x.test.ts',
  '',
  '⚠ Found 1 warning:',
  '',
  "  ❯ line 2, column 15: error TS2459: Module declares 'On' locally.",
  '',
  'Plugin directory checks for /m/x.',
  '✘ Found 2 problems the plugin directory refuses a submission for:',
  '  ❯ README.md: README missing (README_MISSING).',
  '✔ Validation passed with warnings',
].join('\n'))

const TESTE_COM_FALHA = saida(1, [
  'tests/x.test.ts:',
  '(fail) formata a duração [2.44ms]',
  '  AssertionError: expect(received).toBe()',
  '  ',
  '  Expected: "46s"',
  '  Received: "45s"',
  '(pass) outro [0.78ms]',
  '',
  ' 1 pass',
  ' 1 fail',
].join('\n'))

test('resume validate e testes', async () => {
  expect(resumir('/m/x', VALIDOU, PASSOU)).toEqual({ estado: 'ok', resumo: '2/2 testes', detalhe: '' })
  expect(resumir('/m/x', VALIDOU, saida(0, 'no tests found')).resumo).toBe('validado, sem testes')
  expect(resumir('/m/x', saida(1, '✘ Validation failed'), undefined).resumo).toBe('validação falhou')
  // A seção do catálogo (README, LICENSE) não conta como falha.
  expect(resumir('/m/x', saida(0, 'Plugin directory checks\n✘ Found 2 problems\n✔ Validation passed'), PASSOU).estado).toBe('ok')
})

test('detalha erros de tipo e testes que falharam', async () => {
  const r = resumir('/m/x', VALIDATE_COM_ERROS, TESTE_COM_FALHA)
  expect(r.estado).toBe('falhou')
  expect(r.resumo).toBe('2 erros de tipo · 1 de 2 testes falhou')
  expect(r.detalhe.split('\n')).toEqual([
    'claude plugin validate:',
    "  hooks/register.ts:9:9 TS2322: Type 'boolean' is not assignable to type 'number'.",
    "  tests/x.test.ts:2:15 TS2459: Module declares 'On' locally.",
    'claude plugin test:',
    '(fail) formata a duração',
    '  AssertionError: expect(received).toBe()',
    '  Expected: "46s"',
    '  Received: "45s"',
  ])
})

test('o pedido de correção leva o mod, a pasta e o detalhe', async () => {
  const x = { mod: 'x', pasta: '/m/x', estado: 'falhou', resumo: '1 erro de tipo', detalhe: 'linha do erro' } as const
  const pedido = pedidoCorrecao([x])
  expect(pedido).toContain('Mod `x` (/m/x): 1 erro de tipo.')
  expect(pedido).toContain('```\nlinha do erro\n```')
  expect(pedido).toContain('claude plugin test')
})

test('acha caminhos só em comandos que escrevem', async () => {
  // A expressão do sed também vem: inofensivo, ela não leva a nenhum plugin.json.
  expect(caminhosDoBash("sed -i 's/a/b/' mods/x/hooks/a.ts")).toContain('mods/x/hooks/a.ts')
  expect(caminhosDoBash('cat > mods/x/tests/a.test.ts <<EOF')).toEqual(['mods/x/tests/a.test.ts'])
  expect(caminhosDoBash('mkdir -p mods/y/hooks')).toEqual(['mods/y/hooks'])
  expect(caminhosDoBash('cat mods/x/hooks/a.ts 2>/dev/null')).toEqual([])
  expect(caminhosDoBash('grep -n foo mods/x/hooks/a.ts 2>&1')).toEqual([])
  expect(caminhosDoBash('claude plugin test mods/x')).toEqual([])
})

test('normaliza caminhos', async () => {
  expect(absoluto('/repo', '/home/u', 'mods/x/a.ts')).toBe('/repo/mods/x/a.ts')
  expect(absoluto('/repo/mods', '/home/u', '../README.md')).toBe('/repo/README.md')
  expect(absoluto('/repo', '/home/u', '~/x/./y')).toBe('/home/u/x/y')
  expect(absoluto('/repo', '/home/u', '/abs/z')).toBe('/abs/z')
})

test('a status line mostra as falhas primeiro', async () => {
  const ok = { mod: 'a', pasta: '/a', estado: 'ok', resumo: '2/2 testes', detalhe: '' } as const
  const ruim = { mod: 'b', pasta: '/b', estado: 'falhou', resumo: '1 erro de tipo', detalhe: 'x' } as const
  expect(textoStatus([])).toBeUndefined()
  expect(textoStatus([ok])).toBe('🧪 ✅ a 2/2 testes')
  expect(textoStatus([ok, ruim])).toBe('🧪 ❌ b 1 erro de tipo')
  expect(textoStatus([{ ...ok, estado: 'rodando' }])).toBe('🧪 ⏳ a')
})

test('ao fim do turno testa o mod editado e mostra o resultado', async ($, on) => {
  const clock = mock.clock(on)
  const status: (string | undefined)[] = []
  const rodados: string[] = []

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }) as never)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('fs.exists', (_, e) => ({ value: e.path === '/repo/mods/contexto/.claude-plugin/plugin.json' }))
  on('process.run', (_, e) => {
    rodados.push(e.argv.slice(2).join(' '))
    return { value: { ...(e.argv[2] === 'validate' ? VALIDOU : PASSOU), isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.status', (_, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.close', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'teste-mods' } }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: 'mods/contexto/hooks/register.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'a', new_string: 'b' })
  await $.turn.complete({ answer: 'feito', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.settle()

  expect(rodados).toEqual(['validate /repo/mods/contexto', 'test /repo/mods/contexto'])
  expect(status.at(-1)).toBe('🧪 ✅ contexto 2/2 testes')

  const ui = await $.ui.mount({
    plugin: 'teste-mods',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  })
  expect((await ui.find({ type: 'Text', text: /contexto/ }))?.text).toContain('✅ contexto 2/2 testes')
  await ui.press({ key: 'fechar' })
  expect(await ui.find({ type: 'Text', text: /contexto/ })).toBeUndefined()
  expect(status.at(-1)).toBeUndefined()
  await ui.unmount()

  // Um turno sem edição em mod não roda nada.
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  await clock.settle()
  expect(rodados).toHaveLength(2)
})

test('na falha abre o painel, que pede a correção ou cola os detalhes', async ($, on) => {
  const clock = mock.clock(on)
  const abertos: string[] = []
  const enviados: string[] = []
  const colados: string[] = []
  const copiados: string[] = []
  const toasts: string[] = []

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }) as never)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('fs.exists', (_, e) => ({ value: e.path === '/m/x/.claude-plugin/plugin.json' }))
  on('process.run', (_, e) => ({
    value: {
      ...(e.argv[2] === 'validate' ? VALIDATE_COM_ERROS : TESTE_COM_FALHA),
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'teste-mods' } }))
  on('ui.open', (_, e) => {
    abertos.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('prompt.submit', (_, e) => {
    enviados.push(e.text)
    return { text: e.text }
  })
  // Sem campo de prompt (como numa sessão sem terminal): cai na área de transferência.
  on('prompt.fill', (_, e) => {
    colados.push(e.text)
    return { isFilled: false, refusal: 'no_composer' } as never
  })
  on('ui.copy', (_, e) => {
    copiados.push(e.text)
    return { value: { isCopied: true } }
  })

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: '/m/x/hooks/register.ts', content: '' })
  await $.turn.complete({ answer: 'feito', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.settle()

  expect(abertos).toEqual(['teste-mods'])
  expect(toasts.at(-1)).toContain('x: 2 erros de tipo · 1 de 2 testes falhou')

  const ui = await $.ui.mount({
    plugin: 'teste-mods',
    surface: 'vscode',
    component: 'Pane',
    requestId: 'teste-mods',
    props: {
      title: 'Testes de mods',
      isFocused: false,
      bodyColumns: 80,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  })
  expect(await ui.find({ type: 'Text', text: /hooks\/register\.ts:9:9 TS2322/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Received: "45s"/ })).toBeDefined()

  await ui.press({ key: 'corrigir:/m/x' })
  expect(enviados).toHaveLength(1)
  expect(enviados[0]).toContain('Mod `x` (/m/x): 2 erros de tipo · 1 de 2 testes falhou.')
  expect(enviados[0]).toContain('hooks/register.ts:9:9 TS2322')

  await ui.press({ key: 'colar:/m/x' })
  expect(colados).toEqual([enviados[0]])
  expect(copiados).toEqual([enviados[0]])
  expect(toasts.at(-1)).toContain('copiados')
  await ui.unmount()

  // O comando também pede a correção.
  const r = await $.command.run({ command: 'teste-mods', args: 'corrigir' } as never)
  await clock.settle()
  expect(enviados).toHaveLength(2)
  expect(JSON.stringify(r)).toContain('Pedindo ao Claude a correção de x')
})
