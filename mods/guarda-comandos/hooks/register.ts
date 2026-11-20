import type { Register } from 'claude-code'

import { avaliarArquivo, avaliarBash, type Contexto, type Veredito } from './regras'

const FERRAMENTAS_DE_ARQUIVO = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

let ctx: Contexto = { cwd: '/', home: '' }

/** O veredito para uma chamada de ferramenta, a partir dos seus argumentos. */
export function avaliar(tool: string, input: unknown, c: Contexto): Veredito | undefined {
  const args = (input ?? {}) as { command?: unknown; file_path?: unknown; notebook_path?: unknown }
  if (tool === 'Bash' && typeof args.command === 'string') return avaliarBash(args.command, c)
  if (FERRAMENTAS_DE_ARQUIVO.has(tool)) {
    const caminho = args.file_path ?? args.notebook_path
    if (typeof caminho === 'string') return avaliarArquivo(caminho, c)
  }
  return undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const resultado = await next(e)
    ctx = { cwd: e.cwd, home: (await $.env.get('HOME')) ?? '' }
    return resultado
  })

  on('tool.check', async ($, e, next) => {
    const veredito = avaliar(e.tool, e.input, ctx)
    if (!veredito) return next(e)

    if (veredito.nivel === 'bloquear') {
      $.ui.toast(`🛡️ Bloqueado: ${veredito.motivo}`, { timeoutMs: 8000 })
      return { decision: 'deny', reason: `guarda-comandos bloqueou: ${veredito.motivo}. Não tente contornar; explique à pessoa o que queria fazer.` }
    }

    // Perguntar: só aperta o que o motor decidiu. Uma recusa de regra ou do modo continua recusa.
    const doMotor = await next(e)
    if (doMotor.decision === 'deny') return doMotor
    return { decision: 'ask', reason: `guarda-comandos: ${veredito.motivo}. Confirma?` }
  }).catch(() => ({ decision: 'ask', reason: 'guarda-comandos falhou ao avaliar este comando. Confirma?' }))
}
