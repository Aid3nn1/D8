// ================================================================
//  ROUTES CONFIG DÉCO — décorateurs, styles, commissions,
//  validations, blacklist
// ================================================================
const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { addLog } = require('../logger');
const { requireAuth, requireRole } = require('../middleware/permissions');
const { hasServerPermission } = require('../config');

// ---------------------------------------------------------------
// DÉCORATEURS (profils + décorations)
// Collection: decorateurs { id, discord_id, nom_rp, contact, discordLink,
//   description, styles[], photo, officiel, decos: [{id,nom,type,style,desc,photos[],date,valide}] }
// ---------------------------------------------------------------

router.get('/api/decorateurs', requireAuth, async (req, res) => {
  const liste = await getDb().collection('decorateurs').find().toArray();
  res.json(liste);
});

router.get('/api/decorateurs/moi', requireAuth, requireRole('decorateur'), async (req, res) => {
  const deco = await getDb().collection('decorateurs').findOne({ discord_id: req.session.user.id });
  res.json(deco || null);
});

router.post('/api/decorateurs/moi', requireAuth, requireRole('decorateur'), async (req, res) => {
  const { nom_rp, contact, discordLink, description, styles, photo } = req.body;
  if (!nom_rp || !contact) return res.status(400).json({ error: 'Nom RP et contact requis' });

  const db = getDb();
  const existant = await db.collection('decorateurs').findOne({ discord_id: req.session.user.id });
  const maj = {
    nom_rp,
    contact,
    discordLink: discordLink || '',
    description: description || '',
    styles: Array.isArray(styles) ? styles : (existant?.styles || []), // ← plus de vérification obligatoire
    photo: photo || existant?.photo || ''
  };

  if (existant) {
    await db.collection('decorateurs').updateOne({ discord_id: req.session.user.id }, { $set: maj });
  } else {
    await db.collection('decorateurs').insertOne({
      id: Date.now(), discord_id: req.session.user.id, officiel: false, decos: [], ...maj
    });
  }
  await addLog('DECO_PROFIL_MAJ', { nom_rp }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

router.patch('/api/decorateurs/:id/officiel', requireAuth, requireRole('staff'), async (req, res) => {
  const id = Number(req.params.id);
  const { officiel } = req.body;
  const deco = await getDb().collection('decorateurs').findOne({ id });
  if (!deco) return res.status(404).json({ error: 'Introuvable' });

  await getDb().collection('decorateurs').updateOne({ id }, { $set: { officiel: !!officiel } });
  await addLog('DECO_OFFICIEL', { deco: deco.nom_rp, officiel: !!officiel }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

router.delete('/api/decorateurs/:id', requireAuth, requireRole('staff'), async (req, res) => {
  const id = Number(req.params.id);
  const deco = await getDb().collection('decorateurs').findOne({ id });
  if (!deco) return res.status(404).json({ error: 'Introuvable' });
  await getDb().collection('decorateurs').deleteOne({ id });
  await addLog('DECO_REVOQUE', { deco: deco.nom_rp }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// DÉCORATIONS
// ---------------------------------------------------------------
router.post('/api/decorateurs/moi/decos', requireAuth, requireRole('decorateur'), async (req, res) => {
  const { nom, bien, desc, photos, type, video_url, categorie } = req.body;
  const mediaType = type === 'video' ? 'video' : 'photo';

  if (!nom || !bien || !desc) {
    return res.status(400).json({ error: 'Tous les champs et un bien sont requis' });
  }
  if (mediaType === 'photo' && (!photos || photos.length === 0)) {
    return res.status(400).json({ error: 'Au moins une photo est requise' });
  }
  if (mediaType === 'video' && (!video_url || !video_url.trim())) {
    return res.status(400).json({ error: 'Un lien vidéo est requis' });
  }

  const db = getDb();
  const deco = await db.collection('decorateurs').findOne({ discord_id: req.session.user.id });
  if (!deco) return res.status(400).json({ error: 'Enregistre d\'abord ton profil' });

  const bienExiste = await db.collection('biens').findOne({ nom: bien });
  if (!bienExiste) return res.status(400).json({ error: 'Bien introuvable' });

  const nouvelle = {
    id: Date.now(), nom, bien, desc,
    categorie: categorie || '',
    type: mediaType,
    photos: mediaType === 'photo' ? photos : [],
    video_url: mediaType === 'video' ? video_url.trim() : null,
    date: new Date().toLocaleDateString('fr-FR'), valide: false
  };
  await db.collection('decorateurs').updateOne({ discord_id: req.session.user.id }, { $push: { decos: nouvelle } });
  await addLog('DECO_ADD', { deco: nom, bien }, req.session.user.id, req.session.user.nom_rp);
  res.json(nouvelle);
});

router.patch('/api/decorateurs/moi/decos/:decoId', requireAuth, requireRole('decorateur'), async (req, res) => {
  const decoId = Number(req.params.decoId);
  const { nom, bien, desc, photos, type, video_url } = req.body;
  const db = getDb();

  if (bien) {
    const bienExiste = await db.collection('biens').findOne({ nom: bien });
    if (!bienExiste) return res.status(400).json({ error: 'Bien introuvable' });
  }

  const maj = {};
  if (nom !== undefined) maj['decos.$.nom'] = nom;
  if (bien !== undefined) maj['decos.$.bien'] = bien;
  if (desc !== undefined) maj['decos.$.desc'] = desc;

  if (type !== undefined) {
    const mediaType = type === 'video' ? 'video' : 'photo';
    maj['decos.$.type'] = mediaType;
    if (mediaType === 'photo') {
      if (photos !== undefined) maj['decos.$.photos'] = photos;
      maj['decos.$.video_url'] = null;
    } else {
      if (video_url !== undefined) maj['decos.$.video_url'] = (video_url || '').trim();
      maj['decos.$.photos'] = [];
    }
  } else if (photos !== undefined) {
    maj['decos.$.photos'] = photos;
  }

  const result = await db.collection('decorateurs').updateOne(
    { discord_id: req.session.user.id, 'decos.id': decoId },
    { $set: maj }
  );
  if (result.matchedCount === 0) return res.status(404).json({ error: 'Introuvable' });
  await addLog('DECO_EDIT', { decoId, bien }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

router.delete('/api/decorateurs/moi/decos/:decoId', requireAuth, requireRole('decorateur'), async (req, res) => {
  const decoId = Number(req.params.decoId);
  await getDb().collection('decorateurs').updateOne(
    { discord_id: req.session.user.id },
    { $pull: { decos: { id: decoId } } }
  );
  await addLog('DECO_DEL', { decoId }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// STYLES DE DÉCORATION
// ---------------------------------------------------------------
const STYLES_DECO_BASE = [];

router.get('/api/config/styles-deco', requireAuth, async (req, res) => {
  const doc = await getDb().collection('config').findOne({ _id: 'styles_deco' });
  res.json({ base: STYLES_DECO_BASE, custom: doc?.liste || [] });
});

router.post('/api/config/styles-deco', requireAuth, requireRole('staff'), async (req, res) => {
  const { nom } = req.body;
  if (!nom || !nom.trim()) return res.status(400).json({ error: 'Nom requis' });
  const trimmed = nom.trim();

  const db = getDb();
  const doc = await db.collection('config').findOne({ _id: 'styles_deco' });
  const liste = doc?.liste || [];
  if (STYLES_DECO_BASE.includes(trimmed) || liste.includes(trimmed)) {
    return res.status(409).json({ error: 'Ce style existe déjà' });
  }
  liste.push(trimmed);
  await db.collection('config').updateOne({ _id: 'styles_deco' }, { $set: { liste } }, { upsert: true });
  await addLog('STYLE_DECO_ADD', { style: trimmed }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true, base: STYLES_DECO_BASE, custom: liste });
});

router.delete('/api/config/styles-deco/:nom', requireAuth, requireRole('staff'), async (req, res) => {
  const nom = decodeURIComponent(req.params.nom);
  if (STYLES_DECO_BASE.includes(nom)) return res.status(400).json({ error: 'Impossible de supprimer un style de base' });

  const db = getDb();
  const doc = await db.collection('config').findOne({ _id: 'styles_deco' });
  const liste = (doc?.liste || []).filter(s => s !== nom);
  await db.collection('config').updateOne({ _id: 'styles_deco' }, { $set: { liste } }, { upsert: true });
  await addLog('STYLE_DECO_DEL', { style: nom }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true, base: STYLES_DECO_BASE, custom: liste });
});

// ---------------------------------------------------------------
// COMMISSIONS DÉCORATEURS
// ---------------------------------------------------------------
router.get('/api/config/commission-deco', requireAuth, async (req, res) => {
  const doc = await getDb().collection('config').findOne({ _id: 'commission_deco' });
  res.json({ taux: doc?.taux ?? 15 });
});

router.post('/api/config/commission-deco', requireAuth, requireRole('staff'), async (req, res) => {
  const { taux } = req.body;
  const n = Number(taux);
  if (isNaN(n) || n < 0 || n > 100) return res.status(400).json({ error: 'Taux invalide (0-100)' });

  await getDb().collection('config').updateOne(
    { _id: 'commission_deco' },
    { $set: { taux: n, updated_at: new Date() } },
    { upsert: true }
  );
  await addLog('COMMISSION_DECO', { taux: n }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true, taux: n });
});

// ---------------------------------------------------------------
// STATISTIQUES DÉCO
// ---------------------------------------------------------------
router.get('/api/config/stats-deco', requireAuth, requireRole('staff'), async (req, res) => {
  const decorateurs = await getDb().collection('decorateurs').find().toArray();
  const total = decorateurs.reduce((s, d) => s + (d.decos?.length || 0), 0);
  const officiels = decorateurs.filter(d => d.officiel).length;

  const stylesCount = {};
  decorateurs.forEach(d => (d.decos || []).forEach(x => { stylesCount[x.style] = (stylesCount[x.style] || 0) + 1; }));
  const styleTop = Object.entries(stylesCount).sort((a, b) => b[1] - a[1])[0];

  const top = [...decorateurs].sort((a, b) => (b.decos?.length || 0) - (a.decos?.length || 0))[0];

  res.json({
    totalDecorateurs: decorateurs.length,
    officiels,
    totalDecorations: total,
    decorateurTopActif: top ? { nom_rp: top.nom_rp, nbDecos: top.decos?.length || 0 } : null,
    styleTop: styleTop ? { style: styleTop[0], count: styleTop[1] } : null,
    enAttenteValidation: decorateurs.flatMap(d => (d.decos || []).filter(x => !x.valide)).length
  });
});

// ---------------------------------------------------------------
// VALIDATIONS DE DÉCO
// ---------------------------------------------------------------
router.get('/api/config/validations-deco', requireAuth, requireRole('staff'), async (req, res) => {
  const decorateurs = await getDb().collection('decorateurs').find().toArray();
  const enAttente = decorateurs.flatMap(d =>
    (d.decos || [])
      .filter(x => !x.valide)
      .map(x => ({ ...x, decorateurId: d.id, decorateurNom: d.nom_rp }))
  );
  res.json(enAttente);
});

router.patch('/api/config/validations-deco/:decorateurId/:decoId', requireAuth, requireRole('staff'), async (req, res) => {
  const decorateurId = Number(req.params.decorateurId);
  const decoId = Number(req.params.decoId);
  const { valide } = req.body;

  const result = await getDb().collection('decorateurs').updateOne(
    { id: decorateurId, 'decos.id': decoId },
    { $set: { 'decos.$.valide': !!valide } }
  );
  if (result.matchedCount === 0) return res.status(404).json({ error: 'Introuvable' });
  await addLog('DECO_VALIDATION', { decoId, valide: !!valide }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// BLACKLIST DÉCORATEURS
// ---------------------------------------------------------------
router.get('/api/blacklist-deco', requireAuth, requireRole('staff'), async (req, res) => {
  const liste = await getDb().collection('blacklist_deco').find().toArray();
  res.json(liste);
});

router.post('/api/blacklist-deco', requireAuth, requireRole('staff'), async (req, res) => {
  const { nom, semaines, raison } = req.body;
  if (!nom) return res.status(400).json({ error: 'Nom requis' });

  const finDate = new Date(Date.now() + (Number(semaines) || 4) * 7 * 24 * 60 * 60 * 1000);
  const entry = { id: Date.now(), nom, raison: raison || '', fin: finDate.toLocaleDateString('fr-FR'), fin_ts: finDate.getTime() };
  await getDb().collection('blacklist_deco').insertOne(entry);
  await addLog('BL_DECO_ADD', { nom, raison }, req.session.user.id, req.session.user.nom_rp);
  res.json(entry);
});

router.delete('/api/blacklist-deco/:id', requireAuth, requireRole('staff'), async (req, res) => {
  const id = Number(req.params.id);
  const entry = await getDb().collection('blacklist_deco').findOne({ id });
  if (!entry) return res.status(404).json({ error: 'Introuvable' });
  await getDb().collection('blacklist_deco').deleteOne({ id });
  await addLog('BL_DECO_DEL', { nom: entry.nom }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// PAGE DÉCORATEUR — présentation, prestations, tarifs, promotions,
// contact, galerie, catégories perso, suivi de projet, section libre
// ---------------------------------------------------------------

function estProprioOuStaff(req, deco) {
  if (hasServerPermission(req.session.user.role, 'staff')) return true;
  return deco.discord_id === req.session.user.id;
}

router.get('/api/decorateurs/:id/page', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const deco = await getDb().collection('decorateurs').findOne({ id });
  if (!deco) return res.status(404).json({ error: 'Introuvable' });
  res.json(deco.page || {});
});

router.post('/api/decorateurs/:id/page/presentation', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const deco = await getDb().collection('decorateurs').findOne({ id });
  if (!deco) return res.status(404).json({ error: 'Introuvable' });
  if (!estProprioOuStaff(req, deco)) return res.status(403).json({ error: 'Accès refusé' });

  const { nomEntreprise, description, horaires, zone } = req.body;
  await getDb().collection('decorateurs').updateOne({ id }, {
    $set: {
      'page.presentation': {
        nomEntreprise: nomEntreprise || '', description: description || '',
        horaires: horaires || '', zone: zone || ''
      }
    }
  });
  await addLog('DECO_PAGE_MAJ', { section: 'presentation', deco: deco.nom_rp }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

router.post('/api/decorateurs/:id/page/contact', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const deco = await getDb().collection('decorateurs').findOne({ id });
  if (!deco) return res.status(404).json({ error: 'Introuvable' });
  if (!estProprioOuStaff(req, deco)) return res.status(403).json({ error: 'Accès refusé' });

  const { tel, adresse, reseaux } = req.body;
  await getDb().collection('decorateurs').updateOne({ id }, {
    $set: { 'page.contact': { tel: tel || '', adresse: adresse || '', reseaux: Array.isArray(reseaux) ? reseaux : [] } }
  });
  await addLog('DECO_PAGE_MAJ', { section: 'contact', deco: deco.nom_rp }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

router.post('/api/decorateurs/:id/page/libre', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const deco = await getDb().collection('decorateurs').findOne({ id });
  if (!deco) return res.status(404).json({ error: 'Introuvable' });
  if (!estProprioOuStaff(req, deco)) return res.status(403).json({ error: 'Accès refusé' });

  const { libre } = req.body;
  await getDb().collection('decorateurs').updateOne({ id }, { $set: { 'page.libre': libre || '' } });
  await addLog('DECO_PAGE_MAJ', { section: 'libre', deco: deco.nom_rp }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

// CRUD générique pour les listes de la page
const LISTES_PAGE = ['prestations', 'tarifs', 'promotions', 'galerie', 'categories', 'projets'];

router.post('/api/decorateurs/:id/page/:liste', requireAuth, async (req, res) => {
  const { liste } = req.params;
  if (!LISTES_PAGE.includes(liste)) return res.status(400).json({ error: 'Liste inconnue' });
  const id = Number(req.params.id);
  const deco = await getDb().collection('decorateurs').findOne({ id });
  if (!deco) return res.status(404).json({ error: 'Introuvable' });
  if (!estProprioOuStaff(req, deco)) return res.status(403).json({ error: 'Accès refusé' });

  const item = { id: Date.now(), ...req.body };
  await getDb().collection('decorateurs').updateOne({ id }, { $push: { [`page.${liste}`]: item } });
  await addLog('DECO_PAGE_MAJ', { section: liste, deco: deco.nom_rp }, req.session.user.id, req.session.user.nom_rp);
  res.json(item);
});

router.patch('/api/decorateurs/:id/page/:liste/:itemId', requireAuth, async (req, res) => {
  const { liste } = req.params;
  if (!LISTES_PAGE.includes(liste)) return res.status(400).json({ error: 'Liste inconnue' });
  const id = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const deco = await getDb().collection('decorateurs').findOne({ id });
  if (!deco) return res.status(404).json({ error: 'Introuvable' });
  if (!estProprioOuStaff(req, deco)) return res.status(403).json({ error: 'Accès refusé' });

  const setObj = {};
  Object.entries(req.body).forEach(([k, v]) => { setObj[`page.${liste}.$.${k}`] = v; });
  const result = await getDb().collection('decorateurs').updateOne(
    { id, [`page.${liste}.id`]: itemId }, { $set: setObj }
  );
  if (result.matchedCount === 0) return res.status(404).json({ error: 'Élément introuvable' });
  await addLog('DECO_PAGE_MAJ', { section: liste, deco: deco.nom_rp }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

router.delete('/api/decorateurs/:id/page/:liste/:itemId', requireAuth, async (req, res) => {
  const { liste } = req.params;
  if (!LISTES_PAGE.includes(liste)) return res.status(400).json({ error: 'Liste inconnue' });
  const id = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const deco = await getDb().collection('decorateurs').findOne({ id });
  if (!deco) return res.status(404).json({ error: 'Introuvable' });
  if (!estProprioOuStaff(req, deco)) return res.status(403).json({ error: 'Accès refusé' });

  await getDb().collection('decorateurs').updateOne({ id }, { $pull: { [`page.${liste}`]: { id: itemId } } });
  await addLog('DECO_PAGE_MAJ', { section: liste, deco: deco.nom_rp }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

// Assignation d'une décoration à une catégorie perso (staff peut le faire pour n'importe quel décorateur)
router.patch('/api/decorateurs/:decoratorId/decos/:decoId/categorie', requireAuth, async (req, res) => {
  const decoratorId = Number(req.params.decoratorId);
  const decoId = Number(req.params.decoId);
  const { categorie } = req.body;
  const decorateur = await getDb().collection('decorateurs').findOne({ id: decoratorId });
  if (!decorateur) return res.status(404).json({ error: 'Introuvable' });
  if (!estProprioOuStaff(req, decorateur)) return res.status(403).json({ error: 'Accès refusé' });

  const result = await getDb().collection('decorateurs').updateOne(
    { id: decoratorId, 'decos.id': decoId },
    { $set: { 'decos.$.categorie': categorie || '' } }
  );
  if (result.matchedCount === 0) return res.status(404).json({ error: 'Décoration introuvable' });
  res.json({ ok: true });
});

module.exports = router;