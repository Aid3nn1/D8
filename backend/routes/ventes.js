// ================================================================
//  ROUTES VENTES — CRUD ventes, incohérences, clôture de période,
//  webhook Discord (post/edit/delete + thread), DM certificat.
// ================================================================
const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { addLog } = require('../logger');
const { requireAuth, requireRole } = require('../middleware/permissions');
const { ROLE_LEVELS } = require('../config');
const {
  posterVenteDiscord,
  modifierVenteDiscord,
  supprimerVenteDiscord,
  envoyerCertificatDM,
  updateVentesChannelCount,
  envoyerWebhookGenerique,
} = require('../discordRest');

function peutModifierVente(user, vente) {
  return String(vente.agent_discord) === String(user.id) || estHgOuPlus(user);
}

function estHgOuPlus(user) {
  return (ROLE_LEVELS[user.role] ?? 0) >= (ROLE_LEVELS.hg ?? 2);
}

// GET /api/ventes — liste complète
router.get('/api/ventes', requireAuth, requireRole('agent'), async (req, res) => {
  const ventes = await getDb().collection('ventes').find().toArray();
  res.json(ventes);
});

// POST /api/ventes — nouvelle vente
router.post('/api/ventes', requireAuth, requireRole('agent'), async (req, res) => {
  const vente = { ...req.body, agent_discord: req.session.user.id, agent_nom: req.session.user.nom_rp, id: Date.now() };
  // Vente employé : HG+ uniquement, et seulement en location
  vente.vente_employe = estHgOuPlus(req.session.user) && vente.type === 'Location' && req.body.vente_employe === true;

  await getDb().collection('ventes').insertOne(vente);
  await addLog('VENTE', { bien: vente.bien, client: vente.client, prix: vente.prix, type: vente.type }, req.session.user.id, req.session.user.nom_rp);
  await updateVentesChannelCount(getDb());
  res.json({ ok: true, id: vente.id });
});

