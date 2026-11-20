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
  /** "esperado há 4 horas" ou "esperado para 1 dia e 2 horas" */
  quando: string
}

const arred1 = (n: number) => Math.round(n * 10) / 10

/** Formata milissegundos como "1 dia e 12 horas", igual ao fmt_extenso do script. */
export function extenso(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 3600) return 'menos de 1 hora'

  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const partes: string[] = []

  if (d > 0) partes.push(`${d} dia${d > 1 ? 's' : ''}`)
  if (h > 0 || d === 0) partes.push(`${h} hora${h !== 1 ? 's' : ''}`)

  return partes.join(' e ')
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
  const quando = dif >= 0 ? `esperado para ${extenso(dif)}` : `esperado há ${extenso(-dif)}`

  return { usado, esperado, diferenca, situacao, quando }
}

const ICONE: Record<Situacao, string> = { acima: '🔴', abaixo: '🟢', dentro: '🟡' }

/** Linha compacta para a status line. */
export function linhaStatus(r: Ritmo): string {
  const situacao =
    r.situacao === 'dentro'
      ? 'dentro da média'
      : `${r.situacao.toUpperCase()} da média em ${Math.abs(r.diferenca).toFixed(1)} pts`

  return `${ICONE[r.situacao]} Quota 7d: ${r.usado}% · esperado ${r.esperado.toFixed(1)}% · ${situacao} (${r.quando})`
}
