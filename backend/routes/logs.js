// ================================================================
//  ROUTES LOGS — lecture et vidage du journal d'activité
// ================================================================
const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { addLog } = require('../logger');
const { requireAuth, requireRole } = require('../middleware/permissions');
const { envoyerWebhookGenerique } = require('../discordRest');

router.get('/api/logs', requireAuth, requireRole('hg'), async (req, res) => {
  const logs = await getDb().collection('logs').find({ source: { $ne: 'bot' } }).sort({ created_at: -1 }).limit(500).toArray();
  res.json(logs);
});

router.get('/api/logs/bot', requireAuth, requireRole('hg'), async (req, res) => {
  const logs = await getDb().collection('logs').find({ source: 'bot' }).sort({ created_at: -1 }).limit(500).toArray();
  res.json(logs);
});

// Reçoit le PDF d'archive généré côté front (jsPDF) et le relaie sur Discord
// AVANT que le front n'appelle DELETE /api/logs.
router.post('/api/logs-webhook', requireAuth, requireRole('co_patron'), async (req, res) => {
  const { content, pdfBase64, filename } = req.body;
  try {
    const db = getDb();
    const doc = await db.collection('config').findOne({ _id: 'webhooks' });
    const url = doc?.logs || process.env.WEBHOOK_LOGS;
    await envoyerWebhookGenerique(url, content, pdfBase64, filename || 'logs.pdf');
    res.json({ ok: true });
  } catch (e) {
    console.error('Erreur logs webhook:', e.response?.data || e.message);
    res.status(500).json({ error: 'Erreur envoi webhook' });
  }
});

router.delete('/api/logs', requireAuth, requireRole('co_patron'), async (req, res) => {
  await getDb().collection('logs').deleteMany({});
  await addLog('LOGS_CLEAR', { message: 'Logs vidés' }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

module.exports = router;