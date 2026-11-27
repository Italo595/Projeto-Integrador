// estatistica.js - Página "Séries Históricas"
// Lê a série salva por simulacao.js e calcula as estatísticas descritivas da temperatura (PV).

const CHAVE_SERIE = 'serie_historica';
let chartHistorico = null;
let serieBanco = null;   // série restaurada do banco (null = usa a série da simulação)

function lerSerie() {
    try {
        return JSON.parse(localStorage.getItem(CHAVE_SERIE)) || [];
    } catch (e) {
        return [];
    }
}

function obterSerie() {
    return serieBanco || lerSerie();
}

// Quantil com interpolação linear (vetor já ordenado)
function quantil(ord, q) {
    const pos = (ord.length - 1) * q;
    const i = Math.floor(pos), f = pos - i;
    return ord[i + 1] !== undefined ? ord[i] + f * (ord[i + 1] - ord[i]) : ord[i];
}

function calcularEstatisticas(x) {
    const n = x.length;
    const media = x.reduce((s, v) => s + v, 0) / n;
    const m2 = x.reduce((s, v) => s + (v - media) ** 2, 0) / n;
    const m3 = x.reduce((s, v) => s + (v - media) ** 3, 0) / n;
    const m4 = x.reduce((s, v) => s + (v - media) ** 4, 0) / n;
    const variancia = n > 1 ? m2 * n / (n - 1) : 0;          // amostral
    const dp = Math.sqrt(variancia);
    const assimetria = m2 > 0 ? m3 / Math.pow(m2, 1.5) : 0;
    const curtose = m2 > 0 ? m4 / (m2 * m2) - 3 : 0;         // curtose em excesso

    // Outliers pelo critério de Tukey (1,5 · IQR)
    const ord = [...x].sort((a, b) => a - b);
    const q1 = quantil(ord, 0.25), q3 = quantil(ord, 0.75), iqr = q3 - q1;
    const inf = q1 - 1.5 * iqr, sup = q3 + 1.5 * iqr;
    const idxOutliers = [];
    x.forEach((v, i) => { if (v < inf || v > sup) idxOutliers.push(i); });

    return { media, variancia, dp, assimetria, curtose, idxOutliers };
}

function mostrar(id, valor) {
    document.getElementById(id).textContent = valor;
}

function criarHistorico(labels, pv, outliers) {
    return new Chart(document.getElementById('graficoHistorico').getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Temperatura (°C)', data: pv, borderColor: '#007bff', borderWidth: 2, pointRadius: 0, tension: 0.2 },
                { label: 'Outliers', data: outliers, showLine: false, pointRadius: 5,
                  pointBackgroundColor: '#dc3545', borderColor: '#dc3545' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            scales: { x: { title: { display: true, text: 'Tempo (s)' } } }
        }
    });
}

function renderizar() {
    const serie = obterSerie();
    const campos = ['stat-media', 'stat-var', 'stat-dp', 'stat-assimetria', 'stat-curtose', 'stat-outliers'];

    if (chartHistorico) chartHistorico.destroy();

    if (serie.length === 0) {
        campos.forEach(id => mostrar(id, '--'));
        chartHistorico = criarHistorico([], [], []);
        return;
    }

    const pv = serie.map(p => p.pv);
    const est = calcularEstatisticas(pv);

    mostrar('stat-media', est.media.toFixed(2));
    mostrar('stat-var', est.variancia.toFixed(2));
    mostrar('stat-dp', est.dp.toFixed(2));
    mostrar('stat-assimetria', est.assimetria.toFixed(3));
    mostrar('stat-curtose', est.curtose.toFixed(3));
    mostrar('stat-outliers', String(est.idxOutliers.length));

    const marcados = pv.map((v, i) => est.idxOutliers.includes(i) ? v : null);
    chartHistorico = criarHistorico(serie.map(p => p.t), pv, marcados);
}

// ---------- Restauração a partir do banco (somente admin) ----------
function mensagem(texto, erro = false) {
    const el = document.getElementById('rest-msg');
    el.className = 'rest-msg' + (erro ? ' erro' : '');
    el.textContent = texto;
}

async function restaurarDoBanco() {
    const btn = document.getElementById('btn-restaurar');
    const params = new URLSearchParams();
    const de = document.getElementById('rest-de').value;
    const ate = document.getElementById('rest-ate').value;
    if (de) params.set('de', new Date(de).toISOString());
    if (ate) params.set('ate', new Date(ate).toISOString());
    params.set('limit', document.getElementById('rest-limite').value || 5000);

    btn.disabled = true;
    mensagem('Carregando...');
    try {
        const r = await apiFetch('/historico?' + params.toString());
        if (r.retornados === 0) {
            mensagem('Nenhuma leitura encontrada nesse período.', true);
            return;
        }
        const t0 = Date.parse(r.pontos[0].ts);
        serieBanco = r.pontos.map(p => ({
            t: Math.round((Date.parse(p.ts) - t0) / 100) / 10,   // segundos desde a 1ª leitura
            pv: p.temperatura, sp: p.setpoint, mv: p.pwm
        }));
        renderizar();
        mensagem(`Série restaurada do banco (${r.device_id}): ${r.retornados} de ${r.total} leituras` +
                 (r.retornados < r.total ? ' (as mais recentes do período).' : '.'));
    } catch (e) {
        mensagem(e.message, true);
    } finally {
        btn.disabled = false;
    }
}

function usarSerieLocal() {
    serieBanco = null;
    renderizar();
    mensagem('Exibindo a série da simulação local.');
}

document.addEventListener('DOMContentLoaded', () => {
    renderizar();

    if (ehAdmin()) {
        document.getElementById('painel-restauracao').hidden = false;
        document.getElementById('btn-restaurar').addEventListener('click', restaurarDoBanco);
        document.getElementById('btn-local').addEventListener('click', usarSerieLocal);
    }

    // Atualiza se a simulação estiver rodando em outra aba (só quando exibindo a série local)
    window.addEventListener('storage', e => { if (e.key === CHAVE_SERIE && !serieBanco) renderizar(); });
});