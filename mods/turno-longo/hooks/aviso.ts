/** Duração por extenso curto: 45s, 3min12s, 1h05. */
export function duracao(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const min = Math.floor(s / 60)
  if (min < 60) return s % 60 === 0 ? `${min}min` : `${min}min${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
}

/** A primeira linha com texto da resposta, cortada para caber numa notificação. */
export function resumo(resposta: string, max = 100): string {
  const linha =
    resposta
      .split('\n')
      .map(l => l.replace(/^[#>*\-\s]+/, '').replace(/[*_`]/g, '').trim())
      .find(l => l !== '') ?? ''
  return linha.length > max ? `${linha.slice(0, max - 1)}…` : linha
}

export type Motivo = 'answer' | 'aborted' | 'refusal' | 'error'

/** Título e corpo da notificação; `undefined` quando não há o que avisar. */
export function aviso(
  duracaoMs: number,
  motivo: Motivo,
  resposta: string,
  limiteMs: number,
): { titulo: string; texto: string } | undefined {
  // Interrompido: a pessoa está olhando, não precisa de aviso.
  if (motivo === 'aborted' || duracaoMs < limiteMs) return undefined
  const titulo =
    motivo === 'answer'
      ? `Claude terminou (${duracao(duracaoMs)})`
      : `Claude parou com ${motivo === 'error' ? 'erro' : 'recusa'} (${duracao(duracaoMs)})`
  return { titulo, texto: resumo(resposta) || 'Turno concluído.' }
}
