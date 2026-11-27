// simulacao.js - Página "Resposta (PID)"
// Três modos de operação, todos mostrando a sombra digital do kit (kit.js):
//   local    : planta G(z) + PI rodam AQUI no navegador (sem MATLAB). Parâmetros do enunciado no formulário.
//   simulada : MATLAB sem o kit (temperature_client_node.m) - a malha roda no MATLAB
//   real     : MATLAB + kit LTR701 (controle_kit_web.m)      - a malha roda no MATLAB
//   Web -> API -> TCP -> MATLAB : só "ligado" (0/1) e "setpoint"  (ganhos do PI NÃO vão ao MATLAB)
//   MATLAB -> TCP -> API -> Web : só a temperatura (evento "reading" do Socket.IO)
// Depende de main.js (registrarLog), kit.js e Chart.js.

// =====================================================================
// MODELO DO KIT (modo "local")  >>> SUBSTITUA pelos valores obtidos em LCON-I <<<
// G(z) = (b0 + b1 z^-1 + ...) / (1 + a1 z^-1 + ...), com entrada = tensão no aquecedor (V)
// e saída = variação de temperatura (°C) em relação à temperatura inicial.
//   y[k] = num[1]*u[k-1] + num[2]*u[k-2] + ... - den[1]*y[k-1] - den[2]*y[k-2] - ...
// num[0] deve ser 0 (a malha amostrada precisa de pelo menos 1 amostra de atraso).
// Os valores abaixo são APENAS um exemplo (1ª ordem: ganho 4 °C/V, constante de tempo 60 s).
// =====================================================================
const PLANTA = (() => {
    const Ts = 0.01;                     // período de amostragem do controle (100 Hz)
    const K = 1.387 / 0.2351;            // ganho estático (~5.90 °C/V)
    const tau = 1 / 0.2351;              // constante de tempo (~4.25 s)
    const a = Math.exp(-Ts / tau);
    return {
        Ts,
        num: [0, K * (1 - a)],           
        den: [1, -a]                     
    };
})();
const V_MIN = 0, V_MAX = 10;             // saturação do aquecedor (10 V)
const MAX_PONTOS_SIM = 2000;             // pontos desenhados (a simulação roda em Ts, o gráfico é decimado)

const CHAVE_SERIE = 'serie_historica';   // lida por estatistica.js (só recebe dados do MATLAB)
const MAX_PONTOS = 5000;

let chartTemp, chartSp, chartErro, chartControl;
let serie = [];                          // histórico {t, pv, sp, mv} (modos MATLAB)
let socket = null, ligado = false, carregando = false;
let tRef = null, ultimoTs = null;
let ultimaLeitura = null;                // {temp, sp, em} - última temperatura vinda do MATLAB
let modoCom = 'local';
const CHAVE_MODO = 'modo_com';
const SCRIPT_DO_MODO = {
    local: 'Planta G(z) e PI calculados no navegador; nada é enviado ao MATLAB.',
    simulada: 'Script esperado: temperature_client_node.m (simulação)',
    real: 'Script esperado: controle_kit_web.m (kit LTR701)'
};
const FONTE_DO_MODO = { local: 'Simulação local', simulada: 'MATLAB simulado', real: 'MATLAB + kit LTR701' };

const el = id => document.getElementById(id);

// ---------- Gráficos ----------
function criarGrafico(id, titulo, series) {
    return new Chart(el(id).getContext('2d'), {
        type: 'line',
        data: {
            labels: [],
            datasets: series.map(s => ({
                label: s.rotulo, data: [], borderColor: s.cor, borderWidth: 2,
                pointRadius: 0, tension: 0.2, borderDash: s.tracejado ? [6, 4] : []
            }))
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            plugins: { title: { display: true, text: titulo } },
            scales: { x: { title: { display: true, text: 'Tempo (s)' } } }
        }
    });
}

function addPonto(chart, t, valores, atualizar = true) {
    chart.data.labels.push(t);
    valores.forEach((v, i) => chart.data.datasets[i].data.push(v));
    if (chart.data.labels.length > MAX_PONTOS) {
        chart.data.labels.shift();
        chart.data.datasets.forEach(ds => ds.data.shift());
    }
    if (atualizar) chart.update('none');
}

