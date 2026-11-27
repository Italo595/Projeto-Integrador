// POST /api/auth/register | POST /api/auth/login | GET /api/auth/me
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authUsuario } = require('../auth');
const { registrarLog } = require('../logger');

const router = express.Router();
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MIN = 15;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', async (req, res, next) => {
    try {
        const nome = String(req.body.nome || '').trim();
        const email = String(req.body.email || '').trim().toLowerCase();
        const senha = String(req.body.senha || '');

        if (nome.length < 2 || nome.length > 100) return res.status(400).json({ erro: 'Informe um nome válido.' });
        if (!EMAIL_RE.test(email) || email.length > 150) return res.status(400).json({ erro: 'E-mail inválido.' });
        if (senha.length < 8 || senha.length > 72) return res.status(400).json({ erro: 'A senha deve ter entre 8 e 72 caracteres.' });
        if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) {
            return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });
        }

        // O primeiro usuário cadastrado vira administrador; os demais são "comum"
        const papel = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n === 0 ? 'admin' : 'comum';
        const hash = await bcrypt.hash(senha, 12);
        const r = db.prepare('INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, ?)').run(nome, email, hash, papel);

        registrarLog('INFO', 'cadastro', `Usuário ${email} cadastrado (${papel})`, { usuarioId: r.lastInsertRowid, ip: req.ip });
        res.status(201).json({ ok: true, papel });
    } catch (e) { next(e); }
});

router.post('/login', async (req, res, next) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        const senha = String(req.body.senha || '');
        const invalido = () => res.status(401).json({ erro: 'E-mail ou senha inválidos.' });

        const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
        if (!u || !u.ativo) {
            registrarLog('WARN', 'login_falhou', `Tentativa de login com ${email}`, { ip: req.ip });
            return invalido();
        }
        if (u.bloqueado_ate && new Date(u.bloqueado_ate) > new Date()) {
            return res.status(423).json({ erro: `Conta bloqueada temporariamente. Tente novamente em alguns minutos.` });
        }

        if (!(await bcrypt.compare(senha, u.senha_hash))) {
            let falhas = u.tentativas_falhas + 1;
            let bloqueio = null;
            if (falhas >= MAX_TENTATIVAS) {
                bloqueio = new Date(Date.now() + BLOQUEIO_MIN * 60000).toISOString();
                falhas = 0;
                registrarLog('WARN', 'conta_bloqueada', `${email} bloqueado por ${BLOQUEIO_MIN} min`, { usuarioId: u.id, ip: req.ip });
            }
            db.prepare('UPDATE usuarios SET tentativas_falhas = ?, bloqueado_ate = ? WHERE id = ?').run(falhas, bloqueio, u.id);
            registrarLog('WARN', 'login_falhou', `Senha incorreta para ${email}`, { usuarioId: u.id, ip: req.ip });
            return invalido();
        }

        db.prepare('UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL, ultimo_login = ? WHERE id = ?')
          .run(new Date().toISOString(), u.id);
        const token = jwt.sign({ id: u.id, papel: u.papel }, process.env.JWT_SECRET, { expiresIn: '8h' });
        registrarLog('INFO', 'login', `${email} entrou`, { usuarioId: u.id, ip: req.ip });
        res.json({ token, usuario: { id: u.id, nome: u.nome, email: u.email, papel: u.papel } });
    } catch (e) { next(e); }
});

router.get('/me', authUsuario, (req, res) => {
    const { id, nome, email, papel } = req.usuario;
    res.json({ id, nome, email, papel });
});

router.post('/logout', authUsuario, (req, res) => {
    registrarLog('INFO', 'logout', `${req.usuario.email} saiu`, { usuarioId: req.usuario.id, ip: req.ip });
    res.json({ ok: true });
});

module.exports = router;
