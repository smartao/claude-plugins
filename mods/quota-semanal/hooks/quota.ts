// Cálculo do ritmo da quota semanal, portado de claude-quota.sh.
// Considera uso contínuo e linear ao longo da semana (100% / 7 dias).

export const SEMANA_MS = 7 * 24 * 3600 * 1000

/** Diferença (em pontos) abaixo da qual o uso conta como "dentro da média". */
export const TOLERANCIA = 0.5

export type Situacao = 'acima' | 'abaixo' | 'dentro'

export type Ritmo = {
  usado: number
  esperado: number
  /** usado - esperado, em pontos percentuais */
  diferenca: number
  situacao: Situacao
  /** Distância até o momento em que o uso real seria o esperado: "5h", "1d12h", "<1h". */
  tempo: string
}

const arred1 = (n: number) => Math.round(n * 10) / 10

/** Formata milissegundos de forma curta: "<1h", "5h", "1d", "1d12h". */
export function curto(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 3600) return '<1h'

  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)

  if (d === 0) return `${h}h`
  return h === 0 ? `${d}d` : `${d}d${h}h`
}

/**
 * Compara o uso real com o esperado para o momento `agora`, sendo a janela
 * de 7 dias a que termina em `resetaEm` (ambos em ms desde a época).
 */
export function calcularRitmo(usado: number, resetaEm: number, agora: number): Ritmo {
  const inicio = resetaEm - SEMANA_MS
  const decorrido = Math.min(Math.max(agora - inicio, 0), SEMANA_MS)
  const esperado = arred1((decorrido / SEMANA_MS) * 100)
  const diferenca = arred1(usado - esperado)

  const situacao: Situacao =
    diferenca > TOLERANCIA ? 'acima' : diferenca < -TOLERANCIA ? 'abaixo' : 'dentro'

  // momento em que o uso real seria o esperado: no futuro = adiantado, no passado = atrasado
  const dif = inicio + (usado / 100) * SEMANA_MS - agora
  const tempo = curto(Math.abs(dif))

  return { usado, esperado, diferenca, situacao, tempo }
}

const ICONE: Record<Situacao, string> = { acima: '🔴', abaixo: '🟢', dentro: '🟡' }

/** Diferença (em pontos, em módulo) a partir da qual a seta é dobrada: ▲▲ / ▼▼. */
export const LIMITE_DUPLA = 10

/** Diferença (em pontos, em módulo) a partir da qual a seta é tripla: ▲▲▲ / ▼▼▼. */
export const LIMITE_TRIPLA = 15

/** Direção e intensidade do desvio: "▲", "▲▲▲", "▼▼", ou "=" quando está na média. */
export function setas(r: Ritmo): string {
  if (r.situacao === 'dentro') return '='

  const desvio = Math.abs(r.diferenca)
  const qtd = desvio >= LIMITE_TRIPLA ? 3 : desvio >= LIMITE_DUPLA ? 2 : 1
  return (r.situacao === 'acima' ? '▲' : '▼').repeat(qtd)
}

/** Linha compacta para a status line: "🟢▼ 7d 95% · esp 98.1% · -3.1 pts · 5h". */
export function linhaStatus(r: Ritmo): string {
  const base = `${ICONE[r.situacao]}${setas(r)} 7d ${r.usado}% · esp ${r.esperado.toFixed(1)}%`
  if (r.situacao === 'dentro') return `${base} · na média`

  const sinal = r.diferenca > 0 ? '+' : '-'
  return `${base} · ${sinal}${Math.abs(r.diferenca).toFixed(1)} pts · ${r.tempo}`
}
