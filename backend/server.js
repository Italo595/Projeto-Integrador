// server.js - API REST + Socket.IO + arquivos estáticos do frontend
require('dotenv').config();

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    console.error('Defina JWT_SECRET (mín. 16 caracteres) no arquivo .env');
    process.exit(1);
}

const express = require('express');
const http = require('http');
const path = require('path');
const db = require('./src/db');
const { setIo, registrarLog, caminhoLog } = require('./src/logger');

db.seedDispositivo();

const app = express();
const server = http.createServer(app);
const io = require('./src/sockets')(server);
app.set('io', io);
setIo(io);
require('./src/tcpBridge')(io);
require('./src/backup').agendar();

app.use(express.json({ limit: '100kb' }));

app.use('/api/auth', require('./src/routes/auth.routes'));
app.use('/api', require('./src/routes/readings.routes'));
app.use('/api', require('./src/routes/commands.routes'));
app.use('/api', require('./src/routes/sistema.routes'));
app.use('/api/usuarios', require('./src/routes/usuarios.routes'));
app.use('/api/backups', require('./src/routes/backup.routes'));
app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

// Frontend servido pela própria API (mesma origem => sem CORS)
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.get('/', (req, res) => res.redirect('/html/login.html'));

app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido.' });
    console.error(err);
    registrarLog('ERROR', 'erro_interno', `${req.method} ${req.originalUrl}: ${err.message}`, { ip: req.ip });
    res.status(500).json({ erro: 'Erro interno do servidor.' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor em http://localhost:${PORT}`);
    registrarLog('INFO', 'servidor', `Servidor iniciado na porta ${PORT} (log em ${caminhoLog})`);
});
