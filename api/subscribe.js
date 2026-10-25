// Inscription à la newsletter : ajoute l'e-mail dans la liste Brevo de Funax.
// Réglages dans Vercel : BREVO_API_KEY (clé API Brevo) et BREVO_LIST_ID (numéro de la liste).
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const key = process.env.BREVO_API_KEY;
  if (!key) return res.status(500).json({ error: 'La newsletter n’est pas encore configurée.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
    const contact = { email, updateEnabled: true };
    const list = Number(process.env.BREVO_LIST_ID);
    if (list) contact.listIds = [list];
    const r = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: { 'api-key': key, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(contact)
    });
    if (r.ok) return res.status(200).json({ ok: true });
    const d = await r.json().catch(() => ({}));
    if (d.code === 'duplicate_parameter') return res.status(200).json({ ok: true, already: true });
    res.status(502).json({ error: 'Inscription impossible pour le moment, réessaie plus tard. (Brevo : ' + (d.message || r.status) + ')' });
  } catch (e) {
    res.status(500).json({ error: 'Inscription impossible pour le moment, réessaie plus tard.' });
  }
};
