import { describe, expect, mock, test } from 'claude-code/testing'
import type { SessionContextUsage, SessionRateLimit } from 'claude-code'

import { calcularRitmo, curto, linhaStatus, setas, SEMANA_MS } from '../hooks/quota'

const RESET = Date.parse('2026-11-20T16:00:00Z')
const INICIO = RESET - SEMANA_MS
const HORA = 3600 * 1000

describe('calcularRitmo', () => {
  test('reproduz o exemplo do script: 95% usado com 97.8% esperado', async () => {
    const r = calcularRitmo(95, RESET, INICIO + 0.978 * SEMANA_MS)

    expect(r.esperado).toBe(97.8)
    expect(r.diferenca).toBe(-2.8)
    expect(r.situacao).toBe('abaixo')
    expect(r.tempo).toBe('4h')
    expect(linhaStatus(r)).toBe('🟢▼ 7d 95% · esp 97.8% · -2.8 pts · 4h')
  })

  test('acima da média, com o momento esperado no futuro', async () => {
    // 2 dias depois do reset o esperado é 28.6%
    const r = calcularRitmo(40, RESET, INICIO + 2 * 24 * HORA)

    expect(r.esperado).toBe(28.6)
    expect(r.situacao).toBe('acima')
    expect(r.tempo).toBe('19h')
    expect(linhaStatus(r)).toBe('🔴▲▲ 7d 40% · esp 28.6% · +11.4 pts · 19h')
  })

  test('dentro da tolerância de 0.5 ponto', async () => {
    const r = calcularRitmo(50.3, RESET, INICIO + SEMANA_MS / 2)

    expect(r.situacao).toBe('dentro')
    expect(linhaStatus(r)).toBe('🟡= 7d 50.3% · esp 50.0% · na média')
  })

  test('as setas crescem com o desvio: 1 até 10 pts, 2 a partir de 10, 3 a partir de 15', async () => {
    const meio = INICIO + SEMANA_MS / 2 // esperado 50%
    const casos: [number, string][] = [
      [58, '▲'], // +8
      [60, '▲▲'], // +10
      [62, '▲▲'], // +12
      [65, '▲▲▲'], // +15
      [68, '▲▲▲'], // +18
      [42, '▼'], // -8
      [40, '▼▼'], // -10
      [38, '▼▼'], // -12
      [35, '▼▼▼'], // -15
      [32, '▼▼▼'], // -18
      [50, '='],
    ]

    for (const [usado, esperado] of casos) {
      expect(setas(calcularRitmo(usado, RESET, meio))).toBe(esperado)
    }

    expect(linhaStatus(calcularRitmo(68, RESET, meio))).toContain('🔴▲▲▲ 7d 68%')
    expect(linhaStatus(calcularRitmo(32, RESET, meio))).toContain('🟢▼▼▼ 7d 32%')
  })

  test('curto formata o tempo de forma compacta', async () => {
    expect(curto(30 * 60 * 1000)).toBe('<1h')
    expect(curto(HORA)).toBe('1h')
    expect(curto(24 * HORA)).toBe('1d')
    expect(curto(36 * HORA)).toBe('1d12h')
    expect(curto(50 * HORA)).toBe('2d2h')
  })
})

const CONTEXTO = {} as SessionContextUsage

const seteDias = (percentUsed: number): SessionRateLimit => ({
  kind: 'seven_day',
  percentUsed,
  resetsAt: new Date(RESET).toISOString(),
})

test('o mod atualiza a status line e só avisa quando volta para a média', async ($, on) => {
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
  expect(status.at(-1)).toContain('🟢▼ 7d 20%')
  expect(toasts).toEqual([])

  // Um turno gastou bastante: passa para acima da média, só na status line
  await $.session.measure({ context: CONTEXTO, rateLimits: [seteDias(35)], changed: ['rateLimits'] })
  expect(status.at(-1)).toContain('🔴▲ 7d 35%')
  expect(toasts).toEqual([])

  // O tempo passa sem uso: o esperado alcança os 35% e a linha volta a ficar verde
  await clock.advance(24 * HORA)
  expect(status.at(-1)).toContain('🟢▼ 7d 35%')
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('voltou para dentro')
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
