import { expect, test } from 'claude-code/testing'

import { mensagensDeCommit, problema, validarComando } from '../hooks/commit'

test('aceita assuntos no padrão', async () => {
  expect(problema('feat: adiciona mod')).toBeUndefined()
  expect(problema('fix(quota-semanal): corrige arredondamento')).toBeUndefined()
  expect(problema('chore!: remove opção\n\nBREAKING CHANGE: a opção x some')).toBeUndefined()
  expect(problema('feat(api)!: muda formato\n\nBREAKING-CHANGE: formato novo')).toBeUndefined()
  expect(problema('Merge branch "x"')).toBeUndefined()
  expect(problema('fixup! feat: algo')).toBeUndefined()
})

test('recusa assuntos fora do padrão', async () => {
  expect(problema('Adiciona marketplace local')).toContain('não segue')
  expect(problema('feature: algo')).toContain('não segue')
  expect(problema('feat:sem espaço')).toContain('não segue')
  expect(problema('feat(): escopo vazio')).toContain('não segue')
  expect(problema('Feat: maiúscula')).toContain('não segue')
  expect(problema('feat!: quebra algo')).toContain('BREAKING CHANGE')
})

test('extrai a mensagem das formas comuns de git commit', async () => {
  expect(mensagensDeCommit('git commit -m "feat: a"')).toEqual(['feat: a'])
  expect(mensagensDeCommit("git commit -m 'fix: b' -m 'corpo'")).toEqual(['fix: b\n\ncorpo'])
  expect(mensagensDeCommit('git commit -am "docs: c"')).toEqual(['docs: c'])
  expect(mensagensDeCommit('git commit -m"test: d"')).toEqual(['test: d'])
  expect(mensagensDeCommit('git commit --message="ci: e"')).toEqual(['ci: e'])
  expect(mensagensDeCommit('git -C mods/x commit -m "perf: f"')).toEqual(['perf: f'])
  expect(mensagensDeCommit('rtk git commit -m "build: g"')).toEqual(['build: g'])
  expect(mensagensDeCommit('git add . && git commit -m "style: h" && git push')).toEqual(['style: h'])
  expect(mensagensDeCommit('git commit -m "fix: aspas \\"internas\\""')).toEqual(['fix: aspas "internas"'])
})

test('extrai a mensagem de um heredoc', async () => {
  const comando = [
    'git add -A && git commit -m "$(cat <<\'EOF\'',
    'feat(contexto): adiciona aviso "uso alto"',
    '',
    'Co-Authored-By: Claude <noreply@anthropic.com>',
    'EOF',
    ')"',
  ].join('\n')
  expect(mensagensDeCommit(comando)).toEqual([
    'feat(contexto): adiciona aviso "uso alto"\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
  ])
  expect(validarComando(comando)).toBeUndefined()
})

test('não confere o que não traz mensagem na linha de comando', async () => {
  expect(mensagensDeCommit('git commit')).toEqual([undefined])
  expect(mensagensDeCommit('git commit --amend --no-edit')).toEqual([undefined])
  expect(mensagensDeCommit('git commit -F msg.txt')).toEqual([undefined])
  expect(mensagensDeCommit('git log --oneline')).toEqual([])
  expect(validarComando('echo "git commit -m errado"')).toBeUndefined()
  expect(validarComando('ls -la')).toBeUndefined()
})

test('nega o Bash com commit fora do padrão e deixa passar o resto', async ($, on) => {
  const executados: string[] = []
  on('tool.call', (_, e) => {
    if (e.tool === 'Bash') executados.push(e.command)
    return { result: {} } as never
  })

  const ruim = await $.tool.call({ tool: 'Bash', command: 'git commit -m "Atualiza README"' })
  const recusa = ruim.deny ?? (ruim.isError ? ruim.text : undefined)
  expect(recusa).toContain('Commit recusado')
  expect(recusa).toContain('Atualiza README')

  await $.tool.call({ tool: 'Bash', command: 'git commit -m "docs: atualiza README"' })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(executados).toEqual(['git commit -m "docs: atualiza README"', 'git status'])
})
