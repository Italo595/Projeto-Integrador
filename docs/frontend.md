# Frontend

HTML, CSS e JavaScript puros (sem *build*). O servidor Node entrega a pasta `frontend/` como arquivos estáticos; a raiz `/` redireciona para `html/login.html`. O Chart.js vem de CDN (precisa de internet na primeira carga); o cliente Socket.IO vem de `/socket.io/socket.io.js`, servido pelo próprio backend.

## Páginas

| Página | Arquivo | Acesso | Função |
|---|---|---|---|
| Login | `html/login.html` | público | Entrada com e-mail e senha |
| Cadastro | `html/cadastro.html` | público | Cria conta (a 1ª é admin) |
| **Resposta (PID)** | `html/index.html` | logado | Controle, gráficos, sombra digital, modos de operação |
| **Séries Históricas** | `html/estatistica.html` | logado | Estatística descritiva; admin restaura série do banco |
| **Status e Logs** | `html/sistema.html` | **admin** | Status de conexão, logs ao vivo, backup/restauração |
| Usuários | `html/usuarios.html` | **admin** | Papel, ativação e desbloqueio de contas |

As páginas protegidas chamam `exigirLogin()` ou `exigirAdmin()` logo no `<head>`; sem token (ou sem papel) o navegador volta ao login. Os links de admin somem do menu para usuários comuns, mas a segurança real está na API.

## Scripts

| Arquivo | Responsabilidade |
|---|---|
| `js/auth.js` | Token e usuário no `localStorage`, `apiFetch()` (adiciona o `Bearer` e trata 401/erros), guardas de página, menu e botão Sair |
| `js/main.js` | Utilitários comuns (hora, `registrarLog` local) |
| `js/status.js` | *Pill* **MATLAB Online/Offline** (consulta `/api/status` a cada 5 s) |
| `js/kit.js` | Sombra digital do kit (`Kit.atualizar(...)`) |
| `js/simulacao.js` | Lógica da página Resposta (PID): três modos, gráficos, Socket.IO, comandos |
| `js/estatistica.js` | Cálculo das estatísticas e restauração da série do banco |
| `js/sistema.js` | Logs (histórico + tempo real), backups e restauração |
| `js/usuarios.js` | Tabela de usuários e ações de admin |

## Página "Resposta (PID)"

### Controles

- **Modo de comunicação:** `local`, `simulada` ou `real` (lembrado em `localStorage`).
- **Status do MATLAB:** *pill* online/offline.
- **Ligar/Desligar** e **Setpoint (°C)** + **Atualizar** nos modos com MATLAB (só `ligado` e `setpoint` vão ao servidor).
- **Formulário de simulação local:** tempo final, temperatura inicial, setpoint 1 (> inicial, < 100 °C), setpoint 2 e instante da troca, perturbação e instante, Kp, Ki e velocidade da simulação.

### Gráficos

Temperatura (PV), setpoint, erro e, **só no modo local**, sinal de controle (tensão no aquecedor). Nos modos com MATLAB o sinal de controle não é exibido, pois o MATLAB só devolve a temperatura.

### Modos de operação

| Modo | Fonte dos dados | Quem calcula o PI |
|---|---|---|
| `local` | Simulação no navegador (planta discretizada G(z)) | Navegador |
| `simulada` | Evento `reading` do Socket.IO | MATLAB (`temperature_client_node.m`) |
| `real` | Evento `reading` do Socket.IO | MATLAB (`controle_kit_web.m` + kit) |

#### Modelo da planta (modo local)

A planta é de 1ª ordem discretizada com `Ts = 10 ms`:

```text
K = 1,387 / 0,2351 ≈ 5,90 °C/V        τ = 1 / 0,2351 ≈ 4,25 s
G(z) = K(1 − a) z⁻¹ / (1 − a z⁻¹),    a = e^(−Ts/τ)
```

Entrada em volts (saturada em 0–10 V), saída como variação de temperatura sobre a temperatura inicial. **Substitua pelos valores identificados em LCON-I** editando o bloco `PLANTA` no topo de `simulacao.js` (`num` e `den` estilo MATLAB).

### Sombra digital do kit

SVG com o kit soprando ar. Em qualquer modo mostra:

- **cor do ar** do azul (≈ 20 °C) ao vermelho (≈ 80 °C);
- **temperatura**, **setpoint** e **estado** (LIGADO/DESLIGADO) em destaque;
- **ventilador** girando quando ligado;
- **aquecedor** com cor/espessura proporcionais ao nível; fora do modo local o nível é **estimado** (marcado com "estim.") a partir do erro, pois o MATLAB não envia o sinal de controle;
- aviso de **perturbação** (modo local) e **fonte** dos dados ("Simulação local", "MATLAB simulado", "MATLAB + kit LTR701").

## Página "Séries Históricas"

Calcula sobre a temperatura (PV):

| Medida | Definição usada |
|---|---|
| Média | aritmética |
| Variância e desvio padrão | **amostrais** (divisor n − 1) |
| Assimetria | `m3 / m2^1,5` (momentos populacionais) |
| Curtose | **em excesso**: `m4 / m2² − 3` |
| Outliers | Tukey: valores fora de `[Q1 − 1,5·IQR, Q3 + 1,5·IQR]`, com quartis por interpolação linear |

A série vem da simulação/sessão (`localStorage`, chave `serie_historica`, até 5000 pontos) ou, para **admins**, do banco: escolha intervalo e limite e clique em restaurar (`GET /api/historico`). Os outliers aparecem destacados no gráfico.

## Página "Status e Logs" (admin)

- Status do servidor e do MATLAB.
- Terminal com os últimos 200 logs e novos eventos em tempo real (`log` no Socket.IO), cores por nível (INFO/WARN/ERROR).
- Tabela de backups com **Fazer backup agora** e **Restaurar** (pede confirmação e avisa que usuários, logs e configurações não são alterados).

## Página "Usuários" (admin)

Lista contas com papel, situação e último login; permite promover/rebaixar, ativar/desativar e desbloquear. A própria conta não pode ser rebaixada nem desativada.

## Armazenamento no navegador

| Chave (`localStorage`) | Conteúdo |
|---|---|
| token e usuário (`auth.js`) | JWT e dados do usuário logado |
| `modo_com` | último modo de comunicação |
| `serie_historica` | série de temperatura para a página de estatísticas |
| `sistema_logs` | logs locais do navegador (`main.js`) |

## Convenções

- Células de tabela e linhas de log são criadas com `textContent`/`createTextNode` (sem `innerHTML`), evitando injeção de HTML.
- Toda chamada à API passa por `apiFetch()`.
- Nenhuma lógica de segurança depende do frontend.
