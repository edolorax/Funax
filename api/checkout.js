// Crée la page de paiement Stripe à partir du panier. Les prix sont relus chez Printful (jamais ceux envoyés par le navigateur).
const { SHIP, COUNTRIES, stripe, getProducts } = require('./_shared');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'STRIPE_SECRET_KEY manquant dans Vercel' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const items = (body.items || []).filter(i => i && i.variantId && i.qty > 0).slice(0, 20);
    if (!items.length) return res.status(400).json({ error: 'Ton panier est vide.' });

    const products = await getProducts();
    const all = new Map();
    products.forEach(p => p.variants.forEach(v => all.set(String(v.id), { ...v, product: p.name })));

    const lines = []; let qty = 0, subtotal = 0;
    for (const it of items) {
      const v = all.get(String(it.variantId));
      if (!v || !v.price) return res.status(400).json({ error: 'Un article de ton panier n’est plus disponible.' });
      const q = Math.max(1, Math.min(10, Math.floor(it.qty)));
      qty += q; subtotal += Math.round(v.price * 100) * q;
      lines.push({ v, q });
    }
    const ship = subtotal >= SHIP.freeFrom ? 0 : SHIP.base + SHIP.extra * (qty - 1);
    const origin = req.headers.origin || ('https://' + req.headers.host);

    const session = await stripe('/checkout/sessions', {
      mode: 'payment',
      locale: 'fr',
      line_items: lines.map(({ v, q }) => ({
        quantity: q,
        price_data: {
          currency: (v.currency || 'EUR').toLowerCase(),
          unit_amount: Math.round(v.price * 100),
          product_data: { name: `${v.product} – ${v.color}, taille ${v.size}`, images: v.image ? [v.image] : undefined }
        }
      })),
      shipping_address_collection: { allowed_countries: COUNTRIES },
      shipping_options: [{
        shipping_rate_data: {
          type: 'fixed_amount',
          display_name: ship ? 'Livraison standard' : 'Livraison offerte',
          fixed_amount: { amount: ship, currency: 'eur' },
          delivery_estimate: { minimum: { unit: 'business_day', value: 3 }, maximum: { unit: 'business_day', value: 7 } }
        }
      }],
      metadata: { items: JSON.stringify(lines.map(({ v, q }) => [v.id, q])) },
      success_url: origin + '/?commande=ok&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: origin + '/?commande=annulee'
    });
    res.status(200).json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
