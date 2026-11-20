# claude-plugins

Marketplace local de mods para o Claude Code.

## Mods

| Mod | O que faz |
| --- | --- |
| [quota-semanal](mods/quota-semanal) | Mostra na status line se o uso da quota semanal (7 dias) está acima, abaixo ou dentro do ritmo médio, considerando consumo linear desde o último reset. Avisa com um toast quando passa para acima da média e quando volta. |
| [contexto](mods/contexto) | Mostra o uso do contexto da conversa na status line só a partir de 75% (🟡 de 75% a 89%, 🔴 a partir de 90%) e avisa com um toast ao passar de 90%, para você rodar `/compact` na hora certa. |
| [conventional-commits](mods/conventional-commits) | Barra os `git commit -m` do Claude cuja mensagem não segue `<tipo>(<escopo>): <descrição>` (tipos `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `style`, `perf`, `build`, `ci`, `revert`) e exige o rodapé `BREAKING CHANGE:` quando há `!`. A recusa explica ao Claude o que corrigir. Commits sem mensagem na linha de comando (editor, `-F`, `--no-edit`) e os gerados pelo git (`Merge`, `fixup!`) passam direto. |
| [teste-mods](mods/teste-mods) | Quando um turno do Claude edita arquivos de um mod (qualquer pasta com `.claude-plugin/plugin.json`), roda `claude plugin validate` e `claude plugin test` nele ao fim do turno. O resultado aparece na status line (`🧪 ✅ contexto 2/2 testes`) e numa faixa acima do prompt no terminal e no app desktop. Falhas e erros de tipo geram um toast e ficam visíveis até a próxima rodada; o ✅ some depois de 1 minuto. |

Exemplo da status line:

```
🟢 7d 95% · esp 97.8% · -2.8 pts · 4h   (quota-semanal)
🟡 ctx 78%                              (contexto)
```

## Instalação

```bash
claude plugin marketplace add /home/sergei/Midias/Dev/Projetos/claude-plugins
claude plugin install quota-semanal@smartao-mods
claude plugin install contexto@smartao-mods
claude plugin install conventional-commits@smartao-mods
claude plugin install teste-mods@smartao-mods
```

Como o marketplace é uma pasta local, o Claude Code lê os mods direto daqui:
depois de editar um mod, rode `/reload-plugins` numa sessão aberta.

## Desenvolvimento

```bash
claude plugin validate mods/quota-semanal   # valida manifesto e hooks
claude plugin test mods/quota-semanal       # roda os testes
```

## Estrutura

```
.claude-plugin/marketplace.json   lista os mods do repositório
mods/<mod>/.claude-plugin/plugin.json
mods/<mod>/hooks/hooks.json       aponta para o módulo de hooks
mods/<mod>/hooks/*.ts             código do mod
mods/<mod>/tests/*.test.ts        testes (claude plugin test)
```
