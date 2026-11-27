// GET /api/backups | POST /api/backups | POST /api/backups/:id/restaurar  (somente admin)
const express = require('express');
const db = require('../db');
const { authUsuario, apenasAdmin } = require('../auth');
const { criarBackup, restaurar } = require('../backup');
const ponte = require('../tcpBridge');

const router = express.Router();
router.use(authUsuario, apenasAdmin);

const tratar = (res, next) => e => e.status ? res.status(e.status).json({ erro: e.message }) : next(e);

router.get('/', (req, res) => {
    res.json(db.prepare(`SELECT b.id, b.arquivo, b.tamanho_bytes, b.sha256, b.tipo, b.status, b.erro,
                                b.criado_em, b.restaurado_em, u.nome AS criado_por
                         FROM backups b LEFT JOIN usuarios u ON u.id = b.criado_por
                         ORDER BY b.id DESC LIMIT 100`).all());
});

router.post('/', (req, res, next) => {
    try { res.status(201).json(criarBackup('manual', req.usuario.id)); }
    catch (e) { tratar(res, next)(e); }
});

router.post('/:id/restaurar', (req, res, next) => {
    try {
        if (!req.body || req.body.confirmar !== true) return res.status(400).json({ erro: 'Confirmação ausente.' });
        if (ponte.estado.conectado) return res.status(409).json({ erro: 'Desconecte o MATLAB antes de restaurar.' });
        restaurar(parseInt(req.params.id, 10), req.usuario.id);
        res.json({ ok: true });
    } catch (e) { tratar(res, next)(e); }
});

module.exports = router;