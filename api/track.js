// api/track.js — Vercel Serverless Function
// Recebe eventos do cliente via sendBeacon e repassa à Meta Conversions API
// Env vars necessárias no Vercel:
//   META_PIXEL_ID    → 4454501998095926
//   META_CAPI_TOKEN  → token gerado no Gerenciador de Eventos > Configurações
//   META_TEST_CODE   → (opcional) TEST95959 — remova em produção

const PIXEL_ID     = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;
const TEST_CODE    = process.env.META_TEST_CODE; // apenas para testes

async function readBody(req) {
  // Vercel já parseia JSON automaticamente em runtimes recentes,
  // mas fazemos fallback manual para garantir compatibilidade.
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk.toString()));
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

module.exports = async function handler(req, res) {
  // CORS — permite chamadas do domínio da landing page
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.error('[CAPI] Env vars ausentes: META_PIXEL_ID ou META_CAPI_TOKEN');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const body = await readBody(req);
  const { event_name, event_id, custom_data, fbp, fbc, page_url } = body;

  if (!event_name) return res.status(400).json({ error: 'event_name obrigatório' });

  // IP real via headers do Vercel (x-forwarded-for é populado automaticamente)
  const rawIp = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();
  const ua    = req.headers['user-agent'] || '';

  const eventObj = {
    event_name,
    event_time:        Math.floor(Date.now() / 1000),
    event_id:          event_id || `${event_name}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    action_source:     'website',
    event_source_url:  page_url || 'https://garagem-tuning.vercel.app',
    user_data: {
      ...(rawIp && { client_ip_address: rawIp }),
      ...(ua    && { client_user_agent: ua }),
      ...(fbp   && { fbp }),
      ...(fbc   && { fbc }),
    },
    ...(custom_data && { custom_data }),
  };

  const payload = {
    data: [eventObj],
    ...(TEST_CODE && { test_event_code: TEST_CODE }),
  };

  try {
    const apiRes = await fetch(
      `https://graph.facebook.com/v20.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      }
    );

    const result = await apiRes.json();

    if (!apiRes.ok) {
      console.error('[CAPI] Erro Meta:', JSON.stringify(result));
      return res.status(502).json({ ok: false, meta_error: result });
    }

    console.log(`[CAPI] ${event_name} | id=${eventObj.event_id} | received=${result.events_received}`);
    return res.status(200).json({ ok: true, events_received: result.events_received });

  } catch (err) {
    console.error('[CAPI] Fetch error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
