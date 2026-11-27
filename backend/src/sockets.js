// sockets.js - Socket.IO: só aceita conexões com JWT válido (auth.token no handshake)
const { Server } = require('socket.io');
const db = require('./db');
const { validarJwt } = require('./auth');

module.exports = function criarSockets(httpServer) {
    const io = new Server(httpServer);

    io.use((socket, next) => {
        try {
            socket.usuario = validarJwt(socket.handshake.auth && socket.handshake.auth.token);
            next();
        } catch (e) {
            next(new Error('Não autorizado'));
        }
    });

    io.on('connection', socket => {
        socket.join('user:' + socket.usuario.id);   // permite derrubar os sockets de um usuário
        db.prepare('SELECT device_id FROM dispositivos WHERE ativo = 1').all()
          .forEach(d => socket.join('device:' + d.device_id));
        if (socket.usuario.papel === 'admin') socket.join('admins');
    });

    return io;
};
