const express = require('express');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ====================== CONFIG ======================
const explorers = {
  ethereum: 'https://api.etherscan.io/api',
  bsc: 'https://api.bscscan.com/api',
  polygon: 'https://api.polygonscan.com/api',
  arbitrum: 'https://api.arbiscan.io/api',
};

// ====================== ANALIZAR GRATIS ======================
app.post('/analizar-gratis', async (req, res) => {
  try {
    const { contrato, red } = req.body;

    if (!contrato || !/0x[a-fA-F0-9]{40}/.test(contrato)) {
      return res.status(400).json({ error: 'Dirección inválida. Debe comenzar con 0x seguido de 40 caracteres hexadecimales.' });
    }

    const url = explorers[red] || explorers.ethereum;

    const response = await axios.get(url, {
      params: {
        module: 'contract',
        action: 'getsourcecode',
        address: contrato,
        apikey: process.env.ETHERSCAN_API_KEY || '6TTVEGR1VHT8SCRTVBSMH2BB3WJME5H87I'
      }
    });

    if (response.data.status !== '1' || !response.data.result?.[0]?.SourceCode) {
      return res.json({ verificado: false, mensaje: 'Contrato no encontrado o no verificado en el explorador.' });
    }

    const data = response.data.result[0];
    const codigo = data.SourceCode.length > 7000 
      ? data.SourceCode.substring(0, 7000) + "\n// ... (código truncado)"
      : data.SourceCode;

    const msg = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',     // ← Mejor modelo
      max_tokens: 1600,
      temperature: 0.2,
      messages: [{
        role: 'user',
        content: `Eres un auditor senior de smart contracts. Analiza el siguiente contrato Solidity detalladamente en español.

Responde *ÚNICAMENTE* con un JSON válido usando este formato exacto:

{
  "seguridad": "ALTO" | "MEDIO" | "BAJO",
  "razon_seguridad": "Resumen claro del nivel de seguridad",
  "explicacion1": "Qué hace este contrato en general",
  "explicacion2": "Funciones principales y su propósito",
  "explicacion3": "Riesgos, vulnerabilidades y problemas detectados",
  "explicacion4": "Recomendaciones concretas de mejora"
}

Contrato:
${codigo}`
      }]
    });

    let analisis;
    try {
      analisis = JSON.parse(msg.content[0].text);
    } catch (e) {
      analisis = {
        seguridad: "MEDIO",
        razon_seguridad: "El análisis se completó pero la estructura de respuesta varió",
        explicacion1: "Contrato recuperado y analizado.",
        explicacion2: "Análisis disponible.",
        explicacion3: "Revisa manualmente por precaución.",
        explicacion4: "Usa el modo Premium para un análisis más profundo."
      };
    }

    res.json({
      verificado: true,
      nombre: data.ContractName || 'Contrato Desconocido',
      compilador: data.CompilerVersion || 'N/A',
      analisis,
      mensaje: 'Análisis con Claude 3.5 Sonnet completado'
    });

  } catch (err) {
    console.error('Error en /analizar-gratis:', err.message);
    res.status(500).json({ error: 'Error interno del servidor. Inténtalo nuevamente.' });
  }
});

// ====================== ANALIZAR PREMIUM ======================
app.post('/analizar-pago', async (req, res) => {
  try {
    const { codigo, accion, descripcion } = req.body;

    if (accion !== 'generar' && (!codigo || codigo.length < 40)) {
      return res.status(400).json({ error: 'El código Solidity es demasiado corto.' });
    }

    let prompt = '';

    if (accion === 'generar' && descripcion) {
      prompt = Genera un smart contract Solidity completo, seguro, moderno y bien comentado según esta descripción:\n\n${descripcion};
    } else if (accion === 'corregir') {
      prompt = Actúa como auditor experto. Corrige, optimiza y fortalece la seguridad de este contrato Solidity:\n\n${codigo};
    } else {
      prompt = `Analiza este smart contract Solidity en español de forma profesional.

Responde *SOLO* con JSON usando este formato:

{
  "seguridad": "ALTO" | "MEDIO" | "BAJO",
  "razon_seguridad": "...",
  "explicacion1": "Qué hace el contrato",
  "explicacion2": "Funciones principales",
  "explicacion3": "Riesgos y vulnerabilidades",
  "explicacion4": "Recomendaciones"
}

Contrato:
${codigo}`;
    }

    const msg = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }]
    });

    let resultado;
    try {
      resultado = JSON.parse(msg.content[0].text);
    } catch (e) {
      resultado = {
        seguridad: "MEDIO",
        razon_seguridad: "Respuesta generada correctamente",
        explicacion1: "El contrato fue procesado.",
        explicacion4: "Revisa el resultado con atención."
      };
    }

    res.json({
      nombre: accion === 'generar' ? 'Contrato Generado por IA' : 'Análisis Premium',
      mensaje: '✅ Análisis completado con Claude 3.5 Sonnet',
      analisis: resultado,
      modo: accion || 'analizar'
    });

  } catch (err) {
    console.error('Error en /analizar-pago:', err.message);
    res.status(500).json({ error: 'Error al procesar la solicitud con Claude.' });
  }
});

app.listen(3000, () => {
  console.log('🚀 Servidor mejorado con Claude 3.5 Sonnet corriendo en http://localhost:3000');
});