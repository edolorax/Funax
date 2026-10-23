// Liste les produits de la boutique Printful "Funax" pour le site.
const { getProducts } = require('./_shared');

module.exports = async (req, res) => {
  if (!process.env.PRINTFUL_TOKEN) return res.status(500).json({ error: 'PRINTFUL_TOKEN manquant dans Vercel' });
  try {
    const products = await getProducts();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    res.status(200).json({ products });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
