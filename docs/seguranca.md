# Segurança

## Resumo dos controles

| Requisito | Como é atendido | Onde |
|---|---|---|
| Autenticação | Login com e-mail/senha, JWT assinado (HS256) com validade de 8 h | `routes/auth.routes.js`, `auth.js` |
| Armazenamento de senha | Hash **bcrypt**, custo 12; a senha nunca é gravada | `auth.routes.js` |
| 2 níveis de acesso | Papéis `admin` e `comum`, checados no servidor a cada requisição | `auth.js` (`apenasAdmin`) |
| Força bruta | 5 senhas erradas → conta bloqueada por 15 min (HTTP 423) | `auth.routes.js` |
| Criptografia de dados | AES-256-GCM em medições, comandos e logs | `cripto.js` |
| Logs/auditoria | Banco + arquivo `.log` + tempo real para admins | `logger.js` |
| Backup e restauração | Cron diário, SHA-256, integridade, backup de segurança antes de restaurar | `backup.js` |
| Tempo real protegido | Socket.IO só aceita JWT válido | `sockets.js` |

## Autenticação e sessão

- O JWT carrega `id` e `papel`, mas **o servidor sempre consulta o usuário no banco** (existe? está ativo?) e usa o papel do banco, não o do token. Rebaixar ou desativar uma conta tem efeito imediato.
- Mensagem de erro de login é a mesma para e-mail inexistente e senha errada (evita enumeração de contas).
- Conta desativada não entra e não mantém sockets: `PATCH /usuarios/:id` derruba os sockets do usuário quando papel ou ativação mudam.
- `JWT_SECRET` com menos de 16 caracteres impede o servidor de iniciar.
- Logout descarta o token no navegador; o JWT em si segue válido até expirar (não há lista de revogação).

## Autorização

| Papel | Permissões |
|---|---|
| `comum` | Dashboard, `commands/add`, `commands/history`, `config`, `readings`, `status` |
| `admin` | Tudo do comum + `logs`, `historico`, `usuarios`, `backups` |

- O **primeiro cadastro** vira admin; os demais nascem `comum`. Admins promovem/rebaixam pela página **Usuários**.
- Um admin não pode rebaixar nem desativar a si mesmo (evita trancar o sistema sem administrador).
- O frontend esconde itens por papel, mas a **barreira real é o servidor** (respostas 401/403).

## Criptografia (AES-256-GCM)

- Chave de 32 bytes em `ENC_KEY` (64 caracteres hexadecimais). O servidor não inicia sem ela.
- **IV aleatório de 12 bytes por registro** e *tag* de autenticação: qualquer alteração do dado cifrado faz a leitura falhar.
- Cifrados: temperatura, setpoint e pwm de `leituras`; valores de `comandos`; setpoint de `config_controle`; mensagem de `logs`. Lista completa em [`banco-de-dados.md`](banco-de-dados.md#o-que-é-cifrado-aes-256-gcm).
- Os backups copiam o banco **já cifrado**.
- **Perder a `ENC_KEY` significa perder o acesso aos dados cifrados.** Guarde-a fora do repositório e inclua-a na rotina de cópia de segurança, separada dos arquivos de backup.
- Não há rotação automática de chave. O prefixo `v1:` permite introduzir outra versão no futuro.

## Logs e auditoria

Cada registro tem nível (`INFO`, `WARN`, `ERROR`), ação, mensagem, usuário, dispositivo, IP e data. Ações registradas:

| Ação | Nível | Quando |
|---|---|---|
| `cadastro`, `login`, `logout` | INFO | ciclo de vida da sessão |
| `login_falhou` | WARN | e-mail inexistente ou senha errada |
| `conta_bloqueada` | WARN | 5ª falha seguida |
| `comando` | INFO | cada `setpoint`/`ligado` (valor anterior → novo) |
| `usuario_alterado` | INFO | mudança de papel, ativação ou desbloqueio |
| `matlab_conectado` / `matlab_desconectado` | INFO / WARN | ponte TCP |
| `backup`, `restauracao` | INFO / WARN | backups e restaurações |
| `restauracao_serie` | INFO | admin carregou a série histórica do banco |
| `erro_interno`, `ponte_tcp` | ERROR | falhas inesperadas |

Destinos: tabela `logs` (mensagem cifrada), arquivo `backend/logs/sistema.log` (**texto claro**, uma linha por evento) e sala `admins` do Socket.IO.

> O arquivo `.log` não é cifrado. Ele contém e-mails e IPs; trate-o como dado sensível e mantenha `logs/` fora do Git (já está no `.gitignore`).

## Proteções do hardware

O kit aquece de verdade, então há proteção em camadas:

| Camada | Proteção |
|---|---|
| Servidor | Recusa `ligado = 1` se não há MATLAB conectado (409) |
| Servidor | Ao conectar/desconectar o MATLAB, **força `ligado = 0`**; o aquecedor nunca liga sozinho |
| Servidor | Limita setpoint a 0–99 °C e descarta temperaturas fora de −20 a 150 °C |
| Servidor | *Timeout* de 10 s de socket mudo derruba a conexão (e desliga o controle) |
| MATLAB | Servidor mudo por 2 s → `flag = 0` (aquecedor e ventilador desligados) |
| MATLAB | Temperatura filtrada > 95 °C → controle travado (ventilador segue para resfriar) |
| MATLAB | Saturação da tensão do aquecedor em 0–9,5 V e anti-windup |
| MATLAB | `onCleanup`: ao parar, erro ou Ctrl+C, zera aquecedor e ventilador e fecha o TCP |
| Restauração | Bloqueada enquanto o MATLAB estiver conectado |

## Outras proteções implementadas

- **Injeção de SQL:** consultas parametrizadas; nomes de coluna de `UPDATE` só vêm de uma lista fixa (`setpoint`, `ligado`).
- **Path traversal** na restauração: `path.basename` no nome do arquivo.
- **Validação de entrada:** tipo, faixa e formato em todas as rotas; JSON malformado → 400.
- **Corpo limitado** a 100 kB; buffer TCP descartado acima de 4 kB sem quebra de linha.
- **XSS nos logs/tabelas do frontend:** células montadas com `textContent`, não `innerHTML`.

## Pontos de atenção (fora do escopo atual)

| Item | Risco | Mitigação sugerida |
|---|---|---|
| Sem HTTPS | Senha e token trafegam em texto claro fora do `localhost` | Proxy reverso com TLS (Nginx, Caddy) |
| Ponte TCP sem autenticação | Qualquer host que alcance a porta 2000 pode se passar pelo MATLAB | Manter `TCP_HOST=127.0.0.1`; se for `0.0.0.0`, firewall/VPN |
| JWT no `localStorage` | Roubável em caso de XSS | Cookie `HttpOnly` + CSRF token, ou CSP rígida |
| Sem limite de requisições por IP | Força bruta distribuída entre contas | `express-rate-limit` |
| Sem revogação de JWT | Token roubado vale até expirar | Lista de revogação / `refresh_tokens` curtos |
| Qualquer usuário logado liga o aquecedor | Decisão de projeto (requisito) | Restringir `ligado` ao admin, se necessário |
| Chave `ENC_KEY` única | Vazamento expõe todos os dados | Gerenciador de segredos; rotação planejada |