const todosGraficos = () => [chartTemp, chartSp, chartErro, chartControl];

function limparGraficos() {
    todosGraficos().forEach(ch => {
        ch.data.labels = [];
        ch.data.datasets.forEach(ds => ds.data = []);
        ch.update('none');
    });
}

function salvarSerie() {
    try { localStorage.setItem(CHAVE_SERIE, JSON.stringify(serie)); } catch (e) { /* sem persistência */ }
}

// Recomeça os gráficos. Só os modos MATLAB mexem na série usada em "Séries Históricas".
function resetar() {
    tRef = null; ultimoTs = null;
    limparGraficos();
    if (modoCom !== 'local') { serie = []; salvarSerie(); }
}

// ---------- Sombra digital (kit) ----------
function redesenharKit() {
    if (modoCom === 'local') return;     // no modo local quem desenha é a simulação
    const fresca = ultimaLeitura && (Date.now() - ultimaLeitura.em) < 5000;
    Kit.atualizar({
        temp: fresca ? ultimaLeitura.temp : null,
        sp: ultimaLeitura ? ultimaLeitura.sp : null,
        ligado,
        aquecedor: null,                 // o MATLAB não envia o sinal de controle: o desenho estima
        fonte: fresca ? FONTE_DO_MODO[modoCom] : 'sem dados do MATLAB'
    });
}

function kitLocalParado() {
    const t0 = parseFloat(el('sim-t0').value);
    Kit.atualizar({ temp: isNaN(t0) ? null : t0, sp: parseFloat(el('sim-sp1').value), ligado: false,
                    aquecedor: 0, fonte: FONTE_DO_MODO.local });
}

// ---------- Interface ----------
function mostrarMsg(texto, erro = false) {
    const e = el('real-msg');
    e.className = 'tf-msg' + (erro ? ' erro' : '');
    e.textContent = texto;
}

function mostrarMsgSim(texto, erro = false) {
    const e = el('sim-msg');
    e.className = 'tf-msg' + (erro ? ' erro' : '');
    e.textContent = texto;
}

function mostrarBotao(estaLigado) {
    const btn = el('btn-status');
    btn.textContent = estaLigado ? 'Ligado' : 'Desligado';
    btn.className = estaLigado ? 'btn-on' : 'btn-off';
}

function aplicarModo() {
    document.body.dataset.modo = modoCom;
    el('modo-com').value = modoCom;
    el('modo-dica').textContent = SCRIPT_DO_MODO[modoCom];
    chartTemp.options.plugins.title.text = 'Temperatura (°C)';
    chartControl.options.plugins.title.text = 'Sinal de controle (V)';
    if (modoCom === 'local') kitLocalParado(); else redesenharKit();
}

// =====================================================================
// MODO LOCAL: simulação do kit + PI (sombra digital sem MATLAB)
// =====================================================================
function lerParametros() {
    const n = id => parseFloat(el(id).value);
    const p = {
        tf: n('sim-tf'), t0: n('sim-t0'), sp1: n('sim-sp1'), sp2: n('sim-sp2'),
        tSp2: n('sim-tsp2'), pert: n('sim-pert'), tPert: n('sim-tpert'), kp: n('sim-kp'), ki: n('sim-ki')
    };
    const erro = msg => { mostrarMsgSim(msg, true); return null; };
    if (Object.values(p).some(v => isNaN(v))) return erro('Preencha todos os campos.');
    if (!(p.tf > 0 && p.tf <= 3600)) return erro('Tempo final deve estar entre 0 e 3600 s.');
    if (!(p.t0 >= 0 && p.t0 < 100)) return erro('Temperatura inicial deve estar entre 0 e 100 °C.');
    if (!(p.sp1 > p.t0 && p.sp1 < 100)) return erro('Set point 1 deve ser maior que a temperatura inicial e menor que 100 °C.');
    if (!(p.sp2 > 0 && p.sp2 < 100)) return erro('Set point 2 deve ser menor que 100 °C.');
    if (!(p.tSp2 >= 0 && p.tSp2 <= p.tf)) return erro('A troca de set point deve ocorrer entre 0 e o tempo final.');
    if (!(p.tPert >= 0 && p.tPert <= p.tf)) return erro('A perturbação deve ocorrer entre 0 e o tempo final.');
    if (!(p.kp >= 0 && p.ki >= 0)) return erro('Kp e Ki devem ser maiores ou iguais a zero.');
    return p;
}

