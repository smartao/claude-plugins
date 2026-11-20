import type { EngineInterface, Register, SessionContextUsage } from 'claude-code'

/** A partir deste % do contexto o mod avisa para compactar. */
export const LIMITE = 90
/** A partir deste % a linha aparece (amarela); abaixo dele fica escondida. */
export const ATENCAO = 75

// Já avisou desde a última vez que o contexto ficou abaixo do limite?
let avisado = false

export function linhaStatus(percent: number): string {
  const icone = percent >= LIMITE ? '🔴' : percent >= ATENCAO ? '🟡' : '🟢'
  return `${icone} ctx ${percent}%`
}

function atualizar($: EngineInterface, contexto: SessionContextUsage): void {
  const percent = contexto.percent
  if (percent === undefined) {
    $.ui.status(undefined)
    return
  }

  // Abaixo de ATENCAO a linha some, para não ocupar espaço à toa.
  $.ui.status(percent >= ATENCAO ? linhaStatus(percent) : undefined)

  // Avisa uma vez ao passar do limite; rearma quando cai abaixo (após /compact ou /clear).
  if (percent >= LIMITE && !avisado) {
    $.ui.toast(`⚠️ Contexto em ${percent}%: considere rodar /compact`, { timeoutMs: 10000 })
    avisado = true
  } else if (percent < LIMITE) {
    avisado = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const resultado = await next(e)
    atualizar($, (await $.session.usage()).context)
    return resultado
  })

  on('session.measure', ($, e, next) => {
    if (e.changed.includes('context')) atualizar($, e.context)
    return next(e)
  })
}
