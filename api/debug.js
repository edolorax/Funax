// Diagnostic : liste brute des produits Printful (nom, nombre de variantes, statut). Ne montre aucune donnée secrète.
const { pf } = require('./_shared');

module.exports = async (req, res) => {
  try {
    const list = await pf('/store/products?limit=100');
    const out = await Promise.all(list.map(async p => {
      const d = await pf('/store/products/' + p.id);
      const st = {};
      d.sync_variants.forEach(v => { const k = v.availability_status || 'inconnu'; st[k] = (st[k] || 0) + 1; });
      return { nom: JSON.stringify(p.name), variantes: d.sync_variants.length, synchronisees: p.synced, statuts: st };
    }));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ total: list.length, produits: out });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
