import type { Register } from 'claude-code'

import { validarComando } from './commit'

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const motivo = validarComando(e.command)
    return motivo ? { deny: `${$.plugin.name}: ${motivo}` } : next(e)
  })
  // Se a análise falhar, deixa o comando seguir: melhor um commit fora do
  // padrão do que travar o Bash inteiro.
}
