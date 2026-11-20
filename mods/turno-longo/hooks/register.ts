import type { Register } from 'claude-code'

import { aviso } from './aviso'

const SOM = '/usr/share/sounds/freedesktop/stereo/complete.oga'

export const register: Register = (on, options) => {
  const limiteMs = Number(options.limiteSegundos ?? 120) * 1000
  const comSom = options.som !== false

  on('turn.complete', async ($, e, next) => {
    const resultado = await next(e)
    // Só a conversa principal: subagentes terminam dentro de um turno que ainda corre.
    if (e.agentId !== undefined) return resultado

    const a = aviso(e.durationMs, e.reason, resultado.text ?? e.answer, limiteMs)
    if (!a) return resultado

    $.ui.toast(`⏱️ ${a.titulo}`, { timeoutMs: 8000 })

    // O canal do Claude Code (terminal) primeiro; sem ele (VSCode, desktop), o do sistema.
    const enviado = await $.ui.notify(a.texto, { title: a.titulo, key: 'turno-longo' }).catch(() => undefined)
    if (!enviado?.isSent) {
      await $.process
        .run(['notify-send', '--app-name=Claude Code', '--icon=dialog-information', a.titulo, a.texto])
        .catch(() => undefined)
    }
    if (comSom) await $.process.run(['paplay', SOM]).catch(() => undefined)

    return resultado
  })
}
