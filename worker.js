// Cloudflare Worker — receives Arborr "Request access" form submissions
// and creates a row in the Notion "📥 Access Requests" database.
//
// Required environment variables (set as Worker secrets):
//   NOTION_TOKEN     — Notion integration token (starts with "ntn_" or "secret_")
//   NOTION_DB_ID     — Database ID: 55538c1950ae429aad59d9772edd0a9c
//   ALLOWED_ORIGIN   — e.g. "https://arborr.com" (or "*" while testing)
//
// Deploy:
//   npm i -g wrangler
//   wrangler login
//   wrangler deploy worker.js --name arborr-leads
//   wrangler secret put NOTION_TOKEN
//   wrangler secret put NOTION_DB_ID
//   wrangler secret put ALLOWED_ORIGIN

const SIZE_MAP = {
  '1-10':       '1 – 10',
  '11-50':      '11 – 50',
  '51-200':     '51 – 200',
  '201-500':    '201 – 500',
  '501-1000':   '501 – 1000',
  '1001-5000':  '1001 – 5000',
  '5000+':      '5000+',
};

const VALID_INDUSTRIES = new Set([
  'Financial services', 'Insurance', 'Healthcare & life sciences',
  'Manufacturing & industrial', 'Retail & e-commerce', 'Technology & software',
  'Professional services', 'Energy & utilities', 'Logistics & transportation',
  'Public sector', 'Education', 'Media & telecommunications',
]);

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, cors);
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'Invalid JSON' }, 400, cors); }

    const company  = (body.company  || '').trim().slice(0, 200);
    const email    = (body.email    || '').trim().slice(0, 200);
    const size     = (body.size     || '').trim();
    const industry = (body.industry || '').trim();

    if (!company || !email || !size || !industry) {
      return json({ error: 'Missing required field' }, 400, cors);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Invalid email' }, 400, cors);
    }
    const sizeLabel = SIZE_MAP[size];
    if (!sizeLabel) return json({ error: 'Invalid size' }, 400, cors);
    if (!VALID_INDUSTRIES.has(industry)) {
      return json({ error: 'Invalid industry' }, 400, cors);
    }

    const notionRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: env.NOTION_DB_ID },
        properties: {
          'Company':      { title: [{ text: { content: company } }] },
          'Email':        { email },
          'Company Size': { select: { name: sizeLabel } },
          'Industry':     { select: { name: industry } },
          'Status':       { status: { name: 'Not started' } },
        },
      }),
    });

    if (!notionRes.ok) {
      const detail = await notionRes.text();
      console.error('Notion API error:', notionRes.status, detail);
      return json({ error: 'Could not save lead' }, 502, cors);
    }

    const page = await notionRes.json();
    return json({ ok: true, id: page.id }, 200, cors);
  },
};

function json(payload, status, headers) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
