# Backup e restauração

Implementado em `backend/src/backup.js`, exposto por `/api/backups` (somente admin) e pela página **Status e Logs**.

## Backup

| Tipo | Quando | Retenção |
|---|---|---|
| `periodico` | Todo dia às 03:00 (`BACKUP_CRON`) e, na inicialização, se o último periódico tem mais de 24 h | Mantém os **14** mais recentes (`BACKUP_RETENCAO`) |
| `manual` | Botão **Fazer backup agora** (`POST /api/backups`) | Não é apagado automaticamente |
| `pre_restauracao` (arquivo manual) | Criado antes de toda restauração | Não é apagado automaticamente |

- Técnica: `VACUUM INTO '<arquivo>'` gera uma cópia **consistente** do banco em uso, sem parar o servidor.
- Nome: `<prefixo>_<data ISO>.db` na pasta `BACKUP_DIR` (padrão `backend/backups/`).
- Cada backup é registrado em `backups` com tamanho e **SHA-256**; falhas ficam registradas com `status = erro`.
- O arquivo contém os dados **já cifrados**; só é legível com a mesma `ENC_KEY`.
- Se o computador ficou desligado às 03:00, o backup é feito ao iniciar o servidor.

## O que a restauração altera

Só os **dados de medição**:

| Restaurado | Preservado (não muda) |
|---|---|
| `leituras`, `comandos`, `experimentos` | `usuarios`, `refresh_tokens`, `dispositivos`, `config_controle`, `logs`, `backups` |

Assim, uma restauração não desfaz cadastros, mudanças de papel, a auditoria nem a configuração atual do controle.

## Procedimento de restauração

1. **Desconecte o MATLAB** (a API recusa com 409 se estiver conectado).
2. Em **Status e Logs**, clique em **Restaurar** no backup desejado e confirme (o corpo da requisição precisa de `{ "confirmar": true }`).
3. O servidor, em ordem:
   1. confere se o backup existe e se o **SHA-256** bate com o registrado (senão, 422);
   2. cria um backup `pre_restauracao_*` do estado atual (rede de segurança);
   3. anexa o backup e roda `PRAGMA integrity_check` (senão, 422);
   4. em **uma transação**, apaga e reinsere `leituras`, `comandos` e `experimentos`, ignorando linhas de dispositivos que não existem mais e zerando `usuario_id` de usuários inexistentes;
   5. grava `restaurado_em/por` e o log `restauracao` (WARN).
4. Em caso de erro no meio, a transação sofre `ROLLBACK` e os dados atuais permanecem.
5. Para **desfazer** uma restauração, restaure o backup `pre_restauracao_*` criado no passo 3.2.

Colunas que existem no banco atual mas não no backup antigo são ignoradas (copia-se a interseção das colunas), então backups de versões anteriores do esquema continuam utilizáveis.

## Recuperação de desastre

| Situação | O que fazer |
|---|---|
| Banco corrompido/apagado | Copie um arquivo de `backend/backups/` para `Banco de Dados/integrador.db` (com o servidor parado) e mantenha a mesma `ENC_KEY` |
| Perdeu a `ENC_KEY` | Os dados cifrados são irrecuperáveis (usuários e papéis continuam, pois senhas usam bcrypt) |
| Quer levar os backups para outro lugar | Copie a pasta `backups/` **e** guarde a `ENC_KEY` separadamente |

## Boas práticas

- Copie `backend/backups/` periodicamente para outro disco/nuvem: os backups ficam na mesma máquina do banco.
- Teste uma restauração em um ambiente de teste antes de depender dela.
- O `.gitignore` já exclui `*.db`, `backups/` e `logs/`; não suba dados reais ao repositório.
