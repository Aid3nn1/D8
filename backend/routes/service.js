// ================================================================
//  ROUTES SERVICE — prise/fin de service, historique
// ================================================================
const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { requireAuth, requireRole } = require('../middleware/permissions');
const { toggleServiceMembre } = require('../discord/bot');

router.post('/api/service/toggle', requireAuth, requireRole('agent'), async (req, res) => {
  try {
    const result = await toggleServiceMembre(req.session.user.id, req.session.user.nom_rp);
    res.json(result);
  } catch (e) {
    console.error('Erreur toggle service:', e);
    res.status(500).json({ error: 'Erreur lors du pointage' });
  }
});

router.get('/api/service/historique', requireAuth, requireRole('hg'), async (req, res) => {
  const services = await getDb().collection('services').find({ fin: { $ne: null } }).toArray();
  res.json(services);
});

router.get('/api/service/en-cours', requireAuth, requireRole('agent'), async (req, res) => {
  const services = await getDb().collection('services').find({ fin: null }).toArray();
  res.json(services);
});

router.post('/api/service/toggle/:discordId', requireAuth, requireRole('hg'), async (req, res) => {
  try {
    const membre = await getDb().collection('membres').findOne({ discord_id: req.params.discordId });
    if (!membre) return res.status(404).json({ error: 'Membre introuvable' });
    const result = await toggleServiceMembre(membre.discord_id, membre.nom_rp);
    res.json(result);
  } catch (e) {
    console.error('Erreur toggle service (admin):', e);
    res.status(500).json({ error: 'Erreur lors du pointage' });
  }
});

router.get('/api/service/historique/moi', requireAuth, requireRole('agent'), async (req, res) => {
  try {
    const services = await getDb().collection('services')
      .find({ fin: { $ne: null }, discord_id: req.session.user.id })
      .toArray();
    res.json(services);
  } catch (e) {
    console.error('Erreur historique service (moi):', e);
    res.status(500).json({ error: 'Erreur lors du chargement des heures' });
  }
});

module.exports = router;