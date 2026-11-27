# Instalação e execução

## Requisitos

| Item | Versão | Observação |
|---|---|---|
| Node.js | **≥ 22.13** | Necessário para o módulo nativo `node:sqlite` (o projeto foi usado com Node 26) |
| npm | o que acompanha o Node | |
| MATLAB | com *Data Acquisition Toolbox* | Só para os modos `simulada` e `real` |
| Placa NI-USB-6003 + kit LTR701 | | Só para o modo `real` (`Dev1`: `ai0`, `ao0`, `ao1`) |
| Python 3 + `requests` | opcional | Só para `Simulação/usuario.py` |

## Variáveis de ambiente (`backend/.env`)

Use `env.example` como modelo. O arquivo `.env` está no `.gitignore`: **não o versione**.

| Variável | Obrigatória | Padrão | Descrição |
|---|:--:|---|---|
| `JWT_SECRET` | ✅ | — | Segredo de assinatura do JWT (mín. 16 caracteres; use um valor longo e aleatório) |
| `ENC_KEY` | ✅ | — | Chave AES-256: **64 caracteres hexadecimais** (32 bytes) |
| `PORT` | | `3000` | Porta HTTP/Socket.IO |
| `DEVICE_ID` | | `LTR701_01` | Identificador do kit no banco |
| `DB_PATH` | | `backend/banco/integrador.db` | Caminho do banco, relativo a `backend/` |
| `SCHEMA_PATH` | | `backend/banco/schema.sql` | Caminho do esquema, relativo a `backend/` |
| `TCP_HOST` | | `127.0.0.1` | Interface da ponte TCP (`0.0.0.0` se o MATLAB estiver em outro PC) |
| `TCP_PORT` | | `2000` | Porta da ponte TCP |
| `BACKUP_DIR` | | `backups` | Pasta dos backups, relativa a `backend/` |
| `BACKUP_RETENCAO` | | `14` | Quantos backups **periódicos** manter |
| `BACKUP_CRON` | | `0 3 * * *` | Agenda do backup (formato cron; padrão: todo dia às 03:00) |
| `LOG_PATH` | | `logs/sistema.log` | Arquivo de log, relativo a `backend/` |

> Neste repositório o banco fica em `Banco de Dados/` (fora de `backend/`). Por isso o `.env` usa `DB_PATH=../Banco de Dados/integrador.db` e `SCHEMA_PATH=../Banco de Dados/schema.sql`.

### Gerando os segredos

```bash
# JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# ENC_KEY (64 hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Rode duas vezes e cole um valor em cada variável. **Faça cópia da `ENC_KEY`** em local seguro.

## Passo a passo

1. **Instalar dependências**
   ```bash
   cd backend
   npm install
   ```
2. **Criar o `.env`** a partir de `env.example` (veja acima).
3. **Iniciar**
   ```bash
   npm start
   ```
   Saída esperada (resumida):
   ```text
   [db] Tabelas criadas a partir de ...schema.sql      # só na 1ª vez
   [db] Dispositivo LTR701_01 cadastrado               # só na 1ª vez
   Ponte TCP (MATLAB) em 127.0.0.1:2000
   Backup automático agendado (0 3 * * *), pasta: ...
   Servidor em http://localhost:3000
   ```
4. **Criar a conta de administrador:** acesse `http://localhost:3000` → *Cadastro*. O primeiro cadastro é admin.
5. **Usar o dashboard** em modo `local` (não precisa de MATLAB) ou conectar o MATLAB (abaixo).

### Conectando o MATLAB

1. Abra `MATLAB/controle_kit_web.m` (modo real) ou `temperature_client_node.m` (simulação).
2. No modo real, preencha `Kp` e `Ki`; confira `SERVER_IP` e `SERVER_PORT`.
3. Execute. No terminal do servidor deve aparecer `MATLAB conectado de ...` e, no dashboard, **MATLAB: Online**.
4. Escolha o modo (`simulada` ou `real`), defina o setpoint e clique em **Ligar**.

Para parar: `Ctrl+C` no MATLAB. O aquecedor e o ventilador são desligados automaticamente.

### Cliente Python (opcional)

```bash
cd Simulação
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install requests
python usuario.py
```

Pede e-mail e senha de uma conta existente e permite enviar `setpoint` (°C) e `ligado` (0/1) pela API.

## Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `Defina JWT_SECRET (mín. 16 caracteres)` | `.env` ausente ou vazio | Criar `backend/.env` |
| `ENC_KEY deve ter 64 caracteres hexadecimais` | Chave com tamanho/caracteres errados | Gerar de novo com o comando acima |
| `porta 2000 já está em uso` | Outro servidor/script ocupa a porta (por exemplo, uma ponte antiga em Python) | Fechar o outro processo ou mudar `TCP_PORT` (e no `.m`) |
| `EADDRINUSE` na porta 3000 | Outra instância do servidor aberta | Encerrar a anterior ou mudar `PORT` |
| `node:sqlite` não encontrado | Node antigo | Atualizar para Node ≥ 22.13 |
| Dashboard mostra **MATLAB: Offline** | Script não conectou | Conferir IP/porta, `TCP_HOST` e firewall |
| `409 MATLAB não está conectado` ao ligar | Segurança do servidor | Iniciar o script MATLAB antes de clicar em Ligar |
| Ligou e desligou sozinho | O MATLAB reconectou (cada conexão zera `ligado`) ou ficou 10 s mudo | Verificar a rede e o laço do MATLAB; ligar de novo |
| MATLAB: "Preencha Kp e Ki" | Ganhos ainda `NaN` | Preencher no início de `controle_kit_web.m` |
| `403`/`401` ao abrir Status e Logs | Conta não é admin / sessão expirada | Promover pela página Usuários (por outro admin) ou entrar de novo |
| Dados antigos ilegíveis após trocar a `ENC_KEY` | A chave mudou | Restaurar a `ENC_KEY` original; **não há como decifrar sem ela** |
| Restauração recusada (409) | MATLAB conectado | Encerrar o script e tentar de novo |
| Gráficos não aparecem | Sem internet (Chart.js via CDN) | Conectar à internet ou hospedar o Chart.js localmente |
| `FOREIGN KEY constraint failed` ao restaurar (visto no log do projeto) | Backup com referências a usuários/dispositivos inexistentes no banco atual | Atualizar para a versão de `backup.js` que filtra por dispositivo e zera `usuario_id` órfão (a versão atual já faz isso) |

## Manutenção

- **Atualizar dependências:** `npm update` e rodar `npm test`.
- **Logs:** `backend/logs/sistema.log` cresce sem rotação; arquive ou apague de tempos em tempos com o servidor parado.
- **Reiniciar do zero (apaga tudo):** pare o servidor e apague `Banco de Dados/integrador.db*`. O esquema é recriado na próxima inicialização e o primeiro cadastro volta a ser admin.
