const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const https = require('https');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

app.post('/analizar-gratis', async (req, res) => {
  try {
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: 'Dirección requerida' });

    const apiKey = process.env.ETHERSCAN_API_KEY;
    const url = https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${address}&apikey=${apiKey};

    const data = await httpsGet(url);
    const result = data.result?.[0];

    if (!result || result.SourceCode === '') {
      return res.json({
        nombre: 'No verificado',
        compilador: 'N/A',
        mensaje: '⚠️ Contrato no verificado en Etherscan'
      });
    }

    res.json({
      nombre: result.ContractName || 'Sin nombre',
      compilador: result.CompilerVersion || 'N/A',
      mensaje: '✅ Contrato encontrado'
    });

  } catch (err) {
    console.error('Error gratis:', err.message);
    res.status(500).json({ error: 'Error al consultar Etherscan' });
  }
});

app.post('/analizar-pago', async (req, res) => {
  try {
    const { codigo, accion, descripcion } = req.body;

    if (accion !== 'generar' && (!codigo || codigo.length < 40)) {
      return res.status(400).json({ error: 'Código muy corto' });
    }

    let prompt = '';
    if (accion === 'generar' && descripcion) {
      prompt = Genera un smart contract Solidity completo y seguro basado en: ${descripcion}. Responde SOLO con JSON: {"seguridad":"ALTO","razon_seguridad":"...","explicacion1":"...","explicacion2":"...","explicacion3":"...","explicacion4":"...","codigo":"// code"};
    } else if (accion === 'corregir') {
      prompt = Corrige y optimiza este contrato Solidity. Responde SOLO con JSON: {"seguridad":"ALTO","razon_seguridad":"...","explicacion1":"...","explicacion2":"...","explicacion3":"...","explicacion4":"...","codigo":"// code"}. Contrato: ${codigo.substring(0, 7000)};
    } else {
      prompt = Analiza este smart contract en español. Responde SOLO con JSON: {"seguridad":"ALTO","razon_seguridad":"...","explicacion1":"Qué hace","explicacion2":"Funciones","explicacion3":"Riesgos","explicacion4":"Recomendaciones"}. Contrato: ${codigo.substring(0, 7000)};
    }

    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    let resultado;
    try {
      const text = msg.content[0].text.replace(/json|/g, '').trim();
      resultado = JSON.parse(text);
    } catch (e) {
      resultado = {
        seguridad: 'MEDIO',
        razon_seguridad: 'Análisis completado',
        explicacion1: msg.content[0].text,
        explicacion2: '', explicacion3: '', explicacion4: ''
      };
    }

    res.json({
      nombre: accion === 'generar' ? 'Contrato Generado' : 'Análisis Premium',
      mensaje: '✅ Análisis completado',
      analisis: resultado,
      modo: accion || 'analizar'
    });

  } catch (err) {
    console.error('Error premium:', err.message);
    res.status(500).json({ error: 'Error al procesar con Claude' });
  }
});

app.listen(3000, () => {
  console.log('🚀 Servidor corriendo en puerto 3000');
});