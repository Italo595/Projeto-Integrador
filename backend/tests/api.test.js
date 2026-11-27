// Testes de integração: sobe um servidor isolado (porta, banco, chaves e pasta de backup temporários)
// e exercita API, permissões, criptografia, ponte TCP (MATLAB simulado) e backup/restauração.
// Executar em backend/:  npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = 3900 + Math.floor(Math.random() * 90), TCP = PORT + 100;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'integrador-'));
const DB = path.join(tmp, 'teste.db');
const BASE = `http://127.0.0.1:${PORT}/api`;
let srv, tokA, tokU;

const esperar = ms => new Promise(r => setTimeout(r, ms));
async function api(rota, { token, body, method } = {}) {
    const r = await fetch(BASE + rota, {
        method: method || (body ? 'POST' : 'GET'),
        headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }) },
        body: body && JSON.stringify(body)
    });
    return { status: r.status, json: await r.json().catch(() => null) };
}
// "MATLAB" falso: conecta no TCP, envia temperaturas e devolve a última linha recebida
function matlabFalso() {
    return new Promise((ok, falha) => {
        const s = net.connect(TCP, '127.0.0.1', () => {
            s.ultima = '';
            s.on('data', d => { s.ultima = d.toString().trim().split('\n').pop(); });
            ok(s);
        });
        s.on('error', falha);
    });
}

before(async () => {
    srv = spawn(process.execPath, ['--no-warnings', 'server.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT, TCP_PORT: TCP, TCP_HOST: '127.0.0.1', DB_PATH: DB,
               SCHEMA_PATH: path.join(__dirname, '..', '..', 'Banco de Dados', 'schema.sql'),
               JWT_SECRET: crypto.randomBytes(24).toString('hex'), ENC_KEY: crypto.randomBytes(32).toString('hex'),
               DEVICE_ID: 'LTR701_TESTE', BACKUP_DIR: path.join(tmp, 'bk'), LOG_PATH: path.join(tmp, 'sistema.log') }
    });
    let saida = ''; srv.stderr.on('data', d => saida += d); srv.stdout.on('data', d => saida += d);
    for (let i = 0; i < 50; i++) {
        try { await fetch(BASE + '/status'); break; } catch { await esperar(200); }
        if (i === 49) throw new Error('Servidor não subiu:\n' + saida);
    }
    await api('/auth/register', { body: { nome: 'Admin', email: 'a@t.com', senha: 'senha1234' } });
    await api('/auth/register', { body: { nome: 'Comum', email: 'u@t.com', senha: 'senha1234' } });
    tokA = (await api('/auth/login', { body: { email: 'a@t.com', senha: 'senha1234' } })).json.token;
    tokU = (await api('/auth/login', { body: { email: 'u@t.com', senha: 'senha1234' } })).json.token;
});

