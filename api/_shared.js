// Code commun aux fonctions serveur (les fichiers qui commencent par _ ne sont pas des pages publiques).
const crypto = require('crypto');

// Réglages de la livraison (en centimes)
const SHIP = { base: 490, extra: 150, freeFrom: 6000 };
const COUNTRIES = ['FR', 'BE', 'LU', 'CH', 'MC'];

// Réductions automatiques selon le nombre de T-shirts dans la commande (hors livraison)
const PACKS = [
  { min: 5, pct: 30, id: 'FUNAX-PACK-30', name: 'Pack 5 T-shirts et plus (-30 %)' },
  { min: 2, pct: 20, id: 'FUNAX-PACK-20', name: 'Pack 2 T-shirts et plus (-20 %)' }
];
const packFor = qty => PACKS.find(p => qty >= p.min) || null;

async function pf(path, opts = {}) {
  const r = await fetch('https://api.printful.com' + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + process.env.PRINTFUL_TOKEN, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d.error && d.error.message) || (typeof d.result === 'string' && d.result) || ('Printful ' + r.status));
  return d.result;
}

function encode(o, p, out = []) {
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null) continue;
    const key = p ? `${p}[${k}]` : k;
    if (typeof v === 'object') encode(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v));
  }
  return out.join('&');
}

async function stripe(path, params) {
  const r = await fetch('https://api.stripe.com/v1' + path, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-06-20'
    },
    body: params ? encode(params) : undefined
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d.error && d.error.message) || ('Stripe ' + r.status));
  return d;
}

const FR = { 'White':'Blanc','Black':'Noir','Navy':'Marine','Athletic Heather':'Gris chiné','Dark Grey Heather':'Gris foncé chiné','Heather Dust':'Sable chiné','Asphalt':'Asphalte','Army':'Kaki','Olive':'Olive','Forest':'Vert forêt','Kelly':'Vert','Leaf':'Vert feuille','Red':'Rouge','Cardinal':'Bordeaux','Maroon':'Bordeaux foncé','Pink':'Rose','Soft Pink':'Rose pâle','Coral':'Corail','Orange':'Orange','Gold':'Or','Yellow':'Jaune','Mustard':'Moutarde','Natural':'Naturel','Soft Cream':'Crème','Tan':'Beige','Brown':'Marron','Team Purple':'Violet','Purple':'Violet','Lavender':'Lavande','Heather Prism Lilac':'Lilas chiné','True Royal':'Bleu roi','Royal':'Bleu roi','Light Blue':'Bleu clair','Baby Blue':'Bleu ciel','Steel Blue':'Bleu acier','Aqua':'Turquoise','Ash':'Gris cendre','Silver':'Argent','Charcoal':'Anthracite','Heather Navy':'Marine chiné','Heather Mauve':'Mauve chiné','Vintage White':'Blanc vintage' };
const fr = c => FR[c] || c;
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', 'XXL', '3XL', '4XL', '5XL'];

async function getProducts() {
  const list = await pf('/store/products?limit=100');
  const details = await Promise.all(list.map(p => pf('/store/products/' + p.id)));
  const catalogIds = [...new Set(details.flatMap(d => d.sync_variants.map(v => v.product && v.product.product_id)).filter(Boolean))];
  const colorCode = {};
  await Promise.all(catalogIds.map(async id => {
    try { const c = await pf('/products/' + id); (c.variants || []).forEach(v => { colorCode[v.id] = v.color_code; }); } catch (e) {}
  }));
  const byName = new Map();
  for (const d of details) {
    const name = (d.sync_product.name || 'T-shirt').replace(/\s*[-–(].*(noir|blanc|black|white).*$/i, '').trim();
    if (!byName.has(name)) byName.set(name, { id: d.sync_product.id, name, thumbnail: d.sync_product.thumbnail_url, variants: [] });
    const prod = byName.get(name);
    for (const v of d.sync_variants) {
      if (v.availability_status && v.availability_status !== 'active') continue;
      const preview = (v.files || []).find(f => f.type === 'preview');
      const fFront = (v.files || []).find(f => f.type === 'default' || f.type === 'front');
      const fBack = (v.files || []).find(f => f.type === 'back');
      prod.variants.push({
        id: v.id,
        color: fr((v.color || (v.name || '').split('/').slice(-2, -1)[0] || 'Couleur').trim()),
        size: v.size || (v.name || '').split('/').pop().trim(),
        hex: colorCode[v.variant_id] || '#888888',
        price: Number(v.retail_price) || null,
        currency: v.currency || 'EUR',
        image: (preview && preview.preview_url) || (v.product && v.product.image) || d.sync_product.thumbnail_url,
        front: fFront ? (fFront.preview_url || fFront.url) : null,
        back: fBack ? (fBack.preview_url || fBack.url) : null
      });
    }
  }
  return [...byName.values()].filter(p => p.variants.length).map(p => {
    const colors = [];
    for (const v of p.variants) if (!colors.some(c => c.name === v.color)) colors.push({ name: v.color, hex: v.hex, image: v.image, front: v.front, back: v.back });
    const sizes = [...new Set(p.variants.map(v => v.size))].sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b));
    const prices = p.variants.map(v => v.price).filter(Boolean);
    return { ...p, colors, sizes, price: prices.length ? Math.min(...prices) : null, currency: p.variants[0].currency };
  });
}

