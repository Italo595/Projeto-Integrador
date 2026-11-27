// cripto.js - AES-256-GCM. Formato gravado: "v1:<iv>:<tag>:<cifrado>" (base64)
const crypto = require('crypto');

const PREFIXO = 'v1:';
const hex = process.env.ENC_KEY || '';
if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('ENC_KEY deve ter 64 caracteres hexadecimais (32 bytes) no .env');
}
const KEY = Buffer.from(hex, 'hex');

function encText(texto) {
    if (texto === null || texto === undefined) return null;
    const iv = crypto.randomBytes(12);                       // IV novo a cada registro
    const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    const dados = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
    const tag = c.getAuthTag();
    return PREFIXO + [iv, tag, dados].map(b => b.toString('base64')).join(':');
}

function decText(valor) {
    if (valor === null || valor === undefined) return null;
    // Dado legado (gravado antes da criptografia): devolve como está
    if (typeof valor !== 'string' || !valor.startsWith(PREFIXO)) return valor;
    const [iv, tag, dados] = valor.slice(PREFIXO.length).split(':').map(p => Buffer.from(p, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    d.setAuthTag(tag);                                       // falha se o dado foi adulterado
    return Buffer.concat([d.update(dados), d.final()]).toString('utf8');
}

const encNum = n => (n === null || n === undefined ? null : encText(String(n)));
const decNum = s => { const t = decText(s); return t === null ? null : Number(t); };

module.exports = { encText, decText, encNum, decNum };