// Simula a malha fechada inteira (PI discreto com anti-windup + planta G(z)).
// A perturbação é somada à temperatura (perturbação de saída) e o PI precisa corrigi-la.
function simular(p) {
    const { Ts, num, den } = PLANTA;
    const N = Math.floor(p.tf / Ts) + 1;
    const dec = Math.max(1, Math.ceil(N / MAX_PONTOS_SIM));
    const u = new Float64Array(N), yd = new Float64Array(N);
    const r = { t: [], pv: [], sp: [], erro: [], mv: [], pert: [] };
    let integral = 0;

    for (let k = 0; k < N; k++) {
        const t = k * Ts;

        // Planta: variação de temperatura em relação a t0 (só usa amostras passadas de u)
        let y = 0;
        for (let i = 1; i < num.length; i++) if (k - i >= 0) y += num[i] * u[k - i];
        for (let i = 1; i < den.length; i++) if (k - i >= 0) y -= den[i] * yd[k - i];
        yd[k] = y;

        const perturb = t >= p.tPert ? p.pert : 0;
        const temp = p.t0 + y + perturb;
        const sp = t >= p.tSp2 ? p.sp2 : p.sp1;
        const erro = sp - temp;

        // PI discreto com saturação e anti-windup (integração condicional)
        const integralNova = integral + p.ki * Ts * erro;
        const uSemSat = p.kp * erro + integralNova;
        const uSat = Math.min(V_MAX, Math.max(V_MIN, uSemSat));
        const saturado = uSat !== uSemSat;
        const empurraParaFora = (uSemSat > uSat && erro > 0) || (uSemSat < uSat && erro < 0);
        if (!(saturado && empurraParaFora)) integral = integralNova;
        u[k] = uSat;

        if (k % dec === 0 || k === N - 1) {
            r.t.push(Math.round(t * 100) / 100);
            r.pv.push(temp); r.sp.push(sp); r.erro.push(erro); r.mv.push(uSat);
            r.pert.push(t >= p.tPert && p.pert !== 0);
        }
    }
    return r;
}

// Reprodução: desenha a resposta no tempo (1x, 5x, 20x ou instantânea), animando o kit
let sim = null, rafId = null;

function iniciarLocal() {
    const p = lerParametros();
    if (!p) return;
    pararLocal(false);
    resetar();
    const r = simular(p);
    sim = { r, p, i: 0, vel: Number(el('sim-vel').value), inicio: performance.now() };
    el('btn-simular').disabled = true;
    el('btn-parar').disabled = false;
    mostrarMsgSim('Simulando...');
    registrarLog('INFO', `Simulação local: tf=${p.tf}s T0=${p.t0} SP1=${p.sp1} SP2=${p.sp2}@${p.tSp2}s pert=${p.pert}@${p.tPert}s Kp=${p.kp} Ki=${p.ki}`);
    rafId = requestAnimationFrame(passoSimulacao);
}

