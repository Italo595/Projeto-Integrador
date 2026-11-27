// GET /api/readings (usuário) | GET /api/historico (admin). As leituras entram pela ponte TCP (tcpBridge.js).
const express = require('express');
const db = require('../db');
const { authUsuario, apenasAdmin } = require('../auth');
const { registrarLog } = require('../logger');
const { decNum } = require('../cripto');

const router = express.Router();

router.get('/readings', authUsuario, (req, res) => {
    const d = db.buscarDispositivo(req.query.device_id);
    if (!d) return res.status(404).json({ erro: 'Dispositivo não encontrado.' });
    const limite = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 5000);

    const linhas = db.prepare(`SELECT ts, temperatura, setpoint, pwm, variaveis FROM leituras
                               WHERE dispositivo_id = ? ORDER BY ts DESC, id DESC LIMIT ?`).all(d.id, limite);
    res.json(linhas.reverse().map(l => ({
        ts: l.ts,
        temperatura: decNum(l.temperatura),
        setpoint: decNum(l.setpoint),
        pwm: decNum(l.pwm),
        variaveis: JSON.parse(l.variaveis || '{}')
    })));
});

// Admin: leituras do banco para restaurar a série na tela "Séries Históricas".
// Devolve os N pontos mais recentes do intervalo [de, ate] (ISO), em ordem cronológica.
const dataIso = v => { if (!v) return null; const d = new Date(v); return isNaN(d) ? undefined : d.toISOString(); };

router.get('/historico', authUsuario, apenasAdmin, (req, res) => {
    const d = db.buscarDispositivo(req.query.device_id);
    if (!d) return res.status(404).json({ erro: 'Dispositivo não encontrado.' });

    const de = dataIso(req.query.de);
    const ate = dataIso(req.query.ate);
    if (de === undefined || ate === undefined) return res.status(400).json({ erro: 'Data inválida.' });
    if (de && ate && de > ate) return res.status(400).json({ erro: 'A data inicial deve ser anterior à final.' });
    const limite = Math.min(Math.max(parseInt(req.query.limit, 10) || 5000, 1), 20000);

    let filtro = 'dispositivo_id = ? AND temperatura IS NOT NULL';
    const args = [d.id];
    if (de)  { filtro += ' AND ts >= ?'; args.push(de); }
    if (ate) { filtro += ' AND ts <= ?'; args.push(ate); }

    const total = db.prepare(`SELECT COUNT(*) AS n FROM leituras WHERE ${filtro}`).get(...args).n;
    const pontos = db.prepare(`SELECT ts, temperatura, setpoint, pwm FROM leituras
                               WHERE ${filtro} ORDER BY ts DESC, id DESC LIMIT ?`).all(...args, limite).reverse().map(p => ({ts: p.ts, temperatura: decNum(p.temperatura), setpoint: decNum(p.setpoint), pwm: decNum(p.pwm)}));

    registrarLog('INFO', 'restauracao_serie', `${req.usuario.email} carregou ${pontos.length} de ${total} leituras de ${d.device_id}`,
                 { usuarioId: req.usuario.id, dispositivoId: d.id, ip: req.ip });
    res.json({ device_id: d.device_id, total, retornados: pontos.length, pontos });
});

module.exports = router;
