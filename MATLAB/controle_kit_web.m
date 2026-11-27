function controle_kit_web()
% CONTROLE_KIT_WEB  Controle PI de temperatura do kit LTR701 integrado ao sistema web.
%
% Junta o script de controle do laboratorio (NI-USB-6003, filtro passa-baixas
% e PI a 100 Hz) com o protocolo TCP usado pela ponte do servidor Node.js:
%
%   MATLAB -> servidor : "temperature=<C>\n"                (temperatura filtrada)
%   servidor -> MATLAB : "status=ON|OFF&flag=1|0&setpoint=<C>\n"
%
% - flag = 1: executa o controle (erro + PI) e liga o ventilador. flag = 0: zera o
%   integrador e desliga aquecedor E ventilador.
% - O envio ao servidor e feito a cada N_ENVIO amostras e a leitura e
%   nao bloqueante (so le se ja houver bytes), para nao atrasar o laco de 100 Hz.
% - Para parar: Ctrl+C. Aquecedor e ventilador sao desligados e a conexao TCP e
%   fechada automaticamente (encerrar -> limparConexao). O mesmo vale se o script
%   der erro ou se ENCERRAR_AO_DESLIGAR = true e o usuario clicar em Desligar.

%% ===================== CONFIGURACAO (edite aqui) =====================
SERVER_IP   = "127.0.0.1";   % IP/dominio do servidor Node (mesmo PC: 127.0.0.1)
SERVER_PORT = 2000;          % TCP_PORT do .env do backend

Kp = NaN;                    % <-- ganho proporcional projetado em LCON-I
Ki = NaN;                    % <-- ganho integral projetado em LCON-I
if isnan(Kp) || isnan(Ki)
    error('Preencha Kp e Ki no inicio do arquivo antes de executar.');
end

V2C = @(v) 9.0*v + 1.45;     % conversao Volts -> graus Celsius (equacao do kit)

Fs = 100;  Ts = 1/Fs;        % frequencia/periodo do laco de controle
tau = 0.012732395447352;     % constante de tempo do filtro passa-baixas
a0 = 1.0 + (2.0*tau/Ts);
a1 = 1.0 - (2.0*tau/Ts);

N_ENVIO          = 10;       % envia a temperatura a cada 10 amostras (10 Hz)
V_MAX            = 9.5;      % saturacao da tensao do aquecedor (kit: max 10 V)
V_FAN            = 2.5;      % tensao fixa do ACTUATOR 1 (ventilador)
T_SEGURA         = 95;       % acima disso o controle e travado (protecao)
TIMEOUT_SERVIDOR = 2;        % s sem resposta do servidor -> controle desligado
PERIODO_RECONEXAO = 3;       % s entre tentativas de reconexao
ENCERRAR_AO_DESLIGAR = false; % true: Desligar no dashboard tambem encerra o script (roda a limpeza)

%% ===================== HARDWARE (DAQ) =====================
d = daq("ni");
ch1 = addinput(d, "Dev1", "ai0", "Voltage");
ch1.TerminalConfig = "SingleEnded";   % SENSOR 2
addoutput(d, "Dev1", "ao0", "Voltage");   % ACTUATOR 2 (aquecedor)
addoutput(d, "Dev1", "ao1", "Voltage");   % ACTUATOR 1 (ventilador)
d.Rate = Fs;

client = [];                          % conexao TCP (criada abaixo)
limpeza = onCleanup(@encerrar);       %#ok<NASGU> desliga tudo ao parar/erro/Ctrl+C

%% ===================== ESTADO INICIAL =====================
% Inicializa o filtro com a primeira leitura (evita o transiente a partir de 0)
temp_C = V2C(read(d).Dev1_ai0);
xf0 = temp_C;  xf1 = temp_C;
yf0 = temp_C;  yf1 = temp_C;

flagWeb  = false;     % ultimo flag recebido do servidor
flagAnt  = false;     % flagWeb da iteracao anterior (detecta o clique em Desligar)
travado  = false;     % travamento por sobretemperatura
setpoint = 25.0;      % ate chegar o primeiro valor do servidor
I = 0.0;
rx = '';              % buffer de recepcao TCP
tResp = tic;          % instante da ultima resposta valida do servidor
tTentativa = tic;

client = conectar(SERVER_IP, SERVER_PORT);
if isempty(client)
    warning('Servidor %s:%d indisponivel. Controle desligado; tentando reconectar...', SERVER_IP, SERVER_PORT);
else
    fprintf('Conectado ao servidor %s:%d\n', SERVER_IP, SERVER_PORT);
    tResp = tic;
end
fprintf('Laco de controle a %d Hz iniciado. Ctrl+C para parar com seguranca.\n\n', Fs);