after(async () => {
    if (srv) {
        const encerrado = new Promise(r => srv.once('exit', r));
        srv.kill();
        await encerrado;   // espera o servidor soltar os arquivos
    }
    try {
        fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch { /* pasta temporária fica no %TEMP%; não deve reprovar a suíte */ }
});

test('autenticação: primeiro usuário é admin, demais são comuns', async () => {
    assert.equal((await api('/auth/me', { token: tokA })).json.papel, 'admin');
    assert.equal((await api('/auth/me', { token: tokU })).json.papel, 'comum');
});
test('autenticação: sem token ou com token inválido -> 401', async () => {
    assert.equal((await api('/status')).status, 401);
    assert.equal((await api('/status', { token: 'lixo' })).status, 401);
});
test('autenticação: senha curta e e-mail duplicado são recusados', async () => {
    assert.equal((await api('/auth/register', { body: { nome: 'X', email: 'x@t.com', senha: '123' } })).status, 400);
    assert.equal((await api('/auth/register', { body: { nome: 'Dup', email: 'a@t.com', senha: 'senha1234' } })).status, 409);
});
test('autenticação: 5 senhas erradas bloqueiam a conta (423)', async () => {
    await api('/auth/register', { body: { nome: 'Alvo', email: 'b@t.com', senha: 'senha1234' } });
    for (let i = 0; i < 5; i++) await api('/auth/login', { body: { email: 'b@t.com', senha: 'errada123' } });
    assert.equal((await api('/auth/login', { body: { email: 'b@t.com', senha: 'senha1234' } })).status, 423);
});
test('autorização: usuário comum não acessa logs, backups nem usuários (403)', async () => {
    for (const r of ['/logs', '/backups', '/usuarios', '/historico'])
        assert.equal((await api(r, { token: tokU })).status, 403, r);
    for (const r of ['/logs', '/backups', '/usuarios'])
        assert.equal((await api(r, { token: tokA })).status, 200, r);
});
test('comandos: valida nome e faixa do valor', async () => {
    const c = (name, value) => api('/commands/add', { token: tokU, body: { name, value } });
    assert.equal((await c('setpoint', 150)).status, 400);
    assert.equal((await c('setpoint', 'abc')).status, 400);
    assert.equal((await c('kp', 1)).status, 400);
    assert.equal((await c('setpoint', 50)).status, 201);
});
test('comandos: não liga o aquecedor sem MATLAB conectado (409)', async () => {
    assert.equal((await api('/commands/add', { token: tokU, body: { name: 'ligado', value: 1 } })).status, 409);
});
test('comandos: histórico responde e traz o valor descriptografado', async () => {
    const h = await api('/commands/history', { token: tokU });
    assert.equal(h.status, 200);
    assert.equal(h.json[0].valor, '50');
});
test('ponte TCP: MATLAB recebe flag/setpoint e o controle desliga ao desconectar', async () => {
    const m = await matlabFalso();
    const enviar = async n => { for (let i = 0; i < n; i++) { m.write('temperature=26.00\n'); await esperar(10); } };
    await enviar(30);
    assert.match(m.ultima, /status=OFF&flag=0&setpoint=50/);
    assert.equal((await api('/status', { token: tokU })).json.matlab.online, true);

    assert.equal((await api('/commands/add', { token: tokU, body: { name: 'ligado', value: 1 } })).status, 201);
    await enviar(5);
    assert.match(m.ultima, /status=ON&flag=1&setpoint=50/);

    m.write('lixo\ntemperature=999\n'); await esperar(150);   // lixo e fora de faixa são ignorados
    m.destroy(); await esperar(400);
    assert.equal((await api('/config', { token: tokU })).json.ligado, 0);
});
test('leituras: gravadas no banco CIFRADAS e devolvidas descriptografadas', async () => {
    const lidas = await api('/readings', { token: tokU });
    assert.equal(lidas.status, 200);
    assert.ok(lidas.json.length >= 1);
    assert.equal(lidas.json[0].temperatura, 26);
    const con = new DatabaseSync(DB);
    assert.match(con.prepare('SELECT temperatura FROM leituras LIMIT 1').get().temperatura, /^v1:/);
    assert.match(con.prepare('SELECT mensagem FROM logs LIMIT 1').get().mensagem, /^v1:/);
    con.close();
});
test('backup e restauração: restaura o estado salvo; só admin', async () => {
    const cmd = v => api('/commands/add', { token: tokU, body: { name: 'setpoint', value: v } });
    const qtd = async () => (await api('/commands/history', { token: tokU })).json.length;
    const antes = await qtd();
    assert.equal((await api('/backups', { token: tokU, body: {} })).status, 403);
    const b = await api('/backups', { token: tokA, body: {} });
    assert.equal(b.status, 201);
    await cmd(60); await cmd(70);
    assert.equal(await qtd(), antes + 2);
    assert.equal((await api(`/backups/${b.json.id}/restaurar`, { token: tokA, body: {} })).status, 400);   // exige confirmação
    assert.equal((await api(`/backups/${b.json.id}/restaurar`, { token: tokA, body: { confirmar: true } })).status, 200);
    assert.equal(await qtd(), antes);
});