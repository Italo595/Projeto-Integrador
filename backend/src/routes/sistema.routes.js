// GET /api/status | GET /api/logs (admin)
const express = require('express');
const db = require('../db');
const { authUsuario, apenasAdmin } = require('../auth');

const router = express.Router();
const ponte = require('../tcpBridge');

// Estado real da conexão TCP com o MATLAB (não depende de timestamps)
router.get('/status', authUsuario, (req, res) => {
    const { conectado, ip, ultimaLeituraEm } = ponte.estado;
    res.json({
        servidor: 'online',
        matlab: {
            online: conectado,
            ip: conectado ? ip : null,
            ha_segundos_leitura: ultimaLeituraEm ? Math.round((Date.now() - ultimaLeituraEm) / 1000) : null
        }
    });
});

router.get('/logs', authUsuario, apenasAdmin, (req, res) => {
    const limite = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const { decText } = require('../cripto');

res.json(db.prepare('SELECT criado_em, nivel, acao, mensagem FROM logs ORDER BY id DESC LIMIT ?')
  .all(limite).map(l => ({ ...l, mensagem: decText(l.mensagem) })).reverse());
});

module.exports = router;