function passoSimulacao(agora) {
    if (!sim) return;
    const { r, p } = sim;
    const tAlvo = sim.vel === 0 ? Infinity : ((agora - sim.inicio) / 1000) * sim.vel;
    const antes = sim.i;
    while (sim.i < r.t.length && r.t[sim.i] <= tAlvo) {
        const i = sim.i++;
        addPonto(chartTemp, r.t[i], [r.pv[i], r.sp[i]], false);
        addPonto(chartSp, r.t[i], [r.sp[i]], false);
        addPonto(chartErro, r.t[i], [r.erro[i]], false);
        addPonto(chartControl, r.t[i], [r.mv[i]], false);
    }
    if (sim.i > antes) {
        todosGraficos().forEach(ch => ch.update('none'));
        const i = sim.i - 1;
        Kit.atualizar({ temp: r.pv[i], sp: r.sp[i], ligado: true, aquecedor: r.mv[i] / V_MAX,
                        fonte: FONTE_DO_MODO.local, perturbacao: r.pert[i] });
        mostrarMsgSim(`t = ${r.t[i].toFixed(1)} s de ${p.tf} s`);
    }
    if (sim.i < r.t.length) { rafId = requestAnimationFrame(passoSimulacao); return; }

    // Fim: mantém o último ponto no kit (desligado) e libera os botões
    const i = r.t.length - 1;
    Kit.atualizar({ temp: r.pv[i], sp: r.sp[i], ligado: false, aquecedor: 0, fonte: FONTE_DO_MODO.local, perturbacao: r.pert[i] });
    mostrarMsgSim(`Simulação concluída (${p.tf} s).`);
    sim = null; rafId = null;
    el('btn-simular').disabled = false;
    el('btn-parar').disabled = true;
}

function pararLocal(mostrar = true) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    const estava = !!sim;
    sim = null;
    el('btn-simular').disabled = false;
    el('btn-parar').disabled = true;
    if (estava && mostrar) {
        mostrarMsgSim('Simulação interrompida.');
        const i = chartTemp.data.labels.length - 1;
        Kit.atualizar({ temp: i >= 0 ? chartTemp.data.datasets[0].data[i] : null, sp: i >= 0 ? chartTemp.data.datasets[1].data[i] : null,
                        ligado: false, aquecedor: 0, fonte: FONTE_DO_MODO.local });
    }
}

// =====================================================================
// MODOS COM MATLAB (simulado ou kit real)
// =====================================================================
// Leitura do banco ou do socket: { ts, temperatura, setpoint, ... }
function adicionarLeitura(l, atualizar = true) {
    if (l.temperatura === null || l.temperatura === undefined) return;
    const ms = Date.parse(l.ts);
    if (isNaN(ms) || (ultimoTs !== null && ms <= ultimoTs)) return;   // fora de ordem/duplicada
    if (tRef === null) tRef = ms;
    ultimoTs = ms;

    const t = Math.round((ms - tRef) / 100) / 10;          // s desde o 1º ponto exibido
    const sp = l.setpoint ?? null;
    const erro = sp === null ? null : Math.round((sp - l.temperatura) * 100) / 100;
    addPonto(chartTemp, t, [l.temperatura, sp], atualizar);
    addPonto(chartSp, t, [sp], atualizar);
    addPonto(chartErro, t, [erro], atualizar);

    serie.push({ t, pv: l.temperatura, sp, mv: null });    // usada em "Séries Históricas"
    if (serie.length > MAX_PONTOS) serie.shift();
    if (atualizar) salvarSerie();
    ultimaLeitura = { temp: l.temperatura, sp, em: ms };
    if (atualizar) { redesenharKit(); if (!carregando) mostrarMsg(''); }
}

function conectarSocket() {
    if (socket || typeof io !== 'function') return;
    socket = io({ auth: { token: getToken() } });
    socket.on('reading', l => { if (!carregando && modoCom !== 'local') adicionarLeitura(l); });
    // O servidor desliga o controle quando o MATLAB conecta/desconecta: mantém o botão sincronizado
    socket.on('config', c => {
        ligado = !!c.ligado;
        mostrarBotao(ligado);
        redesenharKit();
        if (c.motivo === 'matlab_conectado') mostrarMsg('MATLAB conectado. Controle desligado.');
        if (c.motivo === 'matlab_desconectado') mostrarMsg('MATLAB desconectado: controle desligado.', true);
    });
    socket.on('command:ack', () => mostrarMsg('Comando entregue ao MATLAB.'));
    socket.on('connect_error', e => mostrarMsg('Tempo real indisponível: ' + e.message, true));
}

