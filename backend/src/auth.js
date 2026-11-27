// auth.js - middlewares de autenticação (usuário por JWT)
const jwt = require('jsonwebtoken');
const db = require('./db');

function extrairBearer(req) {
    const h = req.headers.authorization || '';
    return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

function validarJwt(token) {
    const p = jwt.verify(token, process.env.JWT_SECRET);
    const u = db.prepare('SELECT id, nome, email, papel, ativo FROM usuarios WHERE id = ?').get(p.id);
    if (!u || !u.ativo) throw new Error('Usuário inválido');
    return u;
}

function authUsuario(req, res, next) {
    const token = extrairBearer(req);
    if (!token) return res.status(401).json({ erro: 'Token ausente' });
    try {
        req.usuario = validarJwt(token);
        next();
    } catch (e) {
        res.status(401).json({ erro: 'Sessão inválida ou expirada' });
    }
}

function apenasAdmin(req, res, next) {
    if (req.usuario.papel !== 'admin') return res.status(403).json({ erro: 'Apenas administradores' });
    next();
}

module.exports = { validarJwt, authUsuario, apenasAdmin };
