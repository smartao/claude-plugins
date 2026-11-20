import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  SessionContextUsage,
  SessionCost,
  SessionRateLimit,
  Timer,
} from 'claude-code'

import type { Leitura, Limite, Tokens, Turno } from '../types'
import {
  COR_RITMO,
  JANELAS,
  ZERO,
  barra,
  corUso,
  duracao,
  ritmo,
  somar,
  taxaCache,
  tokens,
} from './calc'

const PAINEL = 'painel-consumo'
const COMANDO = 'consumo'
const TITULO = 'Consumo'
/** Quantos turnos a lista guarda. */
const MAX_TURNOS = 50
/** O ritmo esperado e a duração da sessão andam com o relógio. */
const TIQUE_MS = 60_000

// Mude o `shape` quando os campos mudarem: ele descarta o que uma versão antiga guardou.
const leitura = atom({ plugin: 'painel-consumo', key: 'leitura' } as const, null, { shape: 'leitura-1' })
const turnos = atom({ plugin: 'painel-consumo', key: 'turnos' } as const, [], { shape: 'turnos-1' })
const total = atom({ plugin: 'painel-consumo', key: 'total' } as const, { ...ZERO, turnos: 0 }, {
  shape: 'total-1',
})
const agora = atom({ plugin: 'painel-consumo', key: 'agora' } as const, 0)

let relogio: Timer | undefined

export function lerUso(
  limites: readonly SessionRateLimit[],
  contexto: SessionContextUsage,
  custo: SessionCost | undefined,
  inicio: number,
): Leitura {
  return {
    limites: limites
      .filter(l => l.kind in JANELAS)
      .map(l => ({ tipo: l.kind, usado: l.percentUsed, resetaEm: l.resetsAt })),
    contexto: { percent: contexto.percent, tokens: contexto.tokens, janela: contexto.window },
    custo: custo && { usd: custo.usd, precoDesconhecido: 'hasUnknownPrice' in custo && custo.hasUnknownPrice === true },
    inicio,
  }
}

async function abrir($: EngineInterface) {
  return $.ui.open({ id: PAINEL, title: TITULO })
}

