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
      mensaje: '🚨 Dirección inválida'
    });
  }

  const explorers = {
    ethereum: 'https://api.etherscan.io/api',
    arbitrum: 'https://api.arbiscan.io/api',
    polygon: 'https://api.polygonscan.com/api'
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

    res.json({
      verificado,
      nombre,
      compilador,
      mensaje: verificado ? '✅ Contrato verificado — código fuente visible' : '🚨 Contrato NO verificado'
    });

  } catch (error) {
    res.status(500).json({ error: 'Error al analizar: ' + error.message });
  }
});

app.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});