import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { aviso, duracao, resumo } from '../hooks/aviso'

const MIN = 60_000

test('formata a duração', async () => {
  expect(duracao(45_000)).toBe('45s')
  expect(duracao(3 * MIN)).toBe('3min')
  expect(duracao(3 * MIN + 12_000)).toBe('3min12s')
  expect(duracao(65 * MIN)).toBe('1h05')
})

test('resume a resposta pela primeira linha com texto', async () => {
  expect(resumo('\n## **Pronto**: mod criado\n\nresto')).toBe('Pronto: mod criado')
  expect(resumo('- item `um`')).toBe('item um')
  expect(resumo('x'.repeat(150))).toHaveLength(100)
  expect(resumo('')).toBe('')
})

test('só avisa turnos longos que não foram interrompidos', async () => {
  expect(aviso(1 * MIN, 'answer', 'oi', 2 * MIN)).toBeUndefined()
  expect(aviso(5 * MIN, 'aborted', 'oi', 2 * MIN)).toBeUndefined()
  expect(aviso(3 * MIN, 'answer', 'Feito.', 2 * MIN)).toEqual({ titulo: 'Claude terminou (3min)', texto: 'Feito.' })
  expect(aviso(2 * MIN, 'error', '', 2 * MIN)).toEqual({
    titulo: 'Claude parou com erro (2min)',
    texto: 'Turno concluído.',
  })
})

/** Prepara o motor: notify responde `enviado`, e os processos ficam registrados. */
function motor(on: On, enviado: boolean) {
  const notificacoes: string[] = []
  const processos: string[] = []
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notify', (_, e) => {
    notificacoes.push(`${e.title}: ${e.text}`)
    return { value: enviado ? { isSent: true, channel: 'auto' } : { isSent: false, reason: 'no-surface' } } as never
  })
  on('process.run', (_, e) => {
    processos.push(e.argv[0] ?? '')
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { notificacoes, processos }
}

const fim = (durationMs: number, extra: { agentId?: string } = {}) => ({
  answer: 'Pronto: mod criado',
  durationMs,
  isAborted: false,
  turnId: 't',
  reason: 'answer' as const,
  ...extra,
})

test('no terminal usa a notificação do Claude Code e toca o som', async ($, on) => {
  const m = motor(on, true)
  await $.turn.complete(fim(3 * MIN))
  expect(m.notificacoes).toEqual(['Claude terminou (3min): Pronto: mod criado'])
  expect(m.processos).toEqual(['paplay'])

  // Turno curto e turno de subagente não avisam.
  await $.turn.complete(fim(30_000))
  await $.turn.complete(fim(5 * MIN, { agentId: 'a1' }))
  expect(m.notificacoes).toHaveLength(1)
})

test('sem canal (VSCode) cai no notify-send', async ($, on) => {
  const m = motor(on, false)
  await $.turn.complete(fim(3 * MIN))
  expect(m.processos).toEqual(['notify-send', 'paplay'])
})

test('respeita o limite e o som configurados', { options: { limiteSegundos: 600, som: false } }, async ($, on) => {
  const m = motor(on, true)
  await $.turn.complete(fim(5 * MIN))
  expect(m.notificacoes).toEqual([])
  await $.turn.complete(fim(11 * MIN))
  expect(m.notificacoes).toHaveLength(1)
  expect(m.processos).toEqual([])
})
