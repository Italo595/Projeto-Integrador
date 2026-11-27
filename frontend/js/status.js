// status.js - status da conexão com o script MATLAB (GET /api/status), atualizado a cada 5 s

function textoUltimaTemp(seg) {
    if (seg === null) return 'nenhuma temperatura recebida ainda';
    if (seg < 60) return `última temperatura há ${seg} s`;
    return `última temperatura há ${Math.floor(seg / 60)} min`;
}

function criarPill(texto, estado, titulo) {
    const el = document.createElement('span');
    el.className = 'disp-pill ' + estado;     // online | offline | aguardando
    el.title = titulo || '';
    el.textContent = '● ' + texto;
    return el;
}

// MATLAB online = conexão TCP aberta com a ponte do servidor (estado real do socket)
async function atualizarStatusMatlab(container) {
    let pill;
    try {
        const s = await apiFetch('/status');
        const m = s.matlab;
        pill = m.online ? criarPill('Online', 'online', textoUltimaTemp(m.ha_segundos_leitura))
                        : criarPill('Offline', 'offline', 'Script MATLAB não conectado');
    } catch (e) {
        pill = criarPill('Servidor indisponível', 'offline', e.message);
    }
    container.replaceChildren(pill);
}

document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('status-matlab');
    if (!el || !getToken()) return;
    atualizarStatusMatlab(el);
    setInterval(() => atualizarStatusMatlab(el), 5000);
});
