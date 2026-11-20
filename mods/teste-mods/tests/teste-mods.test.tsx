import { expect, mock, test } from 'claude-code/testing'

import { absoluto } from '../hooks/register'
import { caminhosDoBash, resumir, textoStatus } from '../hooks/resultado'

const saida = (exitCode: number, stdout: string) => ({ exitCode, stdout, stderr: '' })

const VALIDOU = saida(0, '✔ Validation passed with warnings')
const PASSOU = saida(0, '(pass) a\n(pass) b\n\n 2 pass\n 0 fail\nRan 2 tests')

test('resume validate e testes', async () => {
  expect(resumir(VALIDOU, PASSOU)).toEqual({ estado: 'ok', resumo: '2/2 testes' })
  expect(resumir(VALIDOU, saida(1, ' 5 pass\n 1 fail'))).toEqual({
    estado: 'falhou',
    resumo: '1 de 6 testes falhou',
  })
  expect(resumir(VALIDOU, saida(0, 'no tests found'))).toEqual({
    estado: 'ok',
    resumo: 'validado, sem testes',
  })
  expect(resumir(saida(1, '✘ Validation failed'), undefined).resumo).toBe('validação falhou')
  const tipos = saida(0, '❯ line 3: error TS2345: x\n❯ line 9: error TS18048: y\n✔ Validation passed')
  expect(resumir(tipos, PASSOU)).toEqual({ estado: 'falhou', resumo: '2 erros de tipo' })
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
  const ok = { mod: 'a', pasta: '/a', estado: 'ok', resumo: '2/2 testes' } as const
  const ruim = { mod: 'b', pasta: '/b', estado: 'falhou', resumo: '1 erro de tipo' } as const
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
