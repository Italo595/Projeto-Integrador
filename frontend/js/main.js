// main.js - Carregado em todas as páginas

const CHAVE_LOGS = 'sistema_logs';
const MAX_LOGS = 100;

// Horário formatado (logs e gráficos)
function obterHoraAtual() {
    return new Date().toLocaleTimeString('pt-BR');
}

function lerLogs() {
    try {
        return JSON.parse(localStorage.getItem(CHAVE_LOGS)) || [];
    } catch (e) {
        return [];
    }
}

// Registra um evento (console + localStorage, para a página "Status e Logs" ler)
function registrarLog(nivel, mensagem) {
    const hora = obterHoraAtual();
    console.log(`[${hora}] ${nivel}: ${mensagem}`);

    try {
        const logs = lerLogs();
        logs.push({ time: hora, nivel, mensagem });
        while (logs.length > MAX_LOGS) logs.shift();
        localStorage.setItem(CHAVE_LOGS, JSON.stringify(logs));
    } catch (e) {
        // localStorage indisponível/cheio: segue sem persistir
    }
}