%% ===================== LACO PRINCIPAL =====================
t0 = tic;  k = 0;
while true
    k = k + 1;

    % --- 1. Sensor: leitura, conversao e filtro (Tustin) ---
    temp_C = V2C(read(d).Dev1_ai0);
    xf1 = xf0;  xf0 = temp_C;
    yf1 = yf0;
    yf0 = (xf0 + xf1 - a1*yf1) / a0;      % temperatura filtrada em C

    % --- 2. Comunicacao com o servidor (nao bloqueante, a cada N_ENVIO) ---
    if isempty(client)
        if toc(tTentativa) > PERIODO_RECONEXAO
            client = conectar(SERVER_IP, SERVER_PORT);
            tTentativa = tic;
            if ~isempty(client)
                fprintf('Reconectado ao servidor.\n');
                tResp = tic;  rx = '';
            end
        end
    elseif mod(k, N_ENVIO) == 0
        try
            write(client, uint8(char(sprintf("temperature=%.2f\n", yf0))));
            n = client.NumBytesAvailable;
            if n > 0
                rx = [rx char(read(client, n, "string"))]; %#ok<AGROW>
                if numel(rx) > 2000, rx = ''; end
                fim = find(rx == newline, 1, 'last');
                if ~isempty(fim)                              % so linhas completas
                    linhas = splitlines(rx(1:fim-1));
                    rx = rx(fim+1:end);
                    [valido, f, sp] = parseResposta(linhas{end});   % vale a mais recente
                    if valido
                        flagWeb = f;
                        if sp > 0 && sp < 100, setpoint = sp; end
                        tResp = tic;
                    end
                end
            end
        catch ME
            warning('Conexao com o servidor perdida (%s). Controle desligado.', ME.message);
            try, delete(client); catch, end %#ok<NOCOMMA>
            client = [];  flagWeb = false;  tTentativa = tic;
        end
    end

    % --- 3. Protecoes: servidor mudo e sobretemperatura ---
    if toc(tResp) > TIMEOUT_SERVIDOR, flagWeb = false; end
    if yf0 > T_SEGURA
        if ~travado, warning('Temperatura %.1f C acima de %d C: controle travado.', yf0, T_SEGURA); end
        travado = true;
    end
    if ~flagWeb, travado = false; end     % rearma quando o usuario desligar na web
    flag = flagWeb && ~travado;

    if ENCERRAR_AO_DESLIGAR && flagAnt && ~flagWeb
        fprintf('\nDashboard desligado: encerrando o script com seguranca.\n');
        break;                            % sai do laco -> onCleanup roda encerrar()
    end
    flagAnt = flagWeb;

    % --- 4. Controle PI (so com flag = 1) ---
    if flag
        erro = setpoint - yf0;
        Itent = I + erro*Ki*Ts;                         % integrador de Euler
        u_bruto = Kp*erro + Itent;
        u = min(max(u_bruto, 0.0), V_MAX);              % saturacao
        if u == u_bruto, I = Itent; end                 % anti-windup (integracao condicional)
    else
        I = 0.0;  u = 0.0;  erro = 0.0;                 % reinicializa o controlador
    end

    % --- 5. Atuadores ---
    % Ventilador so gira com o dashboard ligado (em sobretemperatura continua ligado para resfriar).
    % Desligar no dashboard, servidor mudo ou conexao perdida => flagWeb = false => ventilador off.
    v_fan = V_FAN * flagWeb;
    write(d, [u v_fan]);

    % --- 6. Log leve (1x por segundo) e temporizacao sem deriva ---
    if mod(k, Fs) == 0
        fprintf('flag=%d | sp=%5.1f | T=%6.2f C | erro=%6.2f | u=%4.2f V | %s\n', ...
                flag, setpoint, yf0, erro, u, ternario(~isempty(client), 'online', 'OFFLINE'));
    end
    atraso = k*Ts - toc(t0);
    if atraso < -0.5, t0 = tic; k = 0; end              % atrasou muito (ex.: reconexao): ressincroniza
    pause(max(0, atraso));
end

%% ===================== LIMPEZA (nested: ve d e client atuais) =====================
    function encerrar()
        fprintf('\n[CLEANUP] Desligando aquecedor e ventilador...\n');
        try, write(d, [0 0]); catch, end %#ok<NOCOMMA>   % 1o: kit em estado seguro
        fprintf('[CLEANUP] Aquecedor e ventilador desligados.\n');
        limparConexao(client);                           % 2o: fecha o TCP (funcao do professor)
    end
end

%% ===================== FUNCOES LOCAIS =====================
% Funcao de limpeza do professor (mesma de temperature_client_node.m)
function limparConexao(tcpObj)
fprintf('\n[CLEANUP] Interrupção detectada! Fechando conexão TCP de forma limpa...\n');
try
    % Deleta explicitamente o objeto cliente do ecossistema do MATLAB
    % Isso força o encerramento do Socket TCP a nível de sistema operacional
    delete(tcpObj); 
    fprintf('[CLEANUP] Porta liberada com sucesso no Node.js!\n');
catch
    fprintf('[CLEANUP] Erro ou conexão já estava fechada.\n');
end
end

function c = conectar(ip, porta)
    try
        c = tcpclient(ip, porta, "ConnectTimeout", 2);
    catch
        c = [];
    end
end

% Linha esperada: status=ON&flag=1&setpoint=55   (flag e opcional; usa status se faltar)
function [valido, flag, sp] = parseResposta(linha)
    valido = false;  flag = false;  sp = NaN;
    tf  = regexp(linha, 'flag=(\d)', 'tokens', 'once');
    ts  = regexp(linha, 'status=(\w+)', 'tokens', 'once');
    tsp = regexp(linha, 'setpoint=(-?[\d.]+)', 'tokens', 'once');
    if isempty(tsp) || (isempty(tf) && isempty(ts)), return; end
    if ~isempty(tf), flag = (str2double(tf{1}) == 1);
    else,            flag = strcmpi(ts{1}, 'ON');
    end
    sp = str2double(tsp{1});
    valido = isfinite(sp);
end

function s = ternario(cond, a, b)
    if cond, s = a; else, s = b; end
end
