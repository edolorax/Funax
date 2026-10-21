// Récupère les produits de la boutique Printful "Funax" et les renvoie au site.
// La clé PRINTFUL_TOKEN reste sur le serveur (variable d'environnement Vercel).
const API = 'https://api.printful.com';

async function pf(path, token) {
  const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + token } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data && data.error && data.error.message) || ('Printful ' + r.status));
  return data.result;
}

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', 'XXL', '3XL', '4XL', '5XL'];

module.exports = async (req, res) => {
  const token = process.env.PRINTFUL_TOKEN;
  if (!token) return res.status(500).json({ error: 'PRINTFUL_TOKEN manquant dans Vercel' });
  try {
    const list = await pf('/store/products?limit=100', token);
    const details = await Promise.all(list.map(p => pf('/store/products/' + p.id, token)));

    // Codes couleur depuis le catalogue Printful (un appel par modèle de T-shirt)
    const catalogIds = [...new Set(details.flatMap(d => d.sync_variants.map(v => v.product && v.product.product_id)).filter(Boolean))];
    const colorCode = {};
    await Promise.all(catalogIds.map(async id => {
      try {
        const c = await pf('/products/' + id, token);
        (c.variants || []).forEach(v => { colorCode[v.id] = v.color_code; });
      } catch (e) { /* pas grave : on garde une couleur neutre */ }
    }));

    // Les produits portant le même nom (ex. version texte noir + texte blanc) sont regroupés
    const byName = new Map();
    for (const d of details) {
      const name = (d.sync_product.name || 'T-shirt').replace(/\s*[-–(].*(noir|blanc|black|white).*$/i, '').trim();
      if (!byName.has(name)) byName.set(name, { id: d.sync_product.id, name, thumbnail: d.sync_product.thumbnail_url, variants: [] });
      const prod = byName.get(name);
      for (const v of d.sync_variants) {
        if (v.availability_status && v.availability_status !== 'active') continue;
        const preview = (v.files || []).find(f => f.type === 'preview');
        prod.variants.push({
          id: v.id,
          color: v.color || (v.name || '').split('/').slice(-2, -1)[0] || 'Couleur',
          size: v.size || (v.name || '').split('/').pop().trim(),
          hex: colorCode[v.variant_id] || '#888888',
          price: Number(v.retail_price) || null,
          currency: v.currency || 'EUR',
          image: (preview && preview.preview_url) || (v.product && v.product.image) || d.sync_product.thumbnail_url
        });
      }
    }

    const products = [...byName.values()].filter(p => p.variants.length).map(p => {
      const colors = [];
      for (const v of p.variants) if (!colors.some(c => c.name === v.color)) colors.push({ name: v.color, hex: v.hex, image: v.image });
      const sizes = [...new Set(p.variants.map(v => v.size))].sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b));
      const prices = p.variants.map(v => v.price).filter(Boolean);
      return { ...p, colors, sizes, price: prices.length ? Math.min(...prices) : null, currency: p.variants[0].currency };
    });

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ products });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
