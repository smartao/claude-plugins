import { expect, test } from 'claude-code/testing'
import type { SessionContextUsage } from 'claude-code'

import { linhaStatus } from '../hooks/register'

const ctx = (percent?: number): SessionContextUsage => ({ window: 200000, percent })

test('a cor da linha acompanha o uso', async () => {
  expect(linhaStatus(75)).toBe('🟡 ctx 75%')
  expect(linhaStatus(90)).toBe('🔴 ctx 90%')
})

test('avisa uma vez ao passar de 90% e rearma depois de compactar', async ($, on) => {
  const status: (string | undefined)[] = []
  const toasts: string[] = []

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: ctx(), rateLimits: [] } }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.status', (_, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  const medir = (percent: number) =>
    $.session.measure({ context: ctx(percent), rateLimits: [], changed: ['context'] })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(status.at(-1)).toBeUndefined()

  await medir(60) // abaixo de 75%: linha escondida
  expect(status.at(-1)).toBeUndefined()
  expect(toasts).toEqual([])

  await medir(80)
  expect(status.at(-1)).toBe('🟡 ctx 80%')
  expect(toasts).toEqual([])

  await medir(91)
  expect(status.at(-1)).toBe('🔴 ctx 91%')
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('91%')

  await medir(95) // continua acima: sem novo aviso
  expect(toasts).toHaveLength(1)

  await medir(20) // compactou: a linha some
  expect(status.at(-1)).toBeUndefined()
  await medir(92)
  expect(toasts).toHaveLength(2)
})
