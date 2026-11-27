// Comandos do usuário para o MATLAB: POST /commands/add, GET /commands/history, GET /config
const express = require('express');
const db = require('../db');
const { authUsuario } = require('../auth');
const { registrarLog } = require('../logger');
const ponte = require('../tcpBridge');
const { encNum, encText, decNum, decText } = require('../cripto');

const router = express.Router();

// Só estes dados vão ao MATLAB (nome do comando = coluna de config_controle)
const PERMITIDOS = {
    setpoint: { min: 0, max: 99 },
    ligado: { min: 0, max: 1, inteiro: true }
};

// Qualquer usuário logado controla o sistema físico; logs/restauração ficam com o admin
router.post('/commands/add', authUsuario, (req, res) => {
    const nome = String((req.body || {}).name || '').trim();
    const regra = Object.prototype.hasOwnProperty.call(PERMITIDOS, nome) ? PERMITIDOS[nome] : null;
    if (!regra) return res.status(400).json({ erro: `Comando inválido. Use: ${Object.keys(PERMITIDOS).join(', ')}.` });

    const valor = Number(req.body.value);
    if (!Number.isFinite(valor) || valor < regra.min || valor > regra.max || (regra.inteiro && !Number.isInteger(valor))) {
        return res.status(400).json({ erro: `Valor de ${nome} deve estar entre ${regra.min} e ${regra.max}.` });
    }

    const d = db.buscarDispositivo(req.body.device_id);
    if (!d) return res.status(404).json({ erro: 'Dispositivo não encontrado.' });

    // Segurança: não habilita o aquecedor sem o MATLAB conectado
    if (nome === 'ligado' && valor === 1 && !ponte.estado.conectado) {
        return res.status(409).json({ erro: 'MATLAB não está conectado. Inicie o script antes de ligar o controle.' });
    }

    const salvar = db.transaction(() => {
        const cfg = db.prepare('SELECT * FROM config_controle WHERE dispositivo_id = ?').get(d.id);
        const anterior = cfg ? (nome === 'setpoint' ? decNum(cfg.setpoint) : cfg[nome]) : null;

        const r = db.prepare(`INSERT INTO comandos (dispositivo_id, usuario_id, nome, valor, valor_anterior)
                            VALUES (?, ?, ?, ?, ?)`)
        .run(d.id, req.usuario.id, nome, encText(String(valor)),
            anterior === null ? null : encText(String(anterior)));

        const gravar = nome === 'setpoint' ? encNum(valor) : valor;
        db.prepare(`UPDATE config_controle SET ${nome} = ?, atualizado_por = ?, atualizado_em = ? WHERE dispositivo_id = ?`)
        .run(gravar, req.usuario.id, new Date().toISOString(), d.id);
        return { id: r.lastInsertRowid, anterior };
    });
    const { id, anterior } = salvar();

    // Entrega direta ao MATLAB pelo socket TCP. Não há ack de aplicação: "confirmado" = escrito no socket.
    const entregue = ponte.enviarConfig();
    const io = req.app.get('io');
    if (entregue) {
        const agora = new Date().toISOString();
        db.prepare(`UPDATE comandos SET status = 'confirmado', enviado_em = ?, confirmado_em = ? WHERE id = ?`).run(agora, agora, id);
    }

    registrarLog('INFO', 'comando', `${req.usuario.email}: ${nome} ${anterior} -> ${valor}${entregue ? '' : ' (MATLAB offline, aplicado na próxima conexão)'}`,
                 { usuarioId: req.usuario.id, dispositivoId: d.id, ip: req.ip });
    io.to('device:' + d.device_id).emit('command', { id, nome, valor, valor_anterior: anterior, status: entregue ? 'confirmado' : 'pendente', usuario: req.usuario.nome });
    if (entregue) io.to('device:' + d.device_id).emit('command:ack', { ids: [id] });
    res.status(201).json({ ok: true, id, entregue });
});

router.get('/commands/history', authUsuario, (req, res) => {
    const d = db.buscarDispositivo(req.query.device_id);
    if (!d) return res.status(404).json({ erro: 'Dispositivo não encontrado.' });
    res.json(db.prepare(`SELECT c.id, c.nome, c.valor, c.valor_anterior, c.status, c.criado_em, c.confirmado_em, u.nome AS usuario
                         FROM comandos c LEFT JOIN usuarios u ON u.id = c.usuario_id
                         WHERE c.dispositivo_id = ? ORDER BY c.id DESC LIMIT 50`).all(d.id).map(c => ({ ...c, valor: decText(c.valor), valor_anterior: decText(c.valor_anterior) })));
});

router.get('/config', authUsuario, (req, res) => {
    const d = db.buscarDispositivo(req.query.device_id);
    if (!d) return res.status(404).json({ erro: 'Dispositivo não encontrado.' });
    const c = db.prepare('SELECT * FROM config_controle WHERE dispositivo_id = ?').get(d.id);
    res.json({ ...c, setpoint: decNum(c.setpoint) });
});

module.exports = router;