// db.js - conexão SQLite (módulo nativo do Node: node:sqlite), criação das tabelas e registro do kit
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');

// Caminhos relativos no .env são contados a partir da pasta backend/
const resolver = (valor, padrao) => valor ? path.resolve(__dirname, '..', valor) : padrao;
const caminho = resolver(process.env.DB_PATH, path.join(__dirname, '..', 'banco', 'integrador.db'));
const caminhoSchema = resolver(process.env.SCHEMA_PATH, path.join(__dirname, '..', 'banco', 'schema.sql'));
const db = new DatabaseSync(caminho);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

// db.transaction(fn) -> função que executa fn dentro de BEGIN/COMMIT (ROLLBACK se der erro)
db.transaction = fn => (...args) => {
    db.exec('BEGIN');
    try {
        const r = fn(...args);
        db.exec('COMMIT');
        return r;
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }
};

// Se o banco ainda não tem as tabelas, executa o schema.sql
const existe = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='usuarios'").get();
if (!existe) {
    db.exec(fs.readFileSync(caminhoSchema, 'utf8'));
    console.log('[db] Tabelas criadas a partir de ' + caminhoSchema);
}

// Cria (ou renomeia) o registro do kit LTR701, usado como chave estrangeira de leituras/comandos.
// Não há mais token: quem envia dados é o MATLAB pela ponte TCP (tcpBridge.js).
function seedDispositivo() {
    const deviceId = process.env.DEVICE_ID || 'LTR701_01';
    const nome = 'Kit LTR701 (MATLAB)';
    const hashInutil = sha256(crypto.randomUUID());   // coluna token_hash é NOT NULL no schema
    const d = db.prepare('SELECT id FROM dispositivos WHERE device_id = ?').get(deviceId);
    if (d) return;
    const antigo = db.prepare('SELECT id FROM dispositivos ORDER BY id LIMIT 1').get();
    if (antigo) {   // banco antigo (ESP32_SIM_01): renomeia e mantém o histórico
        db.prepare('UPDATE dispositivos SET device_id = ?, nome = ?, token_hash = ? WHERE id = ?').run(deviceId, nome, hashInutil, antigo.id);
        console.log(`[db] Dispositivo existente renomeado para ${deviceId}`);
        return;
    }
    const r = db.prepare('INSERT INTO dispositivos (device_id, nome, token_hash) VALUES (?, ?, ?)').run(deviceId, nome, hashInutil);
    // Começa DESLIGADO: o aquecedor só liga quando um usuário mandar "ligado = 1"
    db.prepare('INSERT INTO config_controle (dispositivo_id, ligado) VALUES (?, 0)').run(r.lastInsertRowid);
    console.log(`[db] Dispositivo ${deviceId} cadastrado`);
}

// Dispositivo pelo device_id; sem argumento, o primeiro ativo
function buscarDispositivo(deviceId) {
    return deviceId
        ? db.prepare('SELECT * FROM dispositivos WHERE device_id = ? AND ativo = 1').get(deviceId)
        : db.prepare('SELECT * FROM dispositivos WHERE ativo = 1 ORDER BY id LIMIT 1').get();
}

module.exports = db;
module.exports.sha256 = sha256;
module.exports.seedDispositivo = seedDispositivo;
module.exports.buscarDispositivo = buscarDispositivo;
