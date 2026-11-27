// backup.js - backup diário (cron), backup manual e restauração do banco SQLite
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cron = require('node-cron');
const db = require('./db');
const { registrarLog } = require('./logger');

const DIR = path.resolve(__dirname, '..', process.env.BACKUP_DIR || 'backups');
const RETENCAO = parseInt(process.env.BACKUP_RETENCAO, 10) || 14;   // quantos backups periódicos manter
const CRON = process.env.BACKUP_CRON || '0 3 * * *';                // todo dia às 03:00
fs.mkdirSync(DIR, { recursive: true });

// Só os DADOS DE MEDIÇÃO são restaurados. Ficam intactos: usuarios, refresh_tokens,
// dispositivos, config_controle, logs (auditoria) e backups.
const TABELAS = ['leituras', 'comandos', 'experimentos'];

const aspas = s => s.replace(/'/g, "''");
const sha256Arquivo = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const erro = (status, msg) => Object.assign(new Error(msg), { status });

function criarBackup(tipo = 'periodico', usuarioId = null, prefixo = 'backup') {
    const nome = `${prefixo}_${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    const arq = path.join(DIR, nome);
    try {
        db.exec(`VACUUM INTO '${aspas(arq)}'`);          // cópia consistente, já com dados cifrados
        const tamanho = fs.statSync(arq).size;
        const hash = sha256Arquivo(arq);
        const r = db.prepare(`INSERT INTO backups (arquivo, tamanho_bytes, sha256, tipo, status, criado_por, criado_em)
                              VALUES (?, ?, ?, ?, 'ok', ?, ?)`)
                    .run(nome, tamanho, hash, tipo, usuarioId, new Date().toISOString());
        registrarLog('INFO', 'backup', `Backup ${tipo} criado: ${nome} (${tamanho} bytes)`, { usuarioId });
        if (tipo === 'periodico') aplicarRetencao();
        return { id: Number(r.lastInsertRowid), arquivo: nome, tamanho_bytes: tamanho, sha256: hash };
    } catch (e) {
        try { fs.rmSync(arq, { force: true }); } catch (_) { /* nada */ }
        db.prepare(`INSERT INTO backups (arquivo, tipo, status, erro, criado_por, criado_em)
                    VALUES (?, ?, 'erro', ?, ?, ?)`).run(nome, tipo, e.message, usuarioId, new Date().toISOString());
        registrarLog('ERROR', 'backup', `Falha no backup ${tipo}: ${e.message}`, { usuarioId });
        throw e;
    }
}

function aplicarRetencao() {
    const antigos = db.prepare(`SELECT id, arquivo FROM backups
                                WHERE tipo = 'periodico' AND status = 'ok'
                                ORDER BY id DESC LIMIT -1 OFFSET ?`).all(RETENCAO);
    for (const b of antigos) {
        fs.rmSync(path.join(DIR, path.basename(b.arquivo)), { force: true });
        db.prepare('DELETE FROM backups WHERE id = ?').run(b.id);
    }
}

function restaurar(id, usuarioId) {
    const b = db.prepare("SELECT * FROM backups WHERE id = ? AND status = 'ok'").get(id);
    if (!b) throw erro(404, 'Backup não encontrado.');
    const arq = path.join(DIR, path.basename(b.arquivo));          // basename evita path traversal
    if (!fs.existsSync(arq)) throw erro(404, 'O arquivo deste backup não existe mais no disco.');
    if (sha256Arquivo(arq) !== b.sha256) throw erro(422, 'Backup corrompido: o SHA-256 não confere.');

    // Rede de segurança: guarda o estado atual antes de sobrescrever
    criarBackup('manual', usuarioId, 'pre_restauracao');

    try {
        db.exec('PRAGMA foreign_keys = OFF');                      // não funciona dentro de transação
        db.exec(`ATTACH DATABASE '${aspas(arq)}' AS bk`);
        const ic = db.prepare('PRAGMA bk.integrity_check').get();
        if (Object.values(ic)[0] !== 'ok') throw erro(422, 'Backup falhou na verificação de integridade.');

        db.exec('BEGIN');
        try {
            for (const t of TABELAS) {
                const origem = db.prepare(`PRAGMA bk.table_info(${t})`).all().map(c => c.name);
                if (!origem.length) continue;                      // backup antigo sem essa tabela
                const destino = db.prepare(`PRAGMA main.table_info(${t})`).all().map(c => c.name);
                const lista = destino.filter(c => origem.includes(c)).map(c => `"${c}"`).join(', ');
                db.exec(`DELETE FROM main."${t}"`);
                db.exec(`INSERT INTO main."${t}" (${lista}) SELECT ${lista} FROM bk."${t}"WHERE dispositivo_id IS NULL OR dispositivo_id IN (SELECT id FROM main.dispositivos)`);
            }
            for (const t of TABELAS) {
                db.exec(`UPDATE main."${t}" SET usuario_id = NULL
                        WHERE usuario_id IS NOT NULL AND usuario_id NOT IN (SELECT id FROM main.usuarios)`);
            }
            db.exec('COMMIT');
        } catch (e) {
            db.exec('ROLLBACK');
            throw e;
        }
    } finally {
        try { db.exec('DETACH DATABASE bk'); } catch (_) { /* não chegou a anexar */ }
        db.exec('PRAGMA foreign_keys = ON');
    }

    db.prepare('UPDATE backups SET restaurado_em = ?, restaurado_por = ? WHERE id = ?')
      .run(new Date().toISOString(), usuarioId, id);
    registrarLog('WARN', 'restauracao', `Sistema restaurado a partir de ${b.arquivo}`, { usuarioId });
}

// Agenda o backup diário. Se o PC ficou desligado no horário, faz um na inicialização.
function agendar() {
    cron.schedule(CRON, () => { try { criarBackup('periodico'); } catch (_) { /* já registrado em log */ } });

    const ultimo = db.prepare("SELECT criado_em FROM backups WHERE status = 'ok' AND tipo = 'periodico' ORDER BY id DESC LIMIT 1").get();
    if (!ultimo || Date.now() - new Date(ultimo.criado_em).getTime() > 24 * 3600 * 1000) {
        try { criarBackup('periodico'); } catch (_) { /* já registrado em log */ }
    }
    console.log(`Backup automático agendado (${CRON}), pasta: ${DIR}`);
}

module.exports = { criarBackup, restaurar, agendar };