// kit.js - Sombra digital do kit LTR701 (desenho SVG em index.html).
// Usado pelos 3 modos (simulação local, MATLAB simulado e MATLAB + kit real): quem muda é só a FONTE dos dados.
//
//   Kit.atualizar({ temp, sp, ligado, aquecedor, fonte, perturbacao })
//     temp        temperatura em °C (null = sem dado)
//     sp          set point em °C (null = desconhecido)
//     ligado      true  => ventilador gira e o ar flui
//     aquecedor   0..1 (fração da tensão máx.); null => estimado (o MATLAB não envia o sinal de controle)
//     fonte       texto curto exibido no painel ("Simulação local", "MATLAB simulado", "MATLAB + kit")
//     perturbacao true => mostra o aviso de perturbação

const Kit = (() => {
    const $ = id => document.getElementById(id);

    // Azul (frio, ~20 °C) -> vermelho (quente, ~80 °C)
    function corAr(t) {
        const x = Math.min(1, Math.max(0, (t - 20) / 60));
        return `hsl(${Math.round(210 * (1 - x))}, 85%, 68%)`;
    }

    function corAquecedor(n) {
        return n <= 0.02 ? '#adb5bd' : `hsl(${Math.round(35 - 35 * n)}, 100%, ${Math.round(60 - 12 * n)}%)`;
    }

    function atualizar({ temp = null, sp = null, ligado = false, aquecedor = null, fonte = '--', perturbacao = false } = {}) {
        if (!$('kit')) return;
        const temDado = typeof temp === 'number' && isFinite(temp);
        const txt = temDado ? temp.toFixed(1) : '--.-';

        $('kit').classList.toggle('ligado', !!ligado);
        $('kit-ar').setAttribute('fill', temDado ? corAr(temp) : '#ced4da');

        // Aquecedor: valor real (simulação local) ou estimado (MATLAB só devolve a temperatura)
        let nivel = aquecedor, estimado = false;
        if (nivel === null || nivel === undefined) {
            estimado = true;
            nivel = !ligado || !temDado || sp === null ? 0 : (temp < sp - 0.3 ? 1 : 0.25);
        }
        nivel = Math.min(1, Math.max(0, nivel));
        const aq = $('kit-aq');
        aq.setAttribute('stroke', corAquecedor(nivel));
        aq.setAttribute('stroke-width', (5 + 2 * nivel).toFixed(1));
        $('kit-aq-nivel').textContent = Math.round(nivel * 100) + '%' + (estimado ? ' (estim.)' : '');

        $('kit-temp').textContent = txt;
        $('kit-temp-sensor').textContent = txt + ' °C';
        $('kit-sp').textContent = 'SP: ' + (sp === null || sp === undefined ? '--' : Number(sp).toFixed(1));
        const est = $('kit-estado');
        est.textContent = ligado ? 'LIGADO' : 'DESLIGADO';
        est.setAttribute('class', 'kit-estado ' + (ligado ? 'on' : 'off'));
        $('kit-fonte').textContent = fonte;
        $('kit-pert').setAttribute('visibility', perturbacao ? 'visible' : 'hidden');
    }

    return { atualizar };
})();