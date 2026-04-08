const express = require('express');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const app = express();
app.use(express.json());
app.use(express.static('public'));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const explorers = {
  ethereum: 'https://api.etherscan.io/api',
  arbitrum: 'https://api.arbiscan.io/api',
  polygon: 'https://api.polygonscan.com/api'
};

app.post('/analizar', async (req, res) => {
  try {
    const { contrato, red } = req.body;
    if (!contrato || !contrato.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.json({ verificado: false, nombre: 'N/A', compilador: 'N/A', mensaje: 'Direccion invalida' });
    }
    const url = explorers[red] || explorers.ethereum;
    const apikey = process.env.ETHERSCAN_API_KEY || '6TTVEGR1VHT8SCRTVBSMH2BB3WJME5H87I';
    const response = await axios.get(url, {
      params: { module: 'contract', action: 'getsourcecode', address: contrato, apikey }
    });
    const data = response.data.result[0];
    const nombre = data.ContractName || 'Desconocido';
    const compilador = data.CompilerVersion || 'N/A';
    const verificado = data.SourceCode !== '';
    let analisis = 'Contrato no verificado.';
    if (verificado && data.SourceCode) {
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Analiza este smart contract en espanol. Di que hace, riesgos, nivel BAJO/MEDIO/ALTO. Codigo: ' + data.SourceCode.substring(0, 3000) }]
      });
      analisis = msg.content[0].text;
    }
    res.json({ verificado, nombre, compilador, analisis, mensaje: verificado ? 'Contrato verificado' : 'Contrato NO verificado' });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

app.listen(3000, () => console.log('Puerto 3000'));