function temperature_client_node()
clear
clc
% MATLAB Wi-Fi Cliente Node com Fechamento Limpo
clear client;

node_ip = "127.0.0.1"; 
node_port = 2000;

fprintf("Tentando se conectar ao servidor Node.js em %s:%d...\n", node_ip, node_port);
client = tcpclient(node_ip, node_port);
fprintf("Conectado com sucesso!\n");

% =========================================================================
% CONFIGURAÇÃO DO FECHAMENTO LIMPO (onCleanup)
% =========================================================================
% Criamos um objeto que será destruído automaticamente quando o script parar.
% Quando destruído, ele executa a função anônima que limpa a conexão.
cleanupObj = onCleanup(@() limparConexao(client));
% =========================================================================

% Variáveis locais de controle
systemStatus = "OFF";
setpoint = 25.0;
currentTemp = 21.0;
ambientTemp = 21.0;

dt = 0.05; % Taxa desejada (20Hz)

fprintf("Loop de controle iniciado. Pressione Ctrl+C para interromper com segurança.\n\n");

while true
    tic; 

    % 1. Executa a física do loop
    if strcmp(systemStatus, "ON")
        heatingRate = 0.1 * (setpoint - currentTemp);
        noise = (rand() - 0.5) * 0.05;
        currentTemp = currentTemp + heatingRate + noise;
    else
        coolingRate = 0.05 * (ambientTemp - currentTemp);
        currentTemp = currentTemp + coolingRate;
    end

    % 2. Envia os dados para o Node.js
    payload = sprintf("temperature=%.2f\n", currentTemp);
    write(client, uint8(char(payload)));

    % 3. Verifica se há resposta do Node.js
    if client.NumBytesAvailable > 0
        response = read(client, client.NumBytesAvailable, "string");

        statusTokens = regexp(response, 'status=([^&|\n]+)', 'tokens');
        if ~isempty(statusTokens), systemStatus = statusTokens{1}{1}; end

        setpointTokens = regexp(response, 'setpoint=([\d.]+)', 'tokens');
        if ~isempty(setpointTokens), setpoint = str2double(setpointTokens{1}{1}); end
    end

    fprintf("Status: %s | Target: %.1f | Temp: %.2f°C\n", systemStatus, setpoint, currentTemp);

    % Compensa o tempo gasto na rede para manter os 20Hz cravados
    tempoGasto = toc;
    if tempoGasto < dt
        pause(dt - tempoGasto); 
    end
end
end
% =========================================================================
% FUNÇÃO DE LIMPEZA
% =========================================================================
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