async function carregarEstadoInicial() {
    carregando = true;
    try {
        const cfg = await apiFetch('/config');
        ligado = !!cfg.ligado;
        el('sp-real').value = cfg.setpoint;
        mostrarBotao(ligado);
        if (modoCom === 'local') return;

        // Últimas leituras do banco, para o gráfico não começar vazio
        const leituras = await apiFetch('/readings?limit=300');
        leituras.forEach(l => adicionarLeitura(l, false));
        todosGraficos().forEach(ch => ch.update('none'));
        salvarSerie();
        redesenharKit();
        mostrarMsg(leituras.length ? '' : 'Aguardando temperatura do MATLAB...');
    } catch (e) {
        mostrarMsg(e.message, true);
    } finally {
        carregando = false;
    }
}

async function enviarComando(nome, valor) {
    await apiFetch('/commands/add', { method: 'POST', body: { name: nome, value: valor } });
    registrarLog('INFO', `Comando enviado ao MATLAB: ${nome} = ${valor}`);
}

// Botão "Atualizar"
async function enviarSetpoint() {
    const sp = parseFloat(el('sp-real').value);
    if (!(sp > 0 && sp < 100)) return mostrarMsg('O setpoint deve estar entre 0 e 100 °C.', true);
    try {
        await enviarComando('setpoint', sp);
        mostrarMsg(`Setpoint ${sp} °C enviado ao MATLAB.`);
    } catch (e) {
        mostrarMsg(e.message, true);
    }
}

// Botão Ligado/Desligado. Ao ligar sem MATLAB conectado, a API responde 409 e a mensagem aparece aqui.
async function toggleSistema() {
    const btn = el('btn-status');
    const novo = ligado ? 0 : 1;
    btn.disabled = true;
    try {
        await enviarComando('ligado', novo);
        ligado = novo === 1;
        mostrarBotao(ligado);
        redesenharKit();
        mostrarMsg((ligado ? 'Ligar' : 'Desligar') + ' enviado ao MATLAB.');
    } catch (e) {
        mostrarMsg(e.message, true);
    } finally {
        btn.disabled = false;
    }
}

// Troca de modo: desliga o controle do MATLAB antes (segurança) e recomeça os gráficos
async function trocarModoCom() {
    const novo = el('modo-com').value;
    if (ligado && modoCom !== 'local') {
        try { await enviarComando('ligado', 0); ligado = false; mostrarBotao(false); }
        catch (e) { el('modo-com').value = modoCom; return mostrarMsg(e.message, true); }
    }
    pararLocal(false);
    modoCom = novo;
    try { localStorage.setItem(CHAVE_MODO, modoCom); } catch (e) { /* sem persistência */ }
    ultimaLeitura = null;
    resetar();
    aplicarModo();
    mostrarMsg(''); mostrarMsgSim('');
    registrarLog('INFO', 'Modo de operação: ' + modoCom);
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        const salvo = localStorage.getItem(CHAVE_MODO);
        if (salvo === 'real' || salvo === 'simulada' || salvo === 'local') modoCom = salvo;
    } catch (e) { /* padrão: local */ }

    chartTemp    = criarGrafico('graficoTemperatura', 'Temperatura (°C)',
                                [{ rotulo: 'Temperatura', cor: '#007bff' }, { rotulo: 'Set point', cor: '#dc3545', tracejado: true }]);
    chartSp      = criarGrafico('graficoSetpoint', 'Set point (°C)', [{ rotulo: 'Set point', cor: '#dc3545' }]);
    chartErro    = criarGrafico('graficoErro', 'Erro: set point − temperatura (°C)', [{ rotulo: 'Erro', cor: '#fd7e14' }]);
    chartControl = criarGrafico('graficoControle', 'Sinal de controle (V)', [{ rotulo: 'MV', cor: '#28a745' }]);

    // Pré-visualização do kit no modo local ao editar os campos
    ['sim-t0', 'sim-sp1'].forEach(id => el(id).addEventListener('input', () => { if (modoCom === 'local' && !sim) kitLocalParado(); }));

    aplicarModo();
    conectarSocket();
    carregarEstadoInicial();
    setInterval(redesenharKit, 1000);     // detecta MATLAB sem enviar dados (> 5 s)
});