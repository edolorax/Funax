// Crée la page de paiement Stripe à partir du panier. Les prix sont relus chez Printful (jamais ceux envoyés par le navigateur).
const { SHIP, COUNTRIES, packFor, stripe, getProductsCached } = require('./_shared');

// Lit la liste des produits depuis notre propre page /api/products (déjà en cache), pour ne pas solliciter Printful à chaque paiement.
async function loadProducts(req) {
  try {
    const r = await fetch('https://' + req.headers.host + '/api/products');
    if (r.ok) { const d = await r.json(); if (d.products && d.products.length) return d.products; }
  } catch (e) {}
  return getProductsCached();
}

// Stripe limite chaque info à 500 caractères : on découpe la liste des articles en plusieurs morceaux.
function chunkMeta(str) {
  const meta = {};
  for (let i = 0, n = 0; i < str.length; i += 480, n++) meta['items_' + n] = str.slice(i, i + 480);
  return meta;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'STRIPE_SECRET_KEY manquant dans Vercel' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const items = (body.items || []).filter(i => i && i.variantId && i.qty > 0).slice(0, 80);
    if (!items.length) return res.status(400).json({ error: 'Ton panier est vide.' });

    // Jeu de cartes : prix fixé ici, côté serveur
    const GAME = { id: 'jeu6', name: 'Le jeu des 6 familles de la manif (24 cartes, en sachet)', price: 1999 };
    const origin = req.headers.origin || ('https://' + req.headers.host);

    const tees = items.filter(i => String(i.variantId) !== GAME.id), games = items.filter(i => String(i.variantId) === GAME.id);
    const all = new Map();
    if (tees.length) {
      const products = await loadProducts(req);
      products.forEach(p => p.variants.forEach(v => all.set(String(v.id), { ...v, product: p.name })));
    }
    const lines = []; let teeQty = 0, teeSub = 0;
    for (const it of tees) {
      const v = all.get(String(it.variantId));
      if (!v || !v.price) return res.status(400).json({ error: 'Un article de ton panier n’est plus disponible.' });
      const q = Math.max(1, Math.min(50, Math.floor(it.qty)));
      teeQty += q; teeSub += Math.round(v.price * 100) * q;
      lines.push({ v, q });
    }
    const gameQty = games.reduce((n, g) => n + Math.max(1, Math.min(50, Math.floor(g.qty))), 0);
    // Réduction pack : uniquement sur les T-shirts (appliquée directement au prix unitaire)
    const pack = packFor(teeQty), k = pack ? (100 - pack.pct) / 100 : 1;
    const merch = Math.round(teeSub * k) + gameQty * GAME.price, qty = teeQty + gameQty;
    const ship = merch >= SHIP.freeFrom ? 0 : SHIP.base + SHIP.extra * (qty - 1);

    const line_items = lines.map(({ v, q }) => ({
      quantity: q,
      price_data: {
        currency: 'eur',
        unit_amount: Math.round(Math.round(v.price * 100) * k),
        product_data: { name: `${v.product} – ${v.color}, taille ${v.size}` + (pack ? ` (pack -${pack.pct} %)` : ''), images: v.image ? [v.image] : undefined }
      }
    }));
    if (gameQty) line_items.push({ quantity: gameQty, price_data: { currency: 'eur', unit_amount: GAME.price, product_data: { name: GAME.name, images: [origin + '/cartes/dos.png'] } } });
    const meta = chunkMeta(JSON.stringify(lines.map(({ v, q }) => [v.id, q])));
    if (gameQty) meta.jeu_6_familles = String(gameQty);

    const session = await stripe('/checkout/sessions', {
      mode: 'payment',
      locale: 'fr',
      line_items,
      shipping_address_collection: { allowed_countries: COUNTRIES },
      phone_number_collection: gameQty ? { enabled: true } : undefined,
      shipping_options: [{
        shipping_rate_data: {
          type: 'fixed_amount',
          display_name: ship ? 'Livraison standard' : 'Livraison offerte',
          fixed_amount: { amount: ship, currency: 'eur' },
          delivery_estimate: { minimum: { unit: 'business_day', value: 3 }, maximum: { unit: 'business_day', value: 7 } }
        }
      }],
      metadata: meta,
      success_url: origin + '/?commande=ok&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: origin + '/?commande=annulee'
    });
    res.status(200).json({ url: session.url });
  } catch (e) {
    const msg = String(e.message || e);
    res.status(500).json({ error: /too many requests/i.test(msg) ? 'Beaucoup de monde en ce moment : réessaie dans une minute.' : msg });
  }
};
