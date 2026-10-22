// Prévenu par Stripe quand un paiement est terminé (même si le client ferme la page avant le retour).
// Par sécurité, on ne croit pas le contenu reçu : on relit l'événement directement chez Stripe.
const { stripe, createOrderFromSession } = require('./_shared');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (!body.id) return res.status(400).json({ error: 'Événement invalide' });
    const event = await stripe('/events/' + encodeURIComponent(body.id));
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      await createOrderFromSession(event.data.object.id);
    }
    res.status(200).json({ received: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
