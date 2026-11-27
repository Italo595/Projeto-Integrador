// Gerenciamento de contas (somente admin): GET /api/usuarios | PATCH /api/usuarios/:id
const express = require('express');
const db = require('../db');
const { authUsuario, apenasAdmin } = require('../auth');
const { registrarLog } = require('../logger');

const router = express.Router();
router.use(authUsuario, apenasAdmin);

router.get('/', (req, res) => {
    res.json(db.prepare(`SELECT id, nome, email, papel, ativo, ultimo_login, criado_em, bloqueado_ate
                         FROM usuarios ORDER BY id`).all());
});

// Body (todos opcionais): { papel: 'admin' | 'comum', ativo: true | false, desbloquear: true }
router.patch('/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const alvo = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!alvo) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const { papel, ativo, desbloquear } = req.body || {};
    const novoPapel = papel === undefined ? alvo.papel : papel;
    const novoAtivo = ativo === undefined ? alvo.ativo : (ativo ? 1 : 0);

    if (novoPapel !== 'admin' && novoPapel !== 'comum') return res.status(400).json({ erro: 'Papel inválido.' });
    // Quem altera é sempre um admin ativo; impedir que ele se tranque para fora do sistema
    if (id === req.usuario.id && (novoPapel !== 'admin' || !novoAtivo)) {
        return res.status(400).json({ erro: 'Você não pode rebaixar nem desativar a própria conta.' });
    }

    db.prepare('UPDATE usuarios SET papel = ?, ativo = ?, tentativas_falhas = ?, bloqueado_ate = ? WHERE id = ?')
      .run(novoPapel, novoAtivo, desbloquear ? 0 : alvo.tentativas_falhas, desbloquear ? null : alvo.bloqueado_ate, id);

    const mudancas = [];
    if (novoPapel !== alvo.papel) mudancas.push(`papel ${alvo.papel} -> ${novoPapel}`);
    if (novoAtivo !== alvo.ativo) mudancas.push(novoAtivo ? 'conta ativada' : 'conta desativada');
    if (desbloquear) mudancas.push('conta desbloqueada');
    if (mudancas.length) {
        registrarLog('INFO', 'usuario_alterado', `${req.usuario.email} alterou ${alvo.email}: ${mudancas.join(', ')}`,
                     { usuarioId: req.usuario.id, ip: req.ip });
    }

    // Mudou papel ou ativação: derruba os sockets abertos dele (ao reconectar, vale o papel novo)
    if (novoPapel !== alvo.papel || novoAtivo !== alvo.ativo) {
        req.app.get('io').in('user:' + id).disconnectSockets(true);
    }

    res.json(db.prepare('SELECT id, nome, email, papel, ativo, ultimo_login, criado_em, bloqueado_ate FROM usuarios WHERE id = ?').get(id));
});

module.exports = router;