// PATCH /api/ventes/:id — modification
router.patch('/api/ventes/:id', requireAuth, requireRole('agent'), async (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const vente = await db.collection('ventes').findOne({ id });
  if (!vente) return res.status(404).json({ error: 'Introuvable' });
  if (!peutModifierVente(req.session.user, vente)) return res.status(403).json({ error: 'Tu ne peux modifier que tes propres ventes.' });

  const { bien, type, prix, commission, semaines, client, tel, discord, vente_employe } = req.body;
  const maj = {};
  if (bien !== undefined) maj.bien = bien;
  if (type !== undefined) maj.type = type;
  if (prix !== undefined) maj.prix = prix;
  if (commission !== undefined) maj.commission = commission;
  if (semaines !== undefined) maj.semaines = semaines;
  if (client !== undefined) maj.client = client;
  if (tel !== undefined) maj.tel = tel;
  if (discord !== undefined) maj.discord = discord;

  // Vente employé : seul un HG+ peut changer le flag, sinon l'existant est conservé
  if (estHgOuPlus(req.session.user) && vente_employe !== undefined) maj.vente_employe = vente_employe === true;
  // Une vente qui n'est pas une location ne peut pas être "employé"
  if ((maj.type ?? vente.type) !== 'Location') maj.vente_employe = false;

  await db.collection('ventes').updateOne({ id }, { $set: maj });
  await addLog('VENTE_EDIT', { bien: maj.bien ?? vente.bien, client: maj.client ?? vente.client }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

// PATCH /api/ventes/:id/incoherence (inchangée)
router.patch('/api/ventes/:id/incoherence', requireAuth, requireRole('agent'), async (req, res) => {
  const id = Number(req.params.id);
  const result = await getDb().collection('ventes').updateOne(
    { id },
    { $set: { incoherence: req.body.incoherence, incoherence_resolue: req.body.incoherence_resolue } }
  );
  if (result.matchedCount === 0) return res.status(404).json({ error: 'Introuvable' });
  await addLog(req.body.incoherence ? 'VENTE_INCO' : 'VENTE_INCO_OK', { bien: req.body.bien || '?' }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

// GET /api/ventes/cloture — date de dernière clôture (stockée dans "meta")
router.get('/api/ventes/cloture', requireAuth, requireRole('agent'), async (req, res) => {
  const doc = await getDb().collection('meta').findOne({ _id: 'cloture' });
  res.json({ date: doc?.date || null });
});

// GET /api/ventes/clotures — historique des clôtures
router.get('/api/ventes/clotures', requireAuth, requireRole('agent'), async (req, res) => {
  const db = getDb();
  const doc = await db.collection('meta').findOne({ _id: 'clotures' });
  let dates = doc?.dates || [];
  if (!dates.length) {
    const last = await db.collection('meta').findOne({ _id: 'cloture' });
    if (last?.date) dates = [last.date];
  }
  res.json({ dates });
});

// DELETE /api/ventes/reset — Close Semaine
router.delete('/api/ventes/reset', requireAuth, requireRole('co_patron'), async (req, res) => {
  const db = getDb();
  const maintenant = new Date().toISOString();

  const histo = await db.collection('meta').findOne({ _id: 'clotures' });
  if (!histo) {
    const ancienne = await db.collection('meta').findOne({ _id: 'cloture' });
    if (ancienne?.date) await db.collection('meta').insertOne({ _id: 'clotures', dates: [ancienne.date] });
  }
  await db.collection('meta').updateOne({ _id: 'clotures' }, { $push: { dates: maintenant } }, { upsert: true });
  await db.collection('meta').updateOne({ _id: 'cloture' }, { $set: { date: maintenant } }, { upsert: true });

  await addLog('VENTES_RESET', { message: 'Close Compta — nouvelle période' }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

// POST /api/ventes/clotures/rebuild — reconstruit l'historique depuis les logs (une seule fois, owner)
router.post('/api/ventes/clotures/rebuild', requireAuth, requireRole('owner'), async (req, res) => {
  const db = getDb();

  const logs = await db.collection('logs').find({ type: 'VENTES_RESET' }).toArray();
  const depuisLogs = logs.map(l => {
    const [d, m, y] = String(l.date).split('/').map(Number);
    const [hh = 0, mm = 0, ss = 0] = String(l.heure || '').split(':').map(Number);
    const dt = new Date(y, m - 1, d, hh, mm, ss);
    return isNaN(dt) ? null : dt.getTime();
  }).filter(Boolean);

  const doc = await db.collection('meta').findOne({ _id: 'clotures' });
  const exact = (doc?.dates || []).map(x => new Date(x).getTime());
  if (!exact.length) {
    const last = await db.collection('meta').findOne({ _id: 'cloture' });
    if (last?.date) exact.push(new Date(last.date).getTime());
  }

  // On garde les dates exactes, et on ajoute celles des logs qui ne correspondent à aucune (marge 2 min)
  const toutes = [...exact];
  depuisLogs.forEach(t => { if (!exact.some(e => Math.abs(e - t) < 120000)) toutes.push(t); });

  const dates = [...new Set(toutes)].sort((a, b) => a - b).map(t => new Date(t).toISOString());
  await db.collection('meta').updateOne({ _id: 'clotures' }, { $set: { dates } }, { upsert: true });
  res.json({ ok: true, total: dates.length, dates });
});

// DELETE /api/ventes/:id
router.delete('/api/ventes/:id', requireAuth, requireRole('agent'), async (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const vente = await db.collection('ventes').findOne({ id });
  if (!vente) return res.status(404).json({ error: 'Introuvable' });
  if (!peutModifierVente(req.session.user, vente)) return res.status(403).json({ error: 'Accès refusé' });

  await db.collection('ventes').deleteOne({ id });
  await addLog('VENTE_DELETE', { bien: vente.bien, client: vente.client, prix: vente.prix }, req.session.user.id, req.session.user.nom_rp);
  await supprimerVenteDiscord(vente);
  await updateVentesChannelCount(db);
  res.json({ ok: true });
});

// POST /api/webhook — poste la vente sur Discord (réponse immédiate, traitement en arrière-plan)
router.post('/api/webhook', requireAuth, requireRole('agent'), async (req, res) => {
  const { venteId, bien, type, duree, prix, client, tel, agent_nom, date, nomDuFil, pdfBase64 } = req.body;
  res.json({ ok: true });

  try {
    const { messageId, channelId, threadId } = await posterVenteDiscord({ bien, type, duree, prix, client, tel, agent_nom, date, nomDuFil, pdfBase64 });
    if (venteId) {
      await getDb().collection('ventes').updateOne(
        { id: Number(venteId) },
        { $set: { discord_message_id: messageId, discord_channel_id: channelId, discord_thread_id: threadId, discord_thread_created: new Date().toISOString(), discord_thread_purged: false } }
      );
    }
  } catch (err) {
    console.error('Erreur webhook background:', err.response?.data || err.message);
  }
});

// POST /api/ventes/:id/redo-webhook — édite le message Discord existant après modif
router.post('/api/ventes/:id/redo-webhook', requireAuth, requireRole('agent'), async (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const vente = await db.collection('ventes').findOne({ id });
  if (!vente) return res.status(404).json({ error: 'Introuvable' });
  if (!peutModifierVente(req.session.user, vente)) return res.status(403).json({ error: 'Tu ne peux modifier que tes propres ventes.' });

  const { bien, type, prix, semaines, client, tel } = vente;
  const duree = type === 'Achat' ? 'Achat définitif' : `${semaines} semaine(s)`;
  const prixFmt = Number(prix).toLocaleString('fr-FR') + ' $';
  const nomDuFil = `${type} - ${bien} - ${client}`;

  try {
    if (vente.discord_message_id) {
      await modifierVenteDiscord(vente, { bien, type, duree, prix: prixFmt, client, tel, agent_nom: vente.agent_nom, date: vente.date, nomDuFil, pdfBase64: req.body.pdfBase64 || null });
    } else {
      const { messageId, channelId, threadId } = await posterVenteDiscord({ bien, type, duree, prix: prixFmt, client, tel, agent_nom: vente.agent_nom, date: vente.date, nomDuFil, pdfBase64: req.body.pdfBase64 || null });
      await db.collection('ventes').updateOne({ id }, { $set: { discord_message_id: messageId, discord_channel_id: channelId, discord_thread_id: threadId, discord_thread_created: new Date().toISOString(), discord_thread_purged: false } });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur modification webhook:', err.response?.data || err.message);
    res.status(500).json({ error: 'Erreur lors de la mise à jour Discord' });
  }
});

// POST /api/send-dm — envoi du certificat par DM (réponse immédiate)
router.post('/api/send-dm', requireAuth, requireRole('agent'), async (req, res) => {
  const { discordUserId, clientName, bien, type, duree, prix, date, pdfBase64, isCorrection } = req.body;
  if (!discordUserId) return res.status(400).json({ error: 'discordUserId manquant' });
  res.json({ ok: true });

  try {
    await envoyerCertificatDM({ discordUserId, clientName, bien, type, duree, prix, date, pdfBase64, isCorrection });
  } catch (err) {
    console.error('Erreur DM background:', err.response?.data || err.message);
  }
});

// GET /api/discord/stats — nb agents / en service (lu directement depuis Discord)
router.get('/api/discord/stats', requireAuth, requireRole('agent'), async (req, res) => {
  try {
    const axios = require('axios');
    const headers = { Authorization: `Bot ${process.env.BOT_TOKEN}` };
    const response = await axios.get(`https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members?limit=1000`, { headers });
    const membres = response.data;
    const agents = membres.filter(m => m.roles.includes(process.env.ROLE_ID_AGENT)).length;
    const enService = membres.filter(m => m.roles.includes(process.env.ROLE_SERVICE)).length;
    res.json({ agents, enService });
  } catch (e) {
    console.error('Erreur discord/stats:', e.message);
    res.json({ agents: 0, enService: 0 });
  }
});

// POST /api/compta-webhook — envoi du bilan compta sur le webhook Discord dédié
router.post('/api/compta-webhook', requireAuth, requireRole('co_patron'), async (req, res) => {
  const { content, pdfBase64, filename } = req.body;
  try {
    const db = getDb();
    const doc = await db.collection('config').findOne({ _id: 'webhooks' });
    const url = doc?.compta || process.env.WEBHOOK_COMPTA;
    await envoyerWebhookGenerique(url, content, pdfBase64, filename || 'bilan.pdf');
    res.json({ ok: true });
  } catch (e) {
    console.error('Erreur compta webhook:', e.response?.data || e.message);
    res.status(500).json({ error: `Erreur envoi webhook : ${e.response?.data?.message || e.message}` });
  }
});

module.exports = router;