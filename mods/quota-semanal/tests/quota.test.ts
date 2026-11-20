import { describe, expect, mock, test } from 'claude-code/testing'
import type { SessionContextUsage, SessionRateLimit } from 'claude-code'

import { calcularRitmo, extenso, linhaStatus, SEMANA_MS } from '../hooks/quota'

const RESET = Date.parse('2026-11-20T16:00:00Z')
const INICIO = RESET - SEMANA_MS
const HORA = 3600 * 1000

describe('calcularRitmo', () => {
  test('reproduz o exemplo do script: 95% usado com 97.8% esperado', async () => {
    const r = calcularRitmo(95, RESET, INICIO + 0.978 * SEMANA_MS)

    expect(r.esperado).toBe(97.8)
    expect(r.diferenca).toBe(-2.8)
    expect(r.situacao).toBe('abaixo')
    expect(r.quando).toBe('esperado há 4 horas')
    expect(linhaStatus(r)).toBe(
      '🟢 Quota 7d: 95% · esperado 97.8% · ABAIXO da média em 2.8 pts (esperado há 4 horas)',
    )
  })

  test('acima da média, com o momento esperado no futuro', async () => {
    // 2 dias depois do reset o esperado é 28.6%
    const r = calcularRitmo(40, RESET, INICIO + 2 * 24 * HORA)

    expect(r.esperado).toBe(28.6)
    expect(r.situacao).toBe('acima')
    expect(r.quando).toBe('esperado para 19 horas')
    expect(linhaStatus(r)).toContain('🔴')
    expect(linhaStatus(r)).toContain('ACIMA da média em 11.4 pts')
  })

  test('dentro da tolerância de 0.5 ponto', async () => {
    const r = calcularRitmo(50.3, RESET, INICIO + SEMANA_MS / 2)

    expect(r.situacao).toBe('dentro')
    expect(linhaStatus(r)).toContain('🟡')
    expect(linhaStatus(r)).toContain('dentro da média')
  })

  test('extenso formata como o script', async () => {
    expect(extenso(30 * 60 * 1000)).toBe('menos de 1 hora')
    expect(extenso(HORA)).toBe('1 hora')
    expect(extenso(24 * HORA)).toBe('1 dia')
    expect(extenso(36 * HORA)).toBe('1 dia e 12 horas')
    expect(extenso(50 * HORA)).toBe('2 dias e 2 horas')
  })
})

const CONTEXTO = {} as SessionContextUsage

const seteDias = (percentUsed: number): SessionRateLimit => ({
  kind: 'seven_day',
  percentUsed,
  resetsAt: new Date(RESET).toISOString(),
})

test('o mod atualiza a status line e avisa ao passar da média', async ($, on) => {
  const clock = mock.clock(on, { now: INICIO + 2 * 24 * HORA }) // esperado 28.6%
  const status: (string | undefined)[] = []
  const toasts: string[] = []

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: CONTEXTO, rateLimits: [seteDias(20)] },
  }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.status', (_, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(status.at(-1)).toContain('🟢 Quota 7d: 20%')
  expect(toasts).toEqual([])

  // Um turno gastou bastante: passa para acima da média
  await $.session.measure({ context: CONTEXTO, rateLimits: [seteDias(35)], changed: ['rateLimits'] })
  expect(status.at(-1)).toContain('🔴 Quota 7d: 35%')
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('ACIMA da média')

  // O tempo passa sem uso: o esperado alcança os 35% e a linha volta a ficar verde
  await clock.advance(24 * HORA)
  expect(status.at(-1)).toContain('🟢 Quota 7d: 35%')
  expect(toasts).toHaveLength(2)
  expect(toasts[1]).toContain('voltou para dentro')
})

test('sem leitura de quota, mostra que está aguardando', async ($, on) => {
  mock.clock(on, { now: INICIO })
  const status: (string | undefined)[] = []

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: CONTEXTO, rateLimits: [] } }))
  on('ui.status', (_, e) => {
    status.push(e.text)
    return { value: undefined }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(status.at(-1)).toContain('aguardando')
})
