const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const https = require('https');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const initDB = async () => { try { await pool.query("CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, plan VARCHAR(50) DEFAULT 'gratis', analisis_usados INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())"); console.log('DB lista'); } catch(e) { console.error(e); } };
initDB();

const app = express();
app.post('/webhook', express.raw({type:'application/json'}), async(req,res)=>{ const sig=req.headers['stripe-signature']; try{ const event=require('stripe')(process.env.STRIPE_SECRET_KEY).webhooks.constructEvent(req.body,sig,process.env.STRIPE_WEBHOOK_SECRET); if(event.type==='invoice.paid'){const email=event.data.object.customer_email; if(email) await pool.query("UPDATE usuarios SET plan='premium' WHERE email=$1",[email]);} res.json({received:true}); }catch(err){res.status(400).send('Error');} });
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

// Headers de seguridad
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
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(text);
  } catch (e) {
    console.error('Error parseando JSON:', text.substring(0, 300));
    throw e;
  }
}

app.post('/analizar-gratis', async (req, res) => {
  try {
    const { address,network } = req.body;

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

    const accionesValidas = ['generar', 'corregir', 'analizar'];
    if (!accionesValidas.includes(accion)) {
      return res.status(400).json({ error: 'Accion invalida' });
    }

    if (accion !== 'generar' && (!codigo || codigo.length < 40)) {
      return res.status(400).json({ error: 'Codigo muy corto' });
    }
    if (accion !== 'generar' && codigo.length > 15000) {
      return res.status(400).json({ error: 'Codigo demasiado largo' });
    }
    if (accion === 'generar' && !descripcion) {
      return res.status(400).json({ error: 'Descripcion requerida para generar' });
    }

    let prompt = '';
    if (accion === 'generar') {
      prompt = 'Genera un smart contract Solidity completo basado en: ' + descripcion + '. Responde SOLO con JSON valido con estas claves: seguridad, razon_seguridad, explicacion1, explicacion2, explicacion3, explicacion4, codigo.';
    } else if (accion === 'corregir') {
      prompt = 'Corrige este contrato Solidity. Responde SOLO con JSON valido con estas claves: seguridad, razon_seguridad, explicacion1, explicacion2, explicacion3, explicacion4, codigo. Contrato: ' + codigo.substring(0, 7000);
    } else {
      prompt = 'Analiza este contrato Solidity en espanol. Responde SOLO con JSON valido con estas claves: seguridad, razon_seguridad, explicacion1, explicacion2, explicacion3, explicacion4. Contrato: ' + codigo.substring(0, 7000);
    }

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      system: 'Eres un auditor experto de smart contracts. Respondes UNICAMENTE con JSON valido, sin markdown ni texto adicional.',
      messages: [{ role: 'user', content: prompt }]
    });

    const text = msg.content && msg.content[0] && msg.content[0].text || '';

    let resultado;
    try {
      resultado = safeParseJson(text);
    } catch {
      resultado = {
        seguridad: 'MEDIO',
        razon_seguridad: 'No se pudo parsear JSON',
        explicacion1: text,
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
    if (err.status === 429) {
      return res.status(429).json({ error: 'Limite de API alcanzado. Intenta mas tarde.' });
    }
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Crear sesión de pago
app.post('/crear-pago', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'CryptoLatino Analyzer - Plan Mensual',
            description: 'Análisis ilimitados por 30 días'
          },
          unit_amount: 2900,
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
    if (!valido) return res.status(401).json({ error: 'Contraseña incorrecta' });
    const token = jwt.sign({ id: usuario.id, plan: usuario.plan }, 'secreto123', { expiresIn: '30d' });
    res.json({ ok: true, token, plan: usuario.plan });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});
app.listen(3000, () => console.log('Servidor en puerto 3000'));