const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const https = require('https');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function isEthAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('HTTP ' + res.statusCode));
        }
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Respuesta invalida de Etherscan')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('Timeout')));
  });
}

function safeParseJson(text) {
  const cleaned = text.replace(/json|/g, '').trim();
  return JSON.parse(cleaned);
}

app.post('/analizar-gratis', async (req, res) => {
  try {
    const { address } = req.body;

    if (!address) return res.status(400).json({ error: 'Direccion requerida' });
    if (!isEthAddress(address)) return res.status(400).json({ error: 'Direccion Ethereum invalida' });

    const key = process.env.ETHERSCAN_KEY;
    if (!key) return res.status(500).json({ error: 'Falta ETHERSCAN_API_KEY en variables' });

    const url = 'https://api.etherscan.io/api?module=contract&action=getsourcecode&address=' + address + '&apikey=' + key;
    const data = await fetchJson(url);

    if (data.status !== '1' || !Array.isArray(data.result) || !data.result[0]) {
      return res.status(404).json({ error: 'Contrato no encontrado o no verificado' });
    }

    const r = data.result[0];
    return res.json({
      nombre: r.ContractName || 'Sin nombre',
      compilador: r.CompilerVersion || 'N/A',
      mensaje: r.SourceCode ? 'Contrato encontrado' : 'Contrato no verificado'
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/analizar-pago', async (req, res) => {
  try {
    const { codigo, accion, descripcion } = req.body;

    if (accion !== 'generar' && (!codigo || codigo.length < 40)) {
      return res.status(400).json({ error: 'Codigo muy corto' });
    }
    if (accion === 'generar' && !descripcion) {
      return res.status(400).json({ error: 'Descripcion requerida para generar' });
    }

    let prompt = '';
    if (accion === 'generar') {
      prompt = 'Genera un smart contract Solidity completo basado en: ' + descripcion + '. Responde SOLO con JSON valido con estas claves: seguridad, razon_seguridad, explicacion1, explicacion2, explicacion3, explicacion4, codigo.';
    } else if (accion === 'corregir') {
      prompt = 'Corrige este contrato Solidity. Responde SOLO con JSON valido con estas claves: seguridad, razon_seguridad, explicacion1, explicacion2, explicacion3, explicacion4, codigo. Contrato: ' + codigo.substring(0, 7000);
    } else {
      prompt = 'Analiza este contrato Solidity en espanol. Responde SOLO con JSON valido con estas claves: seguridad, razon_seguridad, explicacion1, explicacion2, explicacion3, explicacion4. Contrato: ' + codigo.substring(0, 7000);
    }

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: 'Eres un auditor experto de smart contracts. Respondes UNICAMENTE con JSON valido, sin markdown ni texto adicional.',
      messages: [{ role: 'user', content: prompt }]
    });

    const text = msg.content && msg.content[0] && msg.content[0].text || '';

    let resultado;
    try {
      resultado = safeParseJson(text);
    } catch {
      resultado = {
        seguridad: 'MEDIO',
        razon_seguridad: 'No se pudo parsear JSON',
        explicacion1: text,
        explicacion2: '', explicacion3: '', explicacion4: ''
      };
    }

    return res.json({
      nombre: accion === 'generar' ? 'Contrato Generado' : 'Analisis Premium',
      mensaje: 'Analisis completado',
      analisis: resultado,
      modo: accion || 'analizar'
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log('Servidor en puerto 3000'));