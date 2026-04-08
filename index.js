Aconst express = require('express');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
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
    const response = await axios.get(url, {
      params: {
        module: 'contract',
        action: 'getsourcecode',
        address: contrato,
        apikey: '6TTVEGR1VHT8SCRTVBSMH2BB3WJME5H87I'
      }
    });

    const data = response.data.result[0];
    const nombre = data.ContractName || 'Desconocido';
    const compilador = data.CompilerVersion || 'N/A';
    const verificado = data.SourceCode !== '';
    let analisis = 'Contrato no verificado.';

    if (verificado && data.SourceCode) {
      const codigo = data.SourceCode.substring(0, 3000);
      const prompt = 'Analiza este smart contract en español. Di: 1) Que hace 2) Riesgos 3) Nivel BAJO/MEDIO/ALTO. Codigo: ' + codigo;
      const msg = await anthropic.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      });
      analisis = msg.content[0].text;
    }

    res.json({ verificado, nombre, compilador, analisis,
      mensaje: verificado ? 'Contrato verificado' : 'Contrato NO verificado'
    });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

app.listen(3000, () => console.log('Servidor en puerto 3000'));