/** Uma janela de quota: a barra e, abaixo, o ritmo e quando reseta. */
function linhasLimite(l: Limite, instante: number) {
  const janela = JANELAS[l.tipo]
  const reset = l.resetaEm === undefined ? NaN : Date.parse(l.resetaEm)
  if (!janela) return null
  if (Number.isNaN(reset)) return { principal: l, ritmo: undefined, falta: undefined, janela }
  return { principal: l, ritmo: ritmo(l.usado, reset, instante, janela.ms), falta: reset - instante, janela }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const resultado = await next(e)
    await $.command.register({ name: COMANDO, description: 'Abre o painel de consumo da sessão' })

    const uso = await $.session.usage()
    await update($, leitura, () => lerUso(uso.rateLimits, uso.context, uso.cost, uso.startedAt))
    const marcar = async () => {
      const t = await $.clock.now()
      await update($, agora, () => t)
    }
    await marcar()
    relogio?.cancel()
    relogio = $.clock.every(TIQUE_MS, () => void marcar())

    void abrir($)
    return resultado
  })

  on('command.run', { command: COMANDO }, async $ => {
    const aberto = await abrir($)
    return { text: aberto.isPlaced ? 'Painel de consumo aberto.' : `Painel não abriu: ${aberto.reason}` }
  })

  on('session.measure', async ($, e, next) => {
    await update($, leitura, atual =>
      lerUso(e.rateLimits, e.context, e.cost, atual?.inicio ?? 0),
    )
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u) {
      const t: Tokens = {
        entrada: u.input_tokens,
        saida: u.output_tokens,
        cacheLido: u.cache_read_input_tokens,
        cacheEscrito: u.cache_creation_input_tokens,
      }
      const soma = await update($, total, s => ({ ...somar(s, t), turnos: s.turnos + 1 }))
      const turno: Turno = {
        ...t,
        n: soma.turnos,
        duracaoMs: e.durationMs,
        modelo: u.model,
        agente: e.agentId !== undefined,
      }
      await update($, turnos, lista => [...lista, turno].slice(-MAX_TURNOS))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const l = await read($, leitura)
    const lista = await read($, turnos)
    const soma = await read($, total)
    const instante = await read($, agora)

    const limites = (l?.limites ?? [])
      .map(x => linhasLimite(x, instante))
      .filter(x => x !== null)
      .sort((a, b) => a.janela.ms - b.janela.ms)
    const ctx = l?.contexto
    const custo = l?.custo
    const taxa = taxaCache(soma)

    // Forma pequena (widget do app desktop): só o essencial numa linha.
    if (e.props.placement === 'widget') {
      const partes = [
        ...limites.map(x => `${x.janela.rotulo} ${x.principal.usado}%`),
        ctx?.percent !== undefined ? `ctx ${ctx.percent}%` : undefined,
        custo ? `~US$ ${custo.usd.toFixed(2)}` : undefined,
      ].filter(Boolean)
      return <Text>{partes.join(' · ') || 'Aguardando a 1ª resposta'}</Text>
    }

    const alturaFixa = 16
    const cabem = Math.max(0, (e.viewport?.rows ?? 30) - alturaFixa)
    const recentes = lista.slice(-cabem).reverse()

    return (
      <Box flexDirection="column">
        <Text bold>Quota</Text>
        {limites.length === 0 && <Text dimColor>Aguardando a 1ª resposta da API</Text>}
        {limites.map(x => (
          <Box flexDirection="column">
            <Text color={corUso(x.principal.usado)}>
              {x.janela.rotulo.padEnd(3)} {barra(x.principal.usado)} {x.principal.usado}%
            </Text>
            {x.ritmo && (
              <Text color={COR_RITMO[x.ritmo.situacao]} dimColor={x.ritmo.situacao !== 'acima'}>
                {'    '}esp {x.ritmo.esperado.toFixed(1)}% ·{' '}
                {x.ritmo.situacao === 'dentro'
                  ? 'na média'
                  : `${x.ritmo.diferenca > 0 ? '+' : ''}${x.ritmo.diferenca.toFixed(1)} pts`}
                {x.falta !== undefined && x.falta > 0 ? ` · reset em ${duracao(x.falta)}` : ''}
              </Text>
            )}
          </Box>
        ))}

        <Text> </Text>
        <Text bold>Contexto</Text>
        {ctx?.percent === undefined ? (
          <Text dimColor>Sem medição ainda</Text>
        ) : (
          <Box flexDirection="column">
            <Text color={corUso(ctx.percent)}>
              ctx {barra(ctx.percent)} {ctx.percent}%
            </Text>
            <Text dimColor>
              {'    '}
              {ctx.tokens !== undefined ? `${tokens(ctx.tokens)} / ` : ''}
              {tokens(ctx.janela)} tokens
            </Text>
          </Box>
        )}

        <Text> </Text>
        <Text bold>Sessão</Text>
        <Text>
          {custo ? `~US$ ${custo.usd.toFixed(2)}` : 'custo —'}
          <Text dimColor> (estimativa{custo?.precoDesconhecido ? ', há modelo sem preço' : ''})</Text>
        </Text>
        <Text dimColor>
          {soma.turnos} {soma.turnos === 1 ? 'turno' : 'turnos'}
          {l && l.inicio > 0 && instante > l.inicio ? ` · ${duracao(instante - l.inicio)}` : ''}
        </Text>
        <Text>
          entrada {tokens(soma.entrada)} · saída {tokens(soma.saida)}
        </Text>
        <Text>
          cache lido {tokens(soma.cacheLido)} · escrito {tokens(soma.cacheEscrito)}
        </Text>
        {taxa !== undefined && (
          <Text color={taxa >= 80 ? 'green' : taxa >= 50 ? 'yellow' : 'red'}>
            {taxa}% da entrada veio do cache
          </Text>
        )}

        {recentes.length > 0 && <Text> </Text>}
        {recentes.length > 0 && <Text bold>Últimos turnos</Text>}
        {recentes.map(t => (
          <Text dimColor={t.agente}>
            #{String(t.n).padEnd(3)} saída {tokens(t.saida).padEnd(6)} cache{' '}
            {String(taxaCache(t) ?? 0).padStart(3)}% · {duracao(t.duracaoMs)}
            {t.agente ? ' · agente' : ''}
          </Text>
        ))}
      </Box>
    )
  })
}
