const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());
app.use(express.static('public'));

app.post('/analizar', async (req, res) => {
  const { contrato, red } = req.body;

  if (!contrato || !contrato.match(/^0x[a-fA-F0-9]{40}$/)) {
    return res.json({
      verificado: false,
      nombre: 'N/A',
      compilador: 'N/A',
      mensaje: '🚨 Dirección inválida',
      analisis: ''
    });
  }

  const explorers = {
    ethereum: 'https://api.etherscan.io/v2/api?chainid=1',
    arbitrum: 'https://api.etherscan.io/v2/api?chainid=42161',
    polygon: 'https://api.etherscan.io/v2/api?chainid=137'
  };

  try {
    const url = explorers[red] || explorers.ethereum;
    const apikey = process.env.ETHERSCAN_API_KEY || '6TTVEGR1VHT8SCRTVBSMH2BB3WJM9QIZZM';
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
    let analisis = '';

    if (verificado && data.SourceCode) {
      const codigo = data.SourceCode.substring(0, 3000);
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      const aiResponse = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: Analiza este smart contract y responde en español. Sé breve y claro:\n1. ¿Qué hace este contrato?\n2. ¿Es seguro? ¿Tiene riesgos?\n3. Recomendación final\n\nCódigo:\n${codigo}
        }]
      }, {
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      });
      analisis = aiResponse.data.content[0].text;
    }

    res.json({ verificado, nombre, compilador, mensaje: verificado ? '✅ Contrato verificado — código fuente visible' : '🚨 Contrato NO verificado', analisis });

  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

app.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});