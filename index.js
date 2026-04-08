const express = require('express');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const app = express();
app.use(express.json());
app.use(express.static('public'));
const anthropic = new Anthropic({
  apiKey: 'sk-ant-api03-7_CU85qhqKJnshbDHJMQVfPC291djiEQep8UY0_kV3PDn4JXtESW-WMoUyOY1ScQj097379fXGYcZpoUR2wCNg-BLAjgQAA'
});
const explorers = {
  ethereum: 'https://api.etherscan.io/api',
  bsc: 'https://api.bscscan.com/api',
  polygon: 'https://api.polygonscan.com/api',
  arbitrum: 'https://api.arbiscan.io/api'
};

app.post('/analizar', async (req, res) => {
  try {
    const { contrato, red } = req.body;
    const url = explorers[red] || explorers.ethereum;
    const apikey = process.env.ETHERSCAN_API_KEY || '6TTVEGR1VHT8SCRTVBSMH2BB3WJME5H87I';
    const response = await axios.get(url, {
      params: {
        module: 'contract',
        action: 'getsourcecode',
        address: contrato,
        apikey: apikey
      }
    });
    const data = response.data.result[0];
    const nombre = data.ContractName && data.ContractName !== '' ? data.ContractName : 'Desconocido';
    const compilador = data.CompilerVersion && data.CompilerVersion !== '' ? data.CompilerVersion : 'N/A';
    const verificado = data.SourceCode !== '';

    let analisis = 'Contrato no verificado - no se puede analizar el código fuente.';
    
    if (verificado && data.SourceCode) {
      const codigoCorto = data.SourceCode.substring(0, 3000);
      const mensaje_ia = await anthropic.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: Eres un experto en seguridad de smart contracts. Analiza este contrato de Solidity en español y da un resumen de: 1) Qué hace el contrato 2) Riesgos de seguridad encontrados 3) Nivel de riesgo (BAJO/MEDIO/ALTO). Código: ${codigoCorto}
        }]
      });
      analisis = mensaje_ia.content[0].text;
    }
    res.json({
      verificado,
      nombre,
      compilador,
      analisis,
      mensaje: verificado ? '✅ Contrato verificado — código fuente visible' : '🚨 Contrato NO verificado'
    });

  } catch (error) {
    res.status(500).json({ error: 'Error al analizar: ' + error.message });
  }
});

app.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});