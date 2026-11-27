// logger.js - grava na tabela logs, em arquivo .log, no console e avisa os administradores por socket
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { encText } = require('./cripto');

// Caminho relativo no .env é contado a partir da pasta backend/ (padrão: backend/logs/sistema.log)
const caminhoLog = path.resolve(__dirname, '..', process.env.LOG_PATH || path.join('logs', 'sistema.log'));
fs.mkdirSync(path.dirname(caminhoLog), { recursive: true });
const arquivo = fs.createWriteStream(caminhoLog, { flags: 'a' });
arquivo.on('error', e => console.error('[log] falha ao escrever no arquivo:', e.message));

let io = null;

function setIo(instancia) { io = instancia; }

// Uma linha por registro (quebras de linha na mensagem viram espaço)
const limpar = t => String(t).replace(/[\r\n]+/g, ' ');

function registrarLog(nivel, acao, mensagem, { usuarioId = null, dispositivoId = null, ip = null } = {}) {
    const criado = new Date().toISOString();

    try {
        db.prepare('INSERT INTO logs (nivel, acao, mensagem, usuario_id, dispositivo_id, ip, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(nivel, acao, encText(mensagem), usuarioId, dispositivoId, ip, criado);
    } catch (e) {
        console.error('[log] falha ao gravar no banco:', e.message);
    }

    const extras = `usuario=${usuarioId ?? '-'} dispositivo=${dispositivoId ?? '-'} ip=${ip ?? '-'}`;
    arquivo.write(`${criado} ${nivel} ${acao}: ${limpar(mensagem)} [${extras}]\n`);

    console.log(`[${criado}] ${nivel} ${acao}: ${mensagem}`);
    if (io) io.to('admins').emit('log', { criado_em: criado, nivel, acao, mensagem });
}

module.exports = { registrarLog, setIo, caminhoLog };