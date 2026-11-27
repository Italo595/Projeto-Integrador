# Referência da API

- **Base URL:** `http://localhost:3000/api`
- **Formato:** JSON (`Content-Type: application/json`), limite de corpo de 100 kB.
- **Autenticação:** cabeçalho `Authorization: Bearer <token>` (token obtido em `/auth/login`, válido por 8 h).
- **Erros:** sempre `{ "erro": "mensagem" }` com o código HTTP adequado.
- Rotas `/api/*` inexistentes respondem `404 { "erro": "Rota não encontrada." }`.

## Resumo

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| POST | `/auth/register` | público | Cadastra usuário (o primeiro vira admin) |
| POST | `/auth/login` | público | Autentica e devolve o JWT |
| GET | `/auth/me` | logado | Dados do usuário do token |
| POST | `/auth/logout` | logado | Registra a saída em log |
| POST | `/commands/add` | logado | Envia `setpoint` ou `ligado` ao MATLAB |
| GET | `/commands/history` | logado | Últimos 50 comandos |
| GET | `/config` | logado | Configuração atual do controle |
| GET | `/readings` | logado | Últimas leituras de temperatura |
| GET | `/historico` | **admin** | Leituras por intervalo de datas |
| GET | `/status` | logado | Estado do servidor e da conexão com o MATLAB |
| GET | `/logs` | **admin** | Últimos logs |
| GET | `/usuarios` | **admin** | Lista usuários |
| PATCH | `/usuarios/:id` | **admin** | Altera papel, ativação ou desbloqueia |
| GET | `/backups` | **admin** | Lista backups |
| POST | `/backups` | **admin** | Cria backup manual |
| POST | `/backups/:id/restaurar` | **admin** | Restaura leituras, comandos e experimentos |

O parâmetro opcional `device_id` (query ou corpo, conforme a rota) escolhe o dispositivo; sem ele, vale o primeiro dispositivo ativo (`LTR701_01` por padrão).

---

## Autenticação

### `POST /auth/register`

```json
{ "nome": "Maria Silva", "email": "maria@exemplo.com", "senha": "minimo8caracteres" }
```

| Regra | Valor |
|---|---|
| Nome | 2 a 100 caracteres |
| E-mail | formato válido, até 150 caracteres, salvo em minúsculas |
| Senha | 8 a 72 caracteres |

Respostas: `201 { "ok": true, "papel": "admin" | "comum" }`, `400` (validação), `409` (e-mail já cadastrado).

### `POST /auth/login`

```json
{ "email": "maria@exemplo.com", "senha": "..." }
```

Resposta `200`:

```json
{
  "token": "eyJhbGciOi...",
  "usuario": { "id": 1, "nome": "Maria Silva", "email": "maria@exemplo.com", "papel": "admin" }
}
```

| Código | Situação |
|---|---|
| 401 | E-mail ou senha inválidos (mesma mensagem para os dois casos) |
| 423 | Conta bloqueada por 15 min após 5 senhas erradas seguidas |

### `GET /auth/me` · `POST /auth/logout`

`me` devolve `{ id, nome, email, papel }`. `logout` devolve `{ ok: true }`; o token **não é invalidado no servidor** (o frontend apenas o descarta), só o log é registrado.

---

## Comandos

### `POST /commands/add`

Qualquer usuário logado pode comandar o sistema físico.

```json
{ "name": "setpoint", "value": 50 }
```

| `name` | Faixa de `value` | Observação |
|---|---|---|
| `setpoint` | 0 a 99 (°C) | número finito |
| `ligado` | 0 ou 1 | inteiro |

Respostas:

| Código | Corpo | Quando |
|---|---|---|
| 201 | `{ "ok": true, "id": 12, "entregue": true }` | Gravado. `entregue = false` se não havia MATLAB conectado |
| 400 | `{ "erro": "..." }` | Nome inválido ou valor fora da faixa |
| 404 | `{ "erro": "Dispositivo não encontrado." }` | `device_id` desconhecido |
| 409 | `{ "erro": "MATLAB não está conectado..." }` | Tentou `ligado = 1` sem MATLAB |

Efeitos: grava em `comandos` (com `valor_anterior`), atualiza `config_controle`, escreve a nova configuração no socket TCP, gera log `comando` e emite os eventos `command` e `command:ack`.

### `GET /commands/history`

Até 50 comandos, do mais novo para o mais antigo:

```json
[
  { "id": 12, "nome": "setpoint", "valor": "50", "valor_anterior": "40",
    "status": "confirmado", "criado_em": "2026-11-26T17:28:54.912Z",
    "confirmado_em": "2026-11-26T17:28:54.915Z", "usuario": "Maria Silva" }
]
```

