// Appelée au retour du paiement : vérifie chez Stripe que c'est payé, puis envoie la commande à Printful.
const { createOrderFromSession } = require('./_shared');

module.exports = async (req, res) => {
  const id = req.query && req.query.session_id;
  if (!id) return res.status(400).json({ error: 'session_id manquant' });
  try {
    const r = await createOrderFromSession(String(id));
    res.status(200).json({ ok: r.ok, email: r.email || null, status: r.status || null });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
