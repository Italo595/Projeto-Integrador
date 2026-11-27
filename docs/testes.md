# Testes

## Testes automatizados

Arquivo: `backend/tests/api.test.js` (corredor nativo do Node, sem dependências extras).

```bash
cd backend
npm test        # equivale a: node --test
```

A suíte cria uma pasta temporária e sobe um **servidor isolado** (porta HTTP aleatória entre 3900 e 3989, ponte TCP em `porta + 100`, banco, `JWT_SECRET`, `ENC_KEY`, backups e log temporários). **Não toca no seu banco real** e apaga tudo no final.

### Casos cobertos

| # | Teste | Verifica |
|---|---|---|
| 1 | Primeiro usuário é admin | `papel` = `admin` no 1º cadastro e `comum` nos seguintes |
| 2 | Sem token/token inválido | `401` |
| 3 | Senha curta e e-mail duplicado | `400` e `409` |
| 4 | Bloqueio por tentativas | 5 senhas erradas → `423` mesmo com a senha certa |
| 5 | Autorização | Comum recebe `403` em `/logs`, `/backups`, `/usuarios`, `/historico`; admin recebe `200` |
| 6 | Validação de comandos | `setpoint` 150 e `"abc"` → `400`; nome `kp` → `400`; `setpoint` 50 → `201` |
| 7 | Segurança do aquecedor | `ligado = 1` sem MATLAB → `409` |
| 8 | Histórico de comandos | Responde `200` e traz o valor descriptografado |
| 9 | Ponte TCP | "MATLAB falso" recebe `status=OFF&flag=0&setpoint=50`, depois `ON/flag=1` ao ligar; ignora lixo e temperatura fora de faixa; ao desconectar o controle volta a `ligado = 0` |
| 10 | Criptografia | Leitura devolvida em claro pela API, mas gravada no banco com prefixo `v1:` (inclusive a mensagem de log) |
| 11 | Backup e restauração | Só admin cria backup; restaurar exige confirmação (`400` sem ela); estado volta ao do backup |

### Não coberto pelos testes automatizados

- Interface (frontend) e gráficos.
- Script MATLAB e hardware.
- Atualização de papel/ativação em `/usuarios` e derrubada de sockets.
- Autenticação do Socket.IO e entrega dos eventos.
- Rotas `/historico` com filtros de data.

## Roteiro de testes manuais

### A. Sem MATLAB (modo local)

1. Cadastre-se e entre. Abra **Resposta (PID)**, modo `local`.
2. Defina setpoint 1 = 40 °C, temperatura inicial = 25 °C, Kp e Ki, e clique em **Simular**.
3. Esperado: curva de temperatura sobe ao setpoint, o kit desenhado fica LIGADO, o ar muda de cor, a perturbação aparece no instante configurado.
4. Abra **Séries Históricas**: média, variância, curtose, assimetria e outliers calculados.

### B. Com MATLAB de simulação

1. Rode `temperature_client_node.m`. Esperado: **MATLAB: Online** e log `matlab_conectado` em Status e Logs.
2. Modo `simulada`, setpoint 50, **Ligar**. Esperado: temperatura sobe até ≈ 50 °C; o terminal do MATLAB mostra `Status: ON`.
3. **Desligar**: temperatura volta ao ambiente.
4. `Ctrl+C` no MATLAB. Esperado: **Offline**, `ligado` volta a 0 e log `matlab_desconectado`.

### C. Com o kit (modo real)

1. Preencha `Kp`/`Ki` e rode `controle_kit_web.m` com o kit ligado.
2. Modo `real`, setpoint moderado (por exemplo, 40 °C), **Ligar**. Esperado: ventilador gira, aquecedor atua, temperatura estabiliza.
3. Teste de segurança: feche o servidor com o aquecedor ligado. Esperado: em ~2 s o MATLAB desliga aquecedor e ventilador.

### D. Permissões

1. Com um usuário `comum`: Status e Logs, Usuários e a restauração do banco devem ser negados.
2. Com o admin: promova o usuário comum em **Usuários**. Esperado: o outro usuário é deslogado do socket e, ao reconectar, vê as telas de admin.
3. Tente rebaixar a própria conta de admin. Esperado: recusado.

### E. Backup

1. Em **Status e Logs**, **Fazer backup agora**. Esperado: aparece na lista com tamanho e status `ok`.
2. Envie alguns setpoints, restaure o backup e confira que o histórico de comandos voltou ao estado anterior.
