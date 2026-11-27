// tcpBridge.js - ponte TCP: script MATLAB (cliente) <-> banco + Socket.IO
// Protocolo (igual ao script do professor, temperature_client_node.m):
//   MATLAB -> servidor : "temperature=<°C>\n"
//   servidor -> MATLAB : "status=ON|OFF&flag=1|0&setpoint=<°C>\n"
const net = require('net');
const db = require('./db');
const { registrarLog } = require('./logger');

const INTERVALO_SALVAR_MS = 1000;   // grava no banco/emite ao front no máx. 1x/s (MATLAB pode enviar a 100 Hz)
const INTERVALO_RESPOSTA_MS = 100;  // responde ao MATLAB no máx. 10x/s (ou na hora, se algo mudou)
const TIMEOUT_SOCKET_MS = 10000;    // MATLAB travado sem fechar o socket -> derruba a conexão
const TEMP_MIN = -20, TEMP_MAX = 150;

// Estado da conexão (lido por /api/status e pelas rotas de comando)
const estado = { conectado: false, ip: null, ultimaLeituraEm: null };
let sockAtual = null;
let ioRef = null;

const dispositivo = () => db.buscarDispositivo(process.env.DEVICE_ID);
const { encNum, decNum } = require('./cripto');
const lerConfig = id => {
    const c = db.prepare('SELECT setpoint, ligado, atualizado_por FROM config_controle WHERE dispositivo_id = ?').get(id);
    return c && { ...c, setpoint: decNum(c.setpoint) };
};
const montarResposta = cfg =>
    `status=${cfg.ligado ? 'ON' : 'OFF'}&flag=${cfg.ligado ? 1 : 0}&setpoint=${Number(cfg.setpoint)}\n`;

// Desliga o controle no banco e avisa os navegadores (segurança: o aquecedor nunca liga sozinho)
function desligarControle(d, motivo) {
    db.prepare('UPDATE config_controle SET ligado = 0, atualizado_em = ? WHERE dispositivo_id = ?')
      .run(new Date().toISOString(), d.id);
    if (ioRef) ioRef.to('device:' + d.device_id).emit('config', { ...lerConfig(d.id), motivo });
}

// Envia a configuração atual ao MATLAB agora. Retorna true se havia MATLAB conectado.
function enviarConfig() {
    const d = dispositivo();
    if (!d || !sockAtual || sockAtual.destroyed) return false;
    sockAtual.write(montarResposta(lerConfig(d.id)));
    return true;
}

function atender(sock) {
    const d = dispositivo();
    if (!d) { sock.destroy(); return; }

    // Só um MATLAB por vez: a conexão nova substitui a antiga
    if (sockAtual && !sockAtual.destroyed) sockAtual.destroy();
    sockAtual = sock;
    estado.conectado = true;
    estado.ip = sock.remoteAddress;

    // Ao conectar: controle começa DESLIGADO e comandos antigos pendentes são descartados
    db.prepare(`UPDATE comandos SET status = 'falhou' WHERE dispositivo_id = ? AND status IN ('pendente', 'enviado')`).run(d.id);
    desligarControle(d, 'matlab_conectado');
    registrarLog('INFO', 'matlab_conectado', `MATLAB conectado de ${sock.remoteAddress}`, { dispositivoId: d.id, ip: sock.remoteAddress });

    sock.setNoDelay(true);
    sock.setTimeout(TIMEOUT_SOCKET_MS);
    sock.on('timeout', () => sock.destroy());

    let buf = '';
    let ultimoSalvo = 0, ultimaResposta = 0, ultimaMsg = '';

    sock.on('data', chunk => {
        try {
            buf += chunk.toString();
            if (buf.length > 4096) buf = '';                   // lixo sem \n: descarta
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const linha = buf.slice(0, i).trim();
                buf = buf.slice(i + 1);
                const m = /^temperature=(-?\d+(?:\.\d+)?)$/.exec(linha);
                if (!m) continue;
                const temperatura = Number(m[1]);
                if (!(temperatura >= TEMP_MIN && temperatura <= TEMP_MAX)) continue;

                const cfg = lerConfig(d.id);
                const agora = Date.now();
                estado.ultimaLeituraEm = agora;

                if (agora - ultimoSalvo >= INTERVALO_SALVAR_MS) {
                    ultimoSalvo = agora;
                    const ts = new Date().toISOString();
                    db.prepare(`INSERT INTO leituras (dispositivo_id, ts, temperatura, setpoint, pwm, variaveis, usuario_id) VALUES (?, ?, ?, ?, ?, '{}', ?)`).run(d.id, ts, encNum(temperatura), encNum(cfg.setpoint), null, cfg.atualizado_por);
                    db.prepare('UPDATE dispositivos SET ultimo_contato = ? WHERE id = ?').run(ts, d.id);
                    if (ioRef) ioRef.to('device:' + d.device_id).emit('reading',
                        { device_id: d.device_id, ts, temperatura, setpoint: cfg.setpoint, pwm: null, variaveis: {} });
                }

                const msg = montarResposta(cfg);
                if (msg !== ultimaMsg || agora - ultimaResposta >= INTERVALO_RESPOSTA_MS) {
                    ultimaMsg = msg; ultimaResposta = agora;
                    sock.write(msg);
                }
            }
        } catch (e) {
            registrarLog('ERROR', 'ponte_tcp', `Erro ao processar dado do MATLAB: ${e.message}`);
        }
    });

    sock.on('error', () => {});
    sock.on('close', () => {
        if (sockAtual !== sock) return;                        // já foi substituído por outra conexão
        sockAtual = null;
        estado.conectado = false;
        desligarControle(d, 'matlab_desconectado');
        registrarLog('WARN', 'matlab_desconectado', 'MATLAB desconectado; controle desligado', { dispositivoId: d.id });
    });
}

function criarPonteTcp(io) {
    ioRef = io;
    const porta = parseInt(process.env.TCP_PORT, 10) || 2000;
    const host = process.env.TCP_HOST || '127.0.0.1';          // use 0.0.0.0 se o MATLAB estiver em outro PC
    const srv = net.createServer(atender);
    srv.on('error', e => {
        console.error(`[ponte TCP] erro: ${e.code === 'EADDRINUSE'
            ? `porta ${porta} já está em uso (feche o esp_ponte_sim.py ou outro servidor)` : e.message}`);
        process.exit(1);
    });
    srv.listen(porta, host, () => console.log(`Ponte TCP (MATLAB) em ${host}:${porta}`));
    return srv;
}

module.exports = criarPonteTcp;
module.exports.estado = estado;
module.exports.enviarConfig = enviarConfig;
