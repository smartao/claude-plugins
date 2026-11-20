import type { EngineInterface, Register, SessionRateLimit, Timer } from 'claude-code'

import { calcularRitmo, linhaStatus, type Situacao } from './quota'

/** O uso esperado anda com o relógio, então a linha é recalculada a cada 5 min. */
const INTERVALO_MS = 5 * 60 * 1000

// Estado da sessão (recomeça a cada recarga do mod, o que é aceitável aqui).
let leitura: SessionRateLimit | undefined
let ultimaSituacao: Situacao | undefined
let relogio: Timer | undefined

function lerJanela(limites: SessionRateLimit[]): SessionRateLimit | undefined {
  return limites.find(l => l.kind === 'seven_day')
}

async function atualizar($: EngineInterface): Promise<void> {
  if (leitura === undefined || leitura.resetsAt === undefined) {
    $.ui.status('⏳ Quota 7d: aguardando a primeira resposta do Claude')
    return
  }

  const resetaEm = Date.parse(leitura.resetsAt)
  if (Number.isNaN(resetaEm)) {
    $.ui.status(`Quota 7d: ${leitura.percentUsed}% (sem horário de reset)`)
    return
  }

  const ritmo = calcularRitmo(leitura.percentUsed, resetaEm, await $.clock.now())
  $.ui.status(linhaStatus(ritmo))

  // Avisa só na virada para ACIMA da média e na volta, nunca na primeira leitura.
  const estavaAcima = ultimaSituacao === 'acima'
  const estaAcima = ritmo.situacao === 'acima'
  if (ultimaSituacao !== undefined && estavaAcima !== estaAcima) {
    $.ui.toast(
      estaAcima
        ? `🔴 Quota semanal ACIMA da média: ${ritmo.usado}% usado, esperado ${ritmo.esperado.toFixed(1)}%`
        : `🟢 Quota semanal voltou para ${ritmo.situacao === 'abaixo' ? 'abaixo' : 'dentro'} da média`,
      { timeoutMs: 8000 },
    )
  }
  ultimaSituacao = ritmo.situacao
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const resultado = await next(e)

    leitura = lerJanela((await $.session.usage()).rateLimits)
    await atualizar($)

    relogio?.cancel()
    relogio = $.clock.every(INTERVALO_MS, () => void atualizar($))

    return resultado
  })

  // Chega após cada turno e quando a janela anda um ponto inteiro.
  on('session.measure', async ($, e, next) => {
    const nova = lerJanela(e.rateLimits)
    if (nova !== undefined) {
      leitura = nova
      await atualizar($)
    }

    return next(e)
  })
}
