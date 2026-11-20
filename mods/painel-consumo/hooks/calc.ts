import type { Tokens } from '../types'

export const HORA_MS = 3600 * 1000
/** Duração de cada janela de quota conhecida. */
export const JANELAS: Record<string, { rotulo: string; ms: number }> = {
  five_hour: { rotulo: '5h', ms: 5 * HORA_MS },
  seven_day: { rotulo: '7d', ms: 7 * 24 * HORA_MS },
}

/** Diferença (em pontos) abaixo da qual o uso conta como "dentro da média". */
export const TOLERANCIA = 0.5

export type Situacao = 'acima' | 'abaixo' | 'dentro'
export type Ritmo = { esperado: number; diferenca: number; situacao: Situacao }

const arred1 = (n: number) => Math.round(n * 10) / 10

/**
 * Compara o uso com o esperado num consumo linear da janela que termina em
 * `resetaEm` (o mesmo cálculo do mod quota-semanal, para qualquer janela).
 */
export function ritmo(usado: number, resetaEm: number, agora: number, janelaMs: number): Ritmo {
  const decorrido = Math.min(Math.max(agora - (resetaEm - janelaMs), 0), janelaMs)
  const esperado = arred1((decorrido / janelaMs) * 100)
  const diferenca = arred1(usado - esperado)
  const situacao: Situacao =
    diferenca > TOLERANCIA ? 'acima' : diferenca < -TOLERANCIA ? 'abaixo' : 'dentro'
  return { esperado, diferenca, situacao }
}

/** Barra de `largura` caracteres: `██████░░░░`. */
export function barra(percent: number, largura = 10): string {
  const cheio = Math.round((Math.min(Math.max(percent, 0), 100) / 100) * largura)
  return '█'.repeat(cheio) + '░'.repeat(largura - cheio)
}

/** Tokens em forma curta: 950, 12.3k, 2.1M. */
export function tokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${arred1(n / 1000)}k`
  return `${arred1(n / 1_000_000)}M`
}

/** Duração curta: 48s, 12min, 2h10, 1d4h. */
export function duracao(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const min = Math.floor(s / 60)
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h${String(min % 60).padStart(2, '0')}`
  const d = Math.floor(h / 24)
  return h % 24 === 0 ? `${d}d` : `${d}d${h % 24}h`
}

/** Quanto da entrada veio do cache, de 0 a 100; `undefined` sem entrada. */
export function taxaCache(t: Tokens): number | undefined {
  const entrada = t.entrada + t.cacheLido + t.cacheEscrito
  return entrada === 0 ? undefined : Math.round((t.cacheLido / entrada) * 100)
}

export function somar(a: Tokens, b: Tokens): Tokens {
  return {
    entrada: a.entrada + b.entrada,
    saida: a.saida + b.saida,
    cacheLido: a.cacheLido + b.cacheLido,
    cacheEscrito: a.cacheEscrito + b.cacheEscrito,
  }
}

export const ZERO: Tokens = { entrada: 0, saida: 0, cacheLido: 0, cacheEscrito: 0 }

/** Cor de um percentual de uso: verde, amarelo a partir de 75, vermelho a partir de 90. */
export function corUso(percent: number): 'green' | 'yellow' | 'red' {
  return percent >= 90 ? 'red' : percent >= 75 ? 'yellow' : 'green'
}

export const COR_RITMO: Record<Situacao, 'green' | 'yellow' | 'red'> = {
  abaixo: 'green',
  dentro: 'yellow',
  acima: 'red',
}
