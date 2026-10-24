// Liste les produits de la boutique Printful "Funax" pour le site.
const { getProductsCached } = require('./_shared');

module.exports = async (req, res) => {
  if (!process.env.PRINTFUL_TOKEN) return res.status(500).json({ error: 'PRINTFUL_TOKEN manquant dans Vercel' });
  try {
    const products = await getProductsCached();
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=86400');
    res.status(200).json({ products });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
