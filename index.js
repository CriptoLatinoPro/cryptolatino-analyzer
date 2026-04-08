const express = require('express');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const explorers = {
  ethereum: 'https://api.etherscan.io/api',
  bsc: 'https://api.bscscan.com/api',
  polygon: 'https://api.polygonscan.com/api',
  arbitrum: 'https://api.arbiscan.io/api',
};

app.post('/analizar-gratis', async (req, res) => {
  try {
    const { contrato, red } = req.body;
    if (!contrato || !/0x[a-fA-F0-9]{40}/.test(contrato)) {
      return res.status(400).json({ error: 'Direccion invalida' });
    }
    const url = explorers[red] || explorers.ethereum;
    const response = await axios.get(url, {
      params: { module: 'contract', action: 'getsourcecode', address: contrato, apikey: process.env.ETHERSCAN_API_KEY || '6TTVEGR1VHT8SCRTVBSMH2BB3WJME5H87I' }
    });
    if (response.data.status !== '1' || !response.data.result?.[0]) {
      return res.json({ verificado: false, mensaje: 'Contrato no encontrado' });
    }
    const data = response.data.result[0];
    const verificado = !!data.SourceCode;
    if (!verificado) return res.json({ verificado: false, mensaje: 'Contrato NO verificado' });
    const codigo = data.SourceCode.length > 4000 ? data.SourceCode.substring(0, 4000) : data.SourceCode;
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{ role: 'user', content: 'Analiza este smart contract Solidity en espanol. Responde SOLO en JSON valido: {"seguridad":"BAJO o MEDIO o ALTO","razon_seguridad":"explicacion","explicacion1":"que hace","explicacion2":"funciones principales","explicacion3":"variables y riesgos","explicacion4":"recomendaciones"} Codigo: ' + codigo }]
    });
    const analisis = JSON.parse(msg.content[0].text);
    res.json({ verificado: true, nombre: data.ContractName || 'Desconocido', compilador: data.CompilerVersion || 'N/A', analisis, mensaje: 'Contrato verificado' });
  } catch (err) {
    res.status(500).json({ error: 'Error: ' + err.message });
  }
});

app.post('/analizar-pago', async (req, res) => {
  try {
    const { codigo, accion, descripcion } = req.body;
    if (!codigo || codigo.length < 50) return res.status(400).json({ error: 'Codigo muy corto' });
    let prompt = '';
    if (accion === 'generar' && descripcion) {
      prompt = 'Genera un smart contract Solidity completo y seguro segun esta descripcion: ' + descripcion;
    } else if (accion === 'corregir') {
      prompt = 'Corrige y optimiza este contrato Solidity: ' + codigo;
    } else {
      prompt = 'Analiza este smart contract en espanol. Responde SOLO en JSON: {"seguridad":"BAJO o MEDIO o ALTO","razon_seguridad":"explicacion","explicacion1":"que hace","explicacion2":"funciones","explicacion3":"riesgos","explicacion4":"recomendaciones","codigo_corregido":"codigo corregido si aplica"} Codigo: ' + codigo;
    }
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    });
    let resultado;
    try { resultado = JSON.parse(msg.content[0].text); }
    catch { resultado = { texto: msg.content[0].text }; }
    res.json({ modo: accion || 'analizar', analisis: resultado, mensaje: 'Analisis Premium completado' });
  } catch (err) {
    res.status(500).json({ error: 'Error: ' + err.message });
  }
});

app.listen(3000, () => console.log('Puerto 3000'));