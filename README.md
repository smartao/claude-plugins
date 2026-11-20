# claude-plugins

Marketplace local de mods para o Claude Code.

## Mods

| Mod | O que faz |
| --- | --- |
| [quota-semanal](mods/quota-semanal) | Mostra na status line se o uso da quota semanal (7 dias) está acima, abaixo ou dentro do ritmo médio, considerando consumo linear desde o último reset. Avisa com um toast quando passa para acima da média e quando volta. |

Exemplo da status line:

```
🟢 7d 95% · esp 97.8% · -2.8 pts · 4h
```

## Instalação

```bash
claude plugin marketplace add /home/sergei/Midias/Dev/Projetos/claude-plugins
claude plugin install quota-semanal@smartao-mods
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