`status` ∈ `pendente | enviado | confirmado | falhou`.

### `GET /config`

```json
{ "dispositivo_id": 1, "setpoint": 50, "ligado": 1, "kp": 1.2, "ki": 0.05, "kd": 0,
  "sat_min": 0, "sat_max": 255, "atualizado_por": 1, "atualizado_em": "..." }
```

> `kp`, `ki`, `kd`, `sat_min`, `sat_max` são valores padrão do esquema e **não são transmitidos ao MATLAB**.

---

## Leituras

### `GET /readings?limit=500`

Últimas `limit` leituras (1 a 5000, padrão 500) em ordem cronológica, já descriptografadas:

```json
[ { "ts": "2026-11-26T17:29:12.115Z", "temperatura": 42.35, "setpoint": 50, "pwm": null, "variaveis": {} } ]
```

### `GET /historico?de=...&ate=...&limit=5000` (admin)

| Parâmetro | Descrição |
|---|---|
| `de`, `ate` | Datas ISO 8601 (opcionais). `de` deve ser anterior a `ate` |
| `limit` | 1 a 20000 (padrão 5000); devolve os pontos **mais recentes** do intervalo |

```json
{ "device_id": "LTR701_01", "total": 128, "retornados": 128,
  "pontos": [ { "ts": "...", "temperatura": 42.35, "setpoint": 50, "pwm": null } ] }
```

Gera o log `restauracao_serie`.

---

## Sistema

### `GET /status`

```json
{ "servidor": "online",
  "matlab": { "online": true, "ip": "::ffff:127.0.0.1", "ha_segundos_leitura": 1 } }
```

`online` reflete o **estado real do socket TCP**, não um carimbo de tempo.

### `GET /logs?limit=100` (admin)

Até 500 registros, ordem cronológica, mensagem descriptografada:

```json
[ { "criado_em": "...", "nivel": "INFO", "acao": "login", "mensagem": "maria@exemplo.com entrou" } ]
```

---

## Usuários (admin)

### `GET /usuarios`

Lista `id, nome, email, papel, ativo, ultimo_login, criado_em, bloqueado_ate`.

### `PATCH /usuarios/:id`

Todos os campos são opcionais:

```json
{ "papel": "admin", "ativo": true, "desbloquear": true }
```

- Um admin **não pode rebaixar nem desativar a própria conta** (400).
- Mudar `papel` ou `ativo` derruba os sockets abertos do usuário; ao reconectar vale o papel novo.
- Gera o log `usuario_alterado`.

---

## Backups (admin)

| Rota | Resposta |
|---|---|
| `GET /backups` | até 100 backups: `id, arquivo, tamanho_bytes, sha256, tipo, status, erro, criado_em, restaurado_em, criado_por` |
| `POST /backups` | `201 { id, arquivo, tamanho_bytes, sha256 }` |
| `POST /backups/:id/restaurar` | corpo **obrigatório** `{ "confirmar": true }`; `200 { ok: true }` |

Erros da restauração: `400` sem confirmação, `404` backup/arquivo inexistente, `409` MATLAB conectado, `422` SHA-256 ou integridade inválidos. Veja [`backup-e-restauracao.md`](backup-e-restauracao.md).

---

## Eventos Socket.IO

Conexão: `io({ auth: { token: "<JWT>" } })`. Sem token válido a conexão é recusada (`Não autorizado`).

| Evento | Sala | Carga (`payload`) |
|---|---|---|
| `reading` | `device:<id>` | `{ device_id, ts, temperatura, setpoint, pwm: null, variaveis: {} }` (≤ 1/s) |
| `config` | `device:<id>` | configuração atual + `motivo` (`matlab_conectado` ou `matlab_desconectado`) |
| `command` | `device:<id>` | `{ id, nome, valor, valor_anterior, status, usuario }` |
| `command:ack` | `device:<id>` | `{ ids: [id] }` |
| `log` | `admins` | `{ criado_em, nivel, acao, mensagem }` |

## Exemplo rápido com `curl`

```bash
# login
TOKEN=$(curl -s localhost:3000/api/auth/login -H 'content-type: application/json' \
        -d '{"email":"maria@exemplo.com","senha":"minimo8caracteres"}' | jq -r .token)

# enviar setpoint
curl -s localhost:3000/api/commands/add -H "authorization: Bearer $TOKEN" \
     -H 'content-type: application/json' -d '{"name":"setpoint","value":50}'

# estado da conexão
curl -s localhost:3000/api/status -H "authorization: Bearer $TOKEN"
```

O script `Simulação/usuario.py` faz o mesmo de forma interativa (login e envio de comandos).