// Mémoire : on évite d'interroger Printful à chaque visite (Printful limite le nombre de requêtes par minute).
let CACHE = { t: 0, data: null };
async function getProductsCached(maxAge = 5 * 60 * 1000) {
  if (CACHE.data && Date.now() - CACHE.t < maxAge) return CACHE.data;
  try {
    const data = await getProducts();
    CACHE = { t: Date.now(), data };
    return data;
  } catch (e) {
    if (CACHE.data) return CACHE.data; // Printful indisponible ou limite atteinte : on garde la dernière version
    throw e;
  }
}

// Crée la commande Printful à partir d'un paiement Stripe validé (sans doublon).
async function createOrderFromSession(sessionId) {
  const s = await stripe('/checkout/sessions/' + encodeURIComponent(sessionId));
  if (s.payment_status !== 'paid') return { ok: false, status: s.payment_status };
  const md = s.metadata || {};
  const raw = md.items || Object.keys(md).filter(k => /^items_\d+$/.test(k)).sort((a, b) => a.split('_')[1] - b.split('_')[1]).map(k => md[k]).join('');
  const items = JSON.parse(raw || '[]').filter(([id]) => Number.isFinite(Number(id)));
  // Commande sans T-shirt (ex. jeu de cartes seul) : rien à envoyer à Printful
  if (!items.length) return { ok: true, email: s.customer_details && s.customer_details.email };
  const sh = s.shipping_details || (s.collected_information && s.collected_information.shipping_details);
  if (!sh || !sh.address) throw new Error('Adresse de livraison absente');
  const a = sh.address;
  const order = {
    external_id: crypto.createHash('md5').update(s.id).digest('hex'),
    shipping: 'STANDARD',
    recipient: {
      name: sh.name, address1: a.line1, address2: a.line2 || undefined, city: a.city,
      state_code: a.state || undefined, country_code: a.country, zip: a.postal_code,
      email: s.customer_details && s.customer_details.email
    },
    items: items.map(([id, q]) => ({ sync_variant_id: id, quantity: q }))
  };
  const confirm = process.env.PRINTFUL_AUTO_CONFIRM === '1' ? 'true' : 'false';
  try {
    const r = await pf('/orders?confirm=' + confirm, { method: 'POST', body: JSON.stringify(order) });
    return { ok: true, orderId: r.id, email: order.recipient.email };
  } catch (e) {
    if (/external/i.test(e.message) && /(exist|already|unique|use)/i.test(e.message)) return { ok: true, already: true, email: order.recipient.email };
    throw e;
  }
}

// Crée le coupon Stripe de la réduction s'il n'existe pas encore (une seule fois par mode test / réel)
async function ensureCoupon(pack) {
  try { return await stripe('/coupons/' + pack.id); }
  catch (e) {
    if (!/no such coupon/i.test(e.message)) throw e;
    return stripe('/coupons', { id: pack.id, percent_off: pack.pct, duration: 'once', name: pack.name });
  }
}

module.exports = { SHIP, COUNTRIES, PACKS, packFor, ensureCoupon, pf, stripe, getProducts, getProductsCached, createOrderFromSession };
