import { expect, mock, test } from 'claude-code/testing'

import { HORA_MS, barra, duracao, ritmo, taxaCache, tokens } from '../hooks/calc'

const DIA_MS = 24 * HORA_MS

test('formata barras, tokens e durações', async () => {
  expect(barra(0)).toBe('░░░░░░░░░░')
  expect(barra(42)).toBe('████░░░░░░')
  expect(barra(150)).toBe('██████████')
  expect(tokens(950)).toBe('950')
  expect(tokens(12_340)).toBe('12.3k')
  expect(tokens(2_100_000)).toBe('2.1M')
  expect(duracao(48_000)).toBe('48s')
  expect(duracao(12 * 60_000)).toBe('12min')
  expect(duracao(2 * HORA_MS + 5 * 60_000)).toBe('2h05')
  expect(duracao(DIA_MS + 4 * HORA_MS)).toBe('1d4h')
})

test('calcula o ritmo de qualquer janela', async () => {
  // Metade da janela de 5h passada: o esperado é 50%.
  const reset = 10 * HORA_MS
  const agora = reset - 2.5 * HORA_MS
  expect(ritmo(60, reset, agora, 5 * HORA_MS)).toEqual({ esperado: 50, diferenca: 10, situacao: 'acima' })
  expect(ritmo(50.3, reset, agora, 5 * HORA_MS).situacao).toBe('dentro')
  expect(ritmo(20, reset, agora, 5 * HORA_MS).situacao).toBe('abaixo')
})

test('taxa de cache sobre toda a entrada', async () => {
  expect(taxaCache({ entrada: 0, saida: 5, cacheLido: 0, cacheEscrito: 0 })).toBeUndefined()
  expect(taxaCache({ entrada: 100, saida: 0, cacheLido: 800, cacheEscrito: 100 })).toBe(80)
})

const PANE = {
  plugin: 'painel-consumo',
  component: 'Pane',
  requestId: 'painel-consumo',
  props: {
    title: 'Consumo',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('o painel mostra quota, contexto, sessão e turnos', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-11-20T12:00:00Z') })
  const reset7d = '2026-11-24T00:00:00Z' // faltam 3.5 dias: esperado 50%
  const uso = {
    startedAt: clock.now() - 30 * 60_000,
    context: { window: 200_000, tokens: 122_000, percent: 61 },
    rateLimits: [
      { kind: 'seven_day', percentUsed: 38, resetsAt: reset7d },
      { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-11-20T14:10:00Z' },
    ],
    cost: { usd: 3.4219 },
  }

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: uso }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('command.register', () => ({ value: { command: 'consumo' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.turn.complete({
    answer: 'ok',
    durationMs: 48_000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: {
      input_tokens: 100,
      output_tokens: 3200,
      cache_read_input_tokens: 9500,
      cache_creation_input_tokens: 400,
      model: 'claude-opus-5-5',
    },
  })

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texto = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text

    expect(await texto(/^7d/)).toBe('7d  ████░░░░░░ 38%')
    expect(await texto(/^5h/)).toBe('5h  ████░░░░░░ 42%')
    expect(await texto(/esp 50\.0%/)).toContain('-12.0 pts')
    expect(await texto(/reset em 2h10/)).toBeDefined()
    expect(await texto(/^ctx/)).toBe('ctx ██████░░░░ 61%')
    expect(await texto(/US\$/)).toContain('~US$ 3.42')
    expect(await texto(/turno/)).toBe('1 turno · 30min')
    expect(await texto(/da entrada veio do cache/)).toBe('95% da entrada veio do cache')
    expect(await texto(/^#1/)).toContain('saída 3.2k')
    await ui.unmount()
  }

  // Uma medição nova atualiza o contexto.
  await $.session.measure({ ...uso, context: { ...uso.context, percent: 91 }, changed: ['context'] })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /^ctx/ }))?.text).toBe('ctx █████████░ 91%')
  await ui.unmount()
})

test('na forma de widget mostra uma linha só', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200_000, percent: 10 },
      rateLimits: [{ kind: 'seven_day', percentUsed: 5 }],
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'consumo' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, placement: 'widget' } })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('7d 5% · ctx 10%')
  await ui.unmount()
})
