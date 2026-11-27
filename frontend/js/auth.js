// auth.js - sessão do usuário e chamadas à API (carregado em todas as páginas)
// A API serve o frontend (mesma origem), então o caminho é relativo.
const API = '/api';
const CHAVE_TOKEN = 'token';
const CHAVE_USUARIO = 'usuario';

function getToken() { return localStorage.getItem(CHAVE_TOKEN); }

function getUsuario() {
    try { return JSON.parse(localStorage.getItem(CHAVE_USUARIO)); } catch (e) { return null; }
}

function salvarSessao(token, usuario) {
    localStorage.setItem(CHAVE_TOKEN, token);
    localStorage.setItem(CHAVE_USUARIO, JSON.stringify(usuario));
}

function sair() {
    const token = getToken();
    if (token) {
        try {
            fetch(API + '/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, keepalive: true });
        } catch (e) { /* segue mesmo assim */ }
    }
    localStorage.removeItem(CHAVE_TOKEN);
    localStorage.removeItem(CHAVE_USUARIO);
    location.href = 'login.html';
}

// Chama a API. Em caso de erro lança Error com a mensagem do servidor.
async function apiFetch(caminho, { method = 'GET', body, comAuth = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (comAuth && getToken()) headers.Authorization = 'Bearer ' + getToken();

    let resp;
    try {
        resp = await fetch(API + caminho, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
        throw new Error('Não foi possível conectar ao servidor.');
    }

    let dados = null;
    try { dados = await resp.json(); } catch (e) { /* resposta sem corpo */ }

    if (resp.status === 401 && comAuth) { sair(); throw new Error('Sessão expirada.'); }
    if (!resp.ok) throw new Error((dados && dados.erro) || 'Erro ' + resp.status);
    return dados;
}

// Páginas protegidas: sem token, volta para o login
function exigirLogin() {
    if (!getToken()) location.replace('login.html');
}

function ehAdmin() {
    const u = getUsuario();
    return !!u && u.papel === 'admin';
}

// Páginas só para administrador: quem não é admin volta ao dashboard
function exigirAdmin() {
    exigirLogin();
    if (!ehAdmin()) location.replace('index.html');
}

// "Status e Logs" e "Usuários" só aparecem no menu para administrador
function ajustarMenu() {
    document.querySelectorAll('.main-nav a[href="sistema.html"], .main-nav a[href="usuarios.html"]')
        .forEach(link => { link.style.display = ehAdmin() ? '' : 'none'; });
}

// Mostra "Nome (papel) | Sair" no menu e confirma com o servidor que o token ainda vale
document.addEventListener('DOMContentLoaded', () => {
    const nav = document.querySelector('.main-nav');
    if (!nav || !getToken()) return;

    ajustarMenu();

    const u = getUsuario();
    const span = document.createElement('span');
    span.className = 'usuario-nav';
    span.textContent = u ? `${u.nome} (${u.papel})` : '';

    const link = document.createElement('a');
    link.href = '#';
    link.textContent = 'Sair';
    link.addEventListener('click', e => { e.preventDefault(); sair(); });

    nav.append(span, link);

    apiFetch('/auth/me').then(me => {
        salvarSessao(getToken(), me);
        span.textContent = `${me.nome} (${me.papel})`;
        ajustarMenu();
        if (document.body.hasAttribute('data-somente-admin') && me.papel !== 'admin') location.replace('index.html');
    }).catch(() => { /* 401 já redireciona em apiFetch */ });
});