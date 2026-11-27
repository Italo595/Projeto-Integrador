// sistema.js - página "Status e Logs" (somente administrador)
// Mostra os logs do servidor (tabela logs) e recebe os novos em tempo real por Socket.IO.

const terminal = document.getElementById('terminal-logs');
const MAX_LINHAS = 500;
const CLASSES = { INFO: 'info', WARN: 'warn', ERROR: 'err' };

function criarLinha(l) {
    const p = document.createElement('p');

    const t = document.createElement('span');
    t.className = 'time';
    t.textContent = `[${new Date(l.criado_em).toLocaleString('pt-BR')}] `;

    const n = document.createElement('span');
    n.className = CLASSES[l.nivel] || 'info';
    n.textContent = `${l.nivel} ${l.acao}: `;

    p.append(t, n, document.createTextNode(l.mensagem));
    return p;
}

async function carregarLogs() {
    try {
        const logs = await apiFetch('/logs?limit=200');
        terminal.replaceChildren(...logs.map(criarLinha));
        if (logs.length === 0) terminal.textContent = 'Nenhum log registrado ainda.';
        terminal.scrollTop = terminal.scrollHeight;
    } catch (e) {
        terminal.textContent = 'Não foi possível carregar os logs: ' + e.message;
    }
}

function adicionarLog(l) {
    if (terminal.children.length === 0) terminal.replaceChildren();   // remove a mensagem "Nenhum log..."
    const noFim = terminal.scrollTop + terminal.clientHeight >= terminal.scrollHeight - 20;
    terminal.appendChild(criarLinha(l));
    while (terminal.children.length > MAX_LINHAS) terminal.removeChild(terminal.firstChild);
    if (noFim) terminal.scrollTop = terminal.scrollHeight;
}

document.addEventListener('DOMContentLoaded', () => {
    carregarLogs();
    if (typeof io === 'function') {
        io({ auth: { token: getToken() } }).on('log', adicionarLog);
    }
});

// ---------- Backup e restauração (admin) ----------
const listaBackups = document.getElementById('lista-backups');
const msgBackup = document.getElementById('backup-msg');

function celula(texto) { const td = document.createElement('td'); td.textContent = texto; return td; }

async function carregarBackups() {
    try {
        const bks = await apiFetch('/backups');
        listaBackups.replaceChildren(...bks.map(b => {
            const tr = document.createElement('tr');
            const kb = b.tamanho_bytes ? (b.tamanho_bytes / 1024).toFixed(0) + ' KB' : '-';
            tr.append(celula(b.id), celula(new Date(b.criado_em).toLocaleString('pt-BR')),
                      celula(b.tipo), celula(kb),
                      celula(b.status === 'ok' ? (b.restaurado_em ? 'ok (restaurado)' : 'ok') : 'erro'));
            const td = document.createElement('td');
            if (b.status === 'ok') {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = 'Restaurar';
                btn.onclick = () => restaurarBackup(b);
                td.appendChild(btn);
            }
            tr.appendChild(td);
            return tr;
        }));
    } catch (e) { msgBackup.textContent = e.message; }
}

async function restaurarBackup(b) {
    const quando = new Date(b.criado_em).toLocaleString('pt-BR');
    if (!confirm(`Restaurar as leituras, comandos e experimentos para o backup de ${quando}?\n\nUsuários, logs e configurações NÃO serão alterados. Os dados de medição atuais serão substituídos (um backup do estado atual é criado antes).`)) return;
    try {
        await apiFetch(`/backups/${b.id}/restaurar`, { method: 'POST', body: { confirmar: true } });
        alert('Sistema restaurado. A página será recarregada.');
        location.reload();
    } catch (e) { msgBackup.textContent = e.message; }
}

document.addEventListener('DOMContentLoaded', () => {
    carregarBackups();
    document.getElementById('btn-backup').onclick = async () => {
        msgBackup.textContent = 'Gerando backup...';
        try { await apiFetch('/backups', { method: 'POST', body: {} }); msgBackup.textContent = 'Backup criado.'; carregarBackups(); }
        catch (e) { msgBackup.textContent = e.message; }
    };
});