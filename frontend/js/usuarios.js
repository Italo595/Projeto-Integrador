// usuarios.js - gerenciamento de contas (somente administrador)
const corpo = document.querySelector('#tabela-usuarios tbody');
const msg = document.getElementById('usuarios-msg');

function mostrarMsg(texto, erro = false) {
    msg.className = 'rest-msg' + (erro ? ' erro' : '');
    msg.textContent = texto;
}

// O SQLite grava CURRENT_TIMESTAMP em UTC sem "Z"; as datas que a API grava já são ISO
function formatarData(valor) {
    if (!valor) return '—';
    const d = new Date(valor.includes('T') ? valor : valor.replace(' ', 'T') + 'Z');
    return isNaN(d) ? '—' : d.toLocaleString('pt-BR');
}

function celula(conteudo) {
    const td = document.createElement('td');
    if (conteudo instanceof Node) td.appendChild(conteudo);
    else td.textContent = conteudo;
    return td;
}

function criarBadge(texto, classe) {
    const b = document.createElement('span');
    b.className = 'badge ' + classe;
    b.textContent = texto;
    return b;
}

function criarBotao(texto, classe, aoClicar, desabilitado) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = texto;
    if (classe) b.className = classe;
    b.disabled = !!desabilitado;
    b.addEventListener('click', aoClicar);
    return b;
}

function criarLinha(u) {
    const eu = getUsuario();
    const souEu = !!eu && eu.id === u.id;
    const bloqueado = !!u.bloqueado_ate && new Date(u.bloqueado_ate) > new Date();

    const tr = document.createElement('tr');
    if (!u.ativo) tr.className = 'inativo';

    // Papel
    const select = document.createElement('select');
    ['comum', 'admin'].forEach(p => {
        const o = document.createElement('option');
        o.value = p;
        o.textContent = p === 'admin' ? 'Administrador' : 'Usuário comum';
        o.selected = u.papel === p;
        select.appendChild(o);
    });
    select.disabled = souEu;
    select.addEventListener('change', () => atualizar(u.id, { papel: select.value }));

    // Situação
    const situacao = document.createElement('span');
    situacao.append(criarBadge(u.ativo ? 'Ativa' : 'Desativada', u.ativo ? 'ativo' : 'inativo'));
    if (bloqueado) situacao.append(' ', criarBadge('Bloqueada', 'bloqueado'));

    // Ações
    const acoes = document.createElement('span');
    acoes.append(criarBotao(u.ativo ? 'Desativar' : 'Ativar', u.ativo ? 'perigo' : 'ok',
                            () => atualizar(u.id, { ativo: !u.ativo }), souEu));
    if (bloqueado) acoes.append(' ', criarBotao('Desbloquear', '', () => atualizar(u.id, { desbloquear: true })));

    tr.append(
        celula(u.nome + (souEu ? ' (você)' : '')),
        celula(u.email),
        celula(select),
        celula(situacao),
        celula(formatarData(u.ultimo_login)),
        celula(formatarData(u.criado_em)),
        celula(acoes)
    );
    return tr;
}

async function carregar() {
    try {
        const usuarios = await apiFetch('/usuarios');
        corpo.replaceChildren(...usuarios.map(criarLinha));
    } catch (e) {
        mostrarMsg('Não foi possível carregar os usuários: ' + e.message, true);
    }
}

async function atualizar(id, mudancas) {
    try {
        await apiFetch(`/usuarios/${id}`, { method: 'PATCH', body: mudancas });
        mostrarMsg('Alteração salva.');
    } catch (e) {
        mostrarMsg(e.message, true);
    }
    await carregar();
}

document.addEventListener('DOMContentLoaded', carregar);