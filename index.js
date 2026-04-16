const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const https = require('https');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const initDB = async () => { try { await pool.query("CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, plan VARCHAR(50) DEFAULT 'gratis', analisis_usados INTEGER DEFAULT 0, fecha_reset TIMESTAMP DEFAULT NOW(), created_at TIMESTAMP DEFAULT NOW())"); console.log('DB lista'); } catch(e) { console.error(e); } };
initDB();

const app = express();
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({ windowMs: 60 * 1000, max: 20 });
app.use(limiter);

app.post('/webhook', express.raw({type:'application/json'}), async(req,res)=>{
  const sig = req.headers['stripe-signature'];
  try {
    const event = require('stripe')(process.env.STRIPE_SECRET_KEY).webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email = session.customer_email || session.customer_details?.email;
      if (email) await pool.query("UPDATE usuarios SET plan='premium' WHERE email=$1", [email]);
    }

    if (event.type === 'invoice.payment_succeeded') {
      const email = event.data.object.customer_email;
      if (email) await pool.query(
        "UPDATE usuarios SET analisis_usados = 0, fecha_reset = NOW() WHERE email=$1",
        [email]
      );
    }

    res.json({ received: true });
  } catch(err) {
    res.status(400).send('Error');
  }
});

app.use(express.json({ limit: '1mb' }));
app.get('/', (req, res) => { res.sendFile(__dirname + '/public/landing.html'); });
app.use(express.static('public'));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

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
  // Limpiar backticks y markdown
  let cleaned = text
    .replace(/^json\s*/i, '')
    .replace(/^\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  // Intentar parsear directo
  try {
    return JSON.parse(cleaned);
  } catch(e1) {}

  // Buscar JSON dentro del texto
  try {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch(e2) {}

  // Extraer campos manualmente si el JSON esta roto
  try {
    const result = {};
    const fields = ['seguridad', 'razon_seguridad', 'explicacion1', 'explicacion2', 'explicacion3', 'explicacion4', 'codigo'];
    for (const field of fields) {
      const regex = new RegExp('"' + field + '"\\s*:\\s*"((?:[^"\\\\]|\\\\[\\s\\S])*)"', 's');
      const match = cleaned.match(regex);
      if (match) {
        result[field] = match[1]
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      }
    }
    if (result.seguridad || result.explicacion1) return result;
  } catch(e3) {}

  throw new Error('No se pudo parsear la respuesta');
}

app.post('/analizar-gratis', async (req, res) => {
  try {
    const { address, network } = req.body;
    if (!address) return res.status(400).json({ error: 'Direccion requerida' });
    if (!isEthAddress(address)) return res.status(400).json({ error: 'Direccion Ethereum invalida' });
    const key = process.env.ETHERSCAN_KEY;
    if (!key) return res.status(500).json({ error: 'Falta ETHERSCAN_KEY en variables' });
    const chainIds = { eth: '1', arb: '42161', pol: '137', bsc: '56' };
    const chainId = chainIds[network] || '1';
    const url = 'https://api.etherscan.io/v2/api?chainid=' + chainId + '&module=contract&action=getsourcecode&address=' + address + '&apikey=' + key;
    const data = await fetchJson(url);
    const r = data.result[0];
    return res.json({
      nombre: r.ContractName || 'Sin nombre',
      compilador: r.CompilerVersion || 'N/A',
      verificado: !!r.SourceCode,
      mensaje: r.SourceCode ? 'Contrato encontrado' : 'Contrato no verificado'
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/analizar-pago', async (req, res) => {
  try {
    const { codigo, accion, descripcion } = req.body;
    const accionesValidas = ["generar","corregir","analizar"];
    const tokenHeader = req.headers["authorization"];
    if (!tokenHeader) return res.status(401).json({ error: "No autorizado" });
    const token = tokenHeader.split(" ")[1];
    let userId;
    try { const decoded = require("jsonwebtoken").verify(token, process.env.JWT_SECRET); userId = decoded.id; } catch { return res.status(401).json({ error: "Token invalido" }); }
    const userResult = await pool.query("SELECT analisis_usados, plan, fecha_reset FROM usuarios WHERE id=$1", [userId]);
    const user = userResult.rows[0];
    const ahora = new Date(); const fechaReset = new Date(user.fecha_reset); const diffDias = (ahora - fechaReset) / (1000 * 60 * 60 * 24); if (diffDias >= 30) { await pool.query("UPDATE usuarios SET analisis_usados = 0, fecha_reset = NOW() WHERE id=$1", [userId]); user.analisis_usados = 0; }
    if (user.plan !== 'premium') return res.status(403).json({ error: 'Se requiere plan Premium' });
    if (user.plan === "premium" && user.analisis_usados >= 29) return res.status(403).json({ error: "Limite de 29 analisis alcanzado. Renueva tu suscripcion." });
    await pool.query("UPDATE usuarios SET analisis_usados = analisis_usados + 1 WHERE id=$1", [userId]);
    if (!accionesValidas.includes(accion)) return res.status(400).json({ error: 'Accion invalida' });
    if (accion !== 'generar' && (!codigo || codigo.length < 40)) return res.status(400).json({ error: 'Codigo muy corto' });
    if (accion !== 'generar' && codigo.length > 15000) return res.status(400).json({ error: 'Codigo demasiado largo' });
    if (accion === 'generar' && !descripcion) return res.status(400).json({ error: 'Descripcion requerida para generar' });

    let prompt = '';
    if (accion === 'generar') {
      prompt = 'PASO 1: Analiza la descripcion e identifica tipo de contrato (ERC-20, ERC-721, staking, escrow, DAO u otro). PASO 2: Genera contrato completo con Solidity >=0.8.0, SPDX license, OpenZeppelin si aplica, modificadores de acceso correctos, eventos en funciones de estado, require() en todos los inputs. PASO 3: Revisa buscando reentrancy, acceso sin control, inputs sin validar y corrige antes de responder. PASO 4: Responde UNICAMENTE JSON: {seguridad, razon_seguridad, explicacion1, explicacion2, explicacion3, explicacion4, codigo}. Descripcion: ' + descripcion + '.';
    } else if (accion === 'corregir') {
      prompt = 'PASO 1: Diagnostica...codigo}. Contrato: ' + codigo.substring(0, 7000);
    } else {
    prompt = 'PASO 1: Identifica tipo de contrato (ERC-20, ERC-721, DeFi, DAO u otro) y librerias usadas. PASO 2: Busca vulnerabilidades criticas: reentrancy, overflow, acceso sin control, tx.origin, delegatecall inseguro. PASO 3: Busca riesgos medios: eventos faltantes, inputs sin validar, magic numbers. PASO 4: Asigna ALTO sin criticos, MEDIO con riesgos menores, BAJO con vulnerabilidad critica. Responde UNICAMENTE JSON: {seguridad, razon_seguridad, explicacion1, explicacion2, explicacion3, explicacion4}. Contrato: ' + codigo.substring(0, 7000);
    }

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 7000,
      system: 'Eres un Smart Contract Auditor Senior especializado en seguridad blockchain, equivalente a CertiK y PeckShield. Analizas contratos Solidity para Latinoamerica en espanol profesional. REGLAS: 1) Solo JSON valido, sin markdown ni backticks. 2) Campo codigo usa \\n para saltos. 3) Analiza SOLO el codigo dado, nunca inventes. 4) Si no puedes determinarlo escribe: No se puede determinar. 5) Sin garantias legales ni financieras.',
      messages: [{ role: 'user', content: prompt }]
    });

    const text = msg.content && msg.content[0] && msg.content[0].text || '';

    let resultado;
    try {
      resultado = safeParseJson(text);
    } catch {
      resultado = {
        seguridad: 'MEDIO',
        razon_seguridad: 'Analisis completado',
        explicacion1: text.substring(0, 500),
        explicacion2: '', explicacion3: '', explicacion4: ''
      };
    }

    return res.json({
      nombre: accion === 'generar' ? 'Contrato Generado' : 'Analisis Premium',
      compilador: 'N/A',
      mensaje: 'Analisis completado',
      analisis: resultado,
      modo: accion || 'analizar'
    });

  } catch (err) {
    console.error(err);
    if (err.status === 429) return res.status(429).json({ error: 'Limite de API alcanzado. Intenta mas tarde.' });
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

app.post('/crear-pago', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'CryptoLatino Analyzer - Plan Mensual',
            description: 'Analisis ilimitados por 30 dias'
          },
          unit_amount: 2500,
          recurring: { interval: 'month' }
        },
        quantity: 1
      }],
      mode: 'subscription',
      success_url: 'https://cryptolatino-analyzer-production.up.railway.app/success',
      cancel_url: 'https://cryptolatino-analyzer-production.up.railway.app/cancel'
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creando pago' });
  }
});

app.post('/registro', async (req, res) => {
  const { email, password } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO usuarios (email, password) VALUES ($1, $2)', [email, hash]);
    res.json({ ok: true, mensaje: 'Cuenta creada exitosamente' });
  } catch (err) {
    res.status(400).json({ error: 'Email ya registrado' });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (!result.rows.length) return res.status(401).json({ error: 'Usuario no encontrado' });
    const usuario = result.rows[0];
    const valido = await bcrypt.compare(password, usuario.password);
    if (!valido) return res.status(401).json({ error: 'Contrasena incorrecta' });
    const token = jwt.sign({ id: usuario.id, plan: usuario.plan }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ ok: true, token, plan: usuario.plan });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/success', (req, res) => {
  res.sendFile(__dirname + '/public/success.html');
});

app.get('/cancel', (req, res) => {
  res.sendFile(__dirname + '/public/cancel.html');
});

app.listen(3000, () => console.log('Servidor en puerto 3000'));