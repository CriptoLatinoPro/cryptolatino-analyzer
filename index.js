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
      mensaje: '🚨 Dirección inválida — debe ser 0x seguido de 40 caracteres'
    });
  }

  const explorers = {
    ethereum: 'https://api.etherscan.io/api',
    arbitrum: 'https://api.arbiscan.io/api',
    polygon: 'https://api.polygonscan.com/api'
  };

  try {
    const url = explorers[red] || explorers.ethereum;
    const response = await axios.get(url, {
      params: {
        module: 'contract',
        action: 'getsourcecode',
        address: contrato,
        apikey: '6TTVEGR1VHT8SCRTVBSMH2BB3WJM9QIZZM'
      }
    });

    const data = response.data.result[0];
    const verificado = data.SourceCode !== '';

    res.json({
      verificado,
      nombre: data.ContractName || 'Desconocido',
      compilador: data.CompilerVersion || 'N/A',
      mensaje: verificado
        ? '✅ Contrato verificado — código fuente visible'
        : '🚨 Contrato NO verificado — alto riesgo'
    });

  } catch (error) {
    res.status(500).json({ error: 'Error al analizar el contrato' });
  }
});

app.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});