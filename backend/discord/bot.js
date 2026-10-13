// ================================================================
//  BOT DISCORD — prise de service, salons compteurs, blocage
//  automatique des tickets villa blacklistés.
//  ⚠️ Ce fichier vit dans backend/discord/ — les requires vers les
//  modules du dossier backend/ utilisent donc '../'.
//
//  Fusion : commandes + permissions DB (bot.js actuel) avec le
//  comportement de nettoyage périodique de l'ancien server.js
//  (purge toutes les 5min par âge, au lieu d'un délai programmé
//  par message/thread).
// ================================================================
require('dotenv').config({ path: 'key.env' });
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, Partials, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const { getDb } = require('../db');
const { addLog } = require('../logger');

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message],
});

let io = null; // injecté par server.js pour émettre "service:update" en direct
function setSocketIO(instance) { io = instance; }

// ---------------------------------------------------------------
// PERMISSIONS — même barème que hasServerPermission() côté web,
// basé sur le rôle stocké en DB (collection membres), pas sur les
// rôles Discord bruts, pour rester cohérent avec le site.
// ---------------------------------------------------------------
const NIVEAUX_ROLES = { client: 0, decorateur: 0.5, agent: 1, hg: 2, staff: 3, co_patron: 4, owner: 5 };

async function getMembreRole(discordId) {
  const m = await getDb().collection('membres').findOne({ discord_id: discordId });
  return m?.role || 'client';
}

function aPermission(role, requis) {
  return (NIVEAUX_ROLES[role] ?? 0) >= (NIVEAUX_ROLES[requis] ?? 0);
}

async function verifierPermissionInteraction(interaction, requis) {
  const role = await getMembreRole(interaction.user.id);
  if (!aPermission(role, requis)) {
    await interaction.reply({ content: "❌ Tu n'as pas la permission d'utiliser cette commande.", flags: 64 });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------
// LISTE DES COMMANDES — pour /help. ⚠️ Doit rester synchronisée
// manuellement avec la liste "commands" de deploy-commands.js.
// ---------------------------------------------------------------
const COMMANDES_INFO = [
  { nom: '/service', desc: 'Ouvre le panneau de prise / fin de service' },
  { nom: '/finservice', desc: "Clôture de force le service d'un agent (staff+)" },
  { nom: '/ping', desc: 'Vérifie que le bot Dynasty 8 répond' },
  { nom: '/uptime', desc: 'Affiche depuis combien de temps le bot tourne' },
  { nom: '/stats', desc: "Résumé rapide de l'agence" },
  { nom: '/statsglobal', desc: "Statistiques complètes de l'agence (ventes, volume, commissions, membres...)" },
  { nom: '/agent', desc: "Affiche les statistiques d'un agent précis (option: nom)" },
  { nom: '/derniere-vente', desc: 'Affiche la dernière vente enregistrée' },
  { nom: '/service-liste', desc: 'Liste les agents actuellement en service' },
  { nom: '/encheres', desc: 'Liste les ventes aux enchères en cours' },
  { nom: '/blacklist-check', desc: 'Vérifie si un ID Discord / nom est blacklisté (option: id)' },
  { nom: '/bl-resa-villa', desc: 'Blacklist un membre pour la réservation villa (hg+)' },
  { nom: '/unbl-resa-villa', desc: 'Retire un membre de la blacklist villa (hg+)' },
  { nom: '/bl-list', desc: 'Affiche/actualise la liste des blacklists villa actives' },
  { nom: '/help', desc: 'Affiche cette liste de commandes' },
];

// ---------------------------------------------------------------
// AUTO-NETTOYAGE — comportement repris de l'ancien server.js :
// une purge PÉRIODIQUE (toutes les 5min) basée sur l'âge, plutôt
// qu'un délai programmé par message/thread individuel.
// ---------------------------------------------------------------
const SEUIL_AGE_PURGE_MS = 60 * 60 * 1000;      // 1h : âge au-delà duquel on purge
const INTERVALLE_PURGE_MS = 5 * 60 * 1000;      // 5min : fréquence du balayage périodique

// Salon "Ping vente" — supprime tout message de plus d'1 caractère,
// immédiatement à l'envoi ; les messages d'1 caractère restants sont
// balayés et supprimés au bout d'1h par la purge périodique ci-dessous.
const SALON_PING_VENTE_ID = '1551285618674372750';

// ---------------------------------------------------------------
// PRISE DE SERVICE
// ---------------------------------------------------------------
async function toggleServiceMembre(discordId, nomAffiche) {
  const db = getDb();
  const enCours = await db.collection('services').findOne({ discord_id: discordId, fin: null });

  if (enCours) {
    const fin = new Date();
    const dureeMinutes = Math.floor((fin - new Date(enCours.debut)) / 60000);
    await db.collection('services').updateOne(
      { _id: enCours._id },
      { $set: { fin: fin.toISOString(), duree_minutes: dureeMinutes } }
    );
    await majSalonEtSocket();
    try {
      const guild = await discordClient.guilds.fetch(process.env.GUILD_ID);
      const membre = await guild.members.fetch(discordId).catch(() => null);
      if (membre && process.env.ROLE_SERVICE) await membre.roles.remove(process.env.ROLE_SERVICE);
    } catch (e) { console.error('Retrait rôle service:', e.message); }

    const h = Math.floor(dureeMinutes / 60);
    const m = dureeMinutes % 60;
    const dureeTxt = `${h}h${m > 0 ? m + 'm' : ''}`;

    if (process.env.WEBHOOK_SERVICE) {
      try {
        await axios.post(process.env.WEBHOOK_SERVICE, {
          embeds: [{
            author: { name: 'Prise de service' },
            description: `🔴 **${nomAffiche}** a quitté son service.\n> Durée : **${dureeTxt}**`,
            color: 0xc0392b,
          }],
        });
      } catch (e) { console.error('Erreur webhook service:', e.message); }
    }
    if (process.env.WEBHOOK_SERVICE_LOGS) {
      try {
        await axios.post(process.env.WEBHOOK_SERVICE_LOGS, {
          username: 'System Logs - Dynasty8',
          embeds: [{
            description: `🟢 **Envoi Réussi**\n\nFin de service enregistrée.\n\n👤 **Identifiant :** ${nomAffiche}\n⏱️ **Durée :** ${dureeTxt}`,
            color: 0xc0392b,
            timestamp: new Date().toISOString(),
          }],
        });
      } catch (e) { console.error('Erreur webhook logs service:', e.message); }
    }

    await addLog('SERVICE_FIN', { message: `Fin de service — durée ${dureeMinutes}min` }, discordId, nomAffiche);
    return { ok: true, statut: 'off', duree_minutes: dureeMinutes };
  }

  await db.collection('services').insertOne({
    discord_id: discordId, nom: nomAffiche, debut: new Date().toISOString(), fin: null,
  });
  await majSalonEtSocket();
  try {
    const guild = await discordClient.guilds.fetch(process.env.GUILD_ID);
    const membre = await guild.members.fetch(discordId).catch(() => null);
    if (membre && process.env.ROLE_SERVICE) await membre.roles.add(process.env.ROLE_SERVICE);
  } catch (e) { console.error('Ajout rôle service:', e.message); }

  if (process.env.WEBHOOK_SERVICE) {
    try {
      await axios.post(process.env.WEBHOOK_SERVICE, {
        embeds: [{
          author: { name: 'Prise de service' },
          description: `🟢 **${nomAffiche}** a pris son service.`,
          color: 0x2e7d32,
        }],
      });
    } catch (e) { console.error('Erreur webhook service:', e.message); }
  }
  if (process.env.WEBHOOK_SERVICE_LOGS) {
    try {
      await axios.post(process.env.WEBHOOK_SERVICE_LOGS, {
        username: 'System Logs - Dynasty8',
        embeds: [{
          description: `🟢 **Envoi Réussi**\n\nPrise de service enregistrée.\n\n👤 **Identifiant :** ${nomAffiche}`,
          color: 0x2ecc71,
          timestamp: new Date().toISOString(),
        }],
      });
    } catch (e) { console.error('Erreur webhook logs service:', e.message); }
  }

  await addLog('SERVICE_DEBUT', { message: 'Prise de service' }, discordId, nomAffiche);
  return { ok: true, statut: 'on' };
}

async function majSalonEtSocket() {
  const db = getDb();
  const enService = await db.collection('services').find({ fin: null }).toArray();

  if (io) io.emit('service:update', { enService: enService.length, agents: enService });

  if (!process.env.SALON_SERVICE_ID) return;
  try {
    const channel = await discordClient.channels.fetch(process.env.SALON_SERVICE_ID);
    const newName = `🟢 En service : ${enService.length}`;
    if (channel && channel.name !== newName) await channel.setName(newName);
  } catch (e) { console.error('Erreur update salon service:', e.message); }
}

async function majSalonVentes() {
  if (!process.env.SALON_VENTES_ID) return;
  try {
    const total = await getDb().collection('ventes').countDocuments();
    const channel = await discordClient.channels.fetch(process.env.SALON_VENTES_ID);
    const newName = `📊 ventes : ${total}`;
    if (channel && channel.name !== newName) await channel.setName(newName);
  } catch (e) { console.error('Erreur update salon ventes:', e.message); }
}

// ---------------------------------------------------------------
// BLACKLIST VILLA — helpers partagés (bot ↔ web, même schéma que
// routes/config-agence.js : id, nom, discord_id, raison, fin, fin_ts)
// ---------------------------------------------------------------
function formatDureeRestante(finTs) {
  const restantMs = finTs - Date.now();
  if (restantMs <= 0) return 'Expiré';
  const jours = Math.floor(restantMs / 86400000);
  const heures = Math.floor((restantMs % 86400000) / 3600000);
  return `${jours}j ${heures}h`;
}

async function construireEmbedBlList() {
  const db = getDb();
  const liste = await db.collection('blacklist_villa')
    .find({ fin_ts: { $gt: Date.now() } })
    .sort({ fin_ts: 1 })
    .toArray();

  if (liste.length === 0) {
    return {
      title: '✅ Aucune blacklist active',
      color: 0x2e7d32,
      timestamp: new Date().toISOString(),
      footer: { text: 'Actualisé via /bl-list' },
    };
  }

  const description = liste
    .map(b => `**${b.nom}** (\`${b.discord_id}\`) — ⏱️ ${formatDureeRestante(b.fin_ts)} restant\n> ${b.raison || 'Villa non achetée avant la fin de la réservation'}`)
    .join('\n\n');

  return {
    title: `🚫 ${liste.length} blacklist(s) villa active(s)`,
    description,
    color: 0xe74c3c,
    timestamp: new Date().toISOString(),
    footer: { text: 'Actualisé via /bl-list' },
  };
}

async function rafraichirMessageBlList() {
  const db = getDb();
  const loc = await db.collection('config').findOne({ _id: 'bl_list_message' });
  if (!loc?.channelId || !loc?.messageId) return;

  try {
    const channel = await discordClient.channels.fetch(loc.channelId);
    const message = await channel.messages.fetch(loc.messageId);
    const embed = await construireEmbedBlList();
    await message.edit({ embeds: [embed] });
  } catch (e) {
    console.error('Erreur rafraîchissement bl-list:', e.message);
    await db.collection('config').deleteOne({ _id: 'bl_list_message' });
  }
}

// Rafraîchit le message bl-list toutes les heures (comme l'ancien comportement)
setInterval(rafraichirMessageBlList, 60 * 60 * 1000);

// ---------------------------------------------------------------
// SLASH COMMANDS
// ---------------------------------------------------------------
discordClient.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const cmd = interaction.commandName;
    const utilisateur = interaction.member?.nickname || interaction.user.username;

    if (cmd === 'help') {
      const description = COMMANDES_INFO.map(c => `**${c.nom}** — ${c.desc}`).join('\n');
      await addLog('CMD_HELP', { message: 'Liste des commandes consultée' }, interaction.user.id, utilisateur, 'bot');
      return interaction.reply({
        embeds: [{ title: '📖 Dynasty 8 — Commandes disponibles', description, color: 0xe0b13d }],
        flags: 64,
      });
    }

    if (cmd === 'service') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prise_service').setLabel('Prise de service').setEmoji('🟢').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('fin_service').setLabel('Fin de service').setEmoji('🔴').setStyle(ButtonStyle.Danger)
      );
      return interaction.reply({
        embeds: [{ title: '🕐 Prise de service', description: 'Clique sur un bouton pour démarrer ou terminer ton service.', color: 0x2e7d32 }],
        components: [row],
      });
    }

    if (cmd === 'finservice') {
      if (!(await verifierPermissionInteraction(interaction, 'staff'))) return;

      const targetId = interaction.options.getString('id', true).trim();
      const db = getDb();
      const enCours = await db.collection('services').findOne({ discord_id: targetId, fin: null });
      const executantNom = interaction.member?.nickname || interaction.user.username;

      // Aucune session active : retire quand même le rôle, au cas où
      if (!enCours) {
        try {
          const guild = await discordClient.guilds.fetch(process.env.GUILD_ID);
          const membre = await guild.members.fetch(targetId).catch(() => null);
          if (membre && process.env.ROLE_SERVICE) await membre.roles.remove(process.env.ROLE_SERVICE).catch(() => {});
          await majSalonEtSocket();
        } catch (e) {}
        return interaction.reply({
          content: `✅ Rôle retiré pour <@${targetId}> (aucune session active enregistrée).`,
          flags: 64,
        });
      }

      const fin = new Date();
      const dureeMinutes = Math.floor((fin - new Date(enCours.debut)) / 60000);
      await db.collection('services').updateOne(
        { _id: enCours._id },
        { $set: { fin: fin.toISOString(), duree_minutes: dureeMinutes } }
      );
      await majSalonEtSocket();

      try {
        const guild = await discordClient.guilds.fetch(process.env.GUILD_ID);
        const membre = await guild.members.fetch(targetId).catch(() => null);
        if (membre && process.env.ROLE_SERVICE) await membre.roles.remove(process.env.ROLE_SERVICE).catch(() => {});
      } catch (e) {}

      const h = Math.floor(dureeMinutes / 60);
      const m = dureeMinutes % 60;
      const dureeTxt = `${h}h${m > 0 ? m + 'm' : ''}`;
      const nomAgent = enCours.nom || targetId;

      // Total des heures cumulées de l'agent (toutes sessions terminées)
      const toutesLesSessions = await db.collection('services').find({ discord_id: targetId, fin: { $ne: null } }).toArray();
      const totalMinutes = toutesLesSessions.reduce((acc, s) => acc + (s.duree_minutes || 0), 0);
      const totalH = Math.floor(totalMinutes / 60);
      const totalM = totalMinutes % 60;
      const totalTxt = `${totalH}h${totalM > 0 ? totalM + 'm' : ''}`;

      if (process.env.WEBHOOK_SERVICE_LOGS) {
        try {
          await axios.post(process.env.WEBHOOK_SERVICE_LOGS, {
            username: 'System Logs - Dynasty8',
            embeds: [{
              description: `🔴 **Fin de service forcée**\n\n👤 **Agent :** ${nomAgent}\n🛡️ **Par :** ${executantNom}\n⏱️ **Durée :** ${dureeTxt}\n📊 **Total heures :** ${totalTxt}`,
              color: 0xe74c3c,
              timestamp: new Date().toISOString(),
            }],
          });
        } catch (e) { console.error('Erreur webhook finservice:', e.message); }
      }

      await addLog('SERVICE_FIN', { message: `Fin de service forcée — durée ${dureeTxt} (total ${totalTxt}) — par ${executantNom}` }, targetId, nomAgent);

      return interaction.reply({
        embeds: [{
          description: `🔴 Service de **${nomAgent}** terminé.\n⏱️ Durée : **${dureeTxt}**`,
          color: 0xc0392b,
        }],
        flags: 64,
      });
    }

    if (cmd === 'ping') {
      const debut = Date.now();
      await interaction.deferReply({ flags: 64 });
      const latence = Date.now() - debut;
      await addLog('CMD_PING', { message: `Latence ${latence}ms` }, interaction.user.id, utilisateur, 'bot');
      return interaction.editReply({
        embeds: [{ description: `🏓 Pong ! Latence API : **${latence}ms** — WS : **${discordClient.ws.ping}ms**`, color: 0x2ecc71 }],
      });
    }

    if (cmd === 'uptime') {
      const secondes = Math.floor(discordClient.uptime / 1000);
      const j = Math.floor(secondes / 86400);
      const h = Math.floor((secondes % 86400) / 3600);
      const m = Math.floor((secondes % 3600) / 60);
      await addLog('CMD_UPTIME', { message: `${j}j ${h}h ${m}m` }, interaction.user.id, utilisateur, 'bot');
      return interaction.reply({
        embeds: [{ description: `⏱️ Le bot tourne depuis **${j}j ${h}h ${m}m**.`, color: 0x2ecc71 }],
      });
    }

    if (cmd === 'statsglobal') {
      await interaction.deferReply();
      try {
        const db = getDb();
        const [ventes, membres, decorateurs, enService, blVilla, blDeco, clotureDoc, biens] = await Promise.all([
          db.collection('ventes').find().toArray(),
          db.collection('membres').countDocuments(),
          db.collection('decorateurs').find().toArray(),
          db.collection('services').countDocuments({ fin: null }),
          db.collection('blacklist_villa').countDocuments({ fin_ts: { $gt: Date.now() } }),
          db.collection('blacklist_deco').countDocuments(),
          db.collection('meta').findOne({ _id: 'cloture' }),
          db.collection('biens').countDocuments(),
        ]);

        const clotureTime = clotureDoc?.date ? new Date(clotureDoc.date).getTime() : 0;
        const toDate = (dmy) => { const [d, m, y] = dmy.split('/'); return new Date(Number(y), Number(m) - 1, Number(d)); };
        const ventesPeriode = ventes.filter(v => toDate(v.date).getTime() >= clotureTime);

        const parseMontant = (val) => {
          if (val === null || val === undefined || val === '/') return 0;
          if (typeof val === 'number') return val;
          return parseInt(String(val).replace(/[^\d-]/g, ''), 10) || 0;
        };
        const volume = ventesPeriode.reduce((s, v) => s + parseMontant(v.prix), 0);
        const commissions = ventesPeriode.reduce((s, v) => s + parseMontant(v.commission), 0);
        const totalDecos = decorateurs.reduce((s, d) => s + (d.decos?.length || 0), 0);

        const embed = new EmbedBuilder()
          .setTitle('📊 Dynasty 8 — Statistiques globales')
          .setColor(0xe0b13d)
          .setDescription(clotureDoc?.date
            ? `Période en cours depuis le **${new Date(clotureDoc.date).toLocaleDateString('fr-FR')}**`
            : 'Aucune clôture effectuée — historique complet')
          .addFields(
            { name: '🧾 Ventes (période)', value: String(ventesPeriode.length), inline: true },
            { name: '💰 Volume', value: `${volume.toLocaleString('fr-FR')} $`, inline: true },
            { name: '💵 Commissions', value: `${commissions.toLocaleString('fr-FR')} $`, inline: true },
            { name: '🏠 Biens catalogue', value: String(biens), inline: true },
            { name: '🟢 Agents en service', value: String(enService), inline: true },
            { name: '👥 Membres', value: String(membres), inline: true },
            { name: '🎨 Décorations', value: String(totalDecos), inline: true },
            { name: '🚫 Blacklist Villa', value: String(blVilla), inline: true },
            { name: '🚫 Blacklist Déco', value: String(blDeco), inline: true },
          )
          .setTimestamp();

        await addLog('CMD_STATSGLOBAL', { message: `${ventesPeriode.length} ventes, ${volume.toLocaleString('fr-FR')}$ volume` }, interaction.user.id, utilisateur, 'bot');
        return interaction.editReply({ embeds: [embed] });
      } catch (e) {
        console.error('Erreur /statsglobal:', e.message);
        return interaction.editReply('❌ Impossible de récupérer les statistiques.');
      }
    }

    if (cmd === 'stats') {
      await interaction.deferReply();
      try {
        const db = getDb();
        const [totalVentes, enService, blVilla, blDeco] = await Promise.all([
          db.collection('ventes').countDocuments(),
          db.collection('services').countDocuments({ fin: null }),
          db.collection('blacklist_villa').countDocuments({ fin_ts: { $gt: Date.now() } }),
          db.collection('blacklist_deco').countDocuments(),
        ]);
        const embed = new EmbedBuilder()
          .setTitle('📊 Dynasty 8 — Résumé rapide')
          .setColor(0xe0b13d)
          .addFields(
            { name: '🧾 Ventes enregistrées', value: String(totalVentes), inline: true },
            { name: '🟢 Agents en service', value: String(enService), inline: true },
            { name: '🚫 Blacklist Villa', value: String(blVilla), inline: true },
            { name: '🚫 Blacklist Déco', value: String(blDeco), inline: true },
          )
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      } catch (e) {
        console.error('Erreur /stats:', e.message);
        return interaction.editReply('❌ Impossible de récupérer les statistiques.');
      }
    }

    if (cmd === 'agent') {
      const nomRecherche = interaction.options.getString('nom', true).trim();
      await interaction.deferReply();
      try {
        const db = getDb();
        const membre = await db.collection('membres').findOne({ nom_rp: { $regex: `^${nomRecherche}$`, $options: 'i' } });
        if (!membre) {
          await addLog('CMD_AGENT', { agent: nomRecherche, message: 'Introuvable' }, interaction.user.id, utilisateur, 'bot');
          return interaction.editReply(`❌ Aucun membre trouvé pour \`${nomRecherche}\`.`);
        }

        const ventes = await db.collection('ventes').find({ agent_nom: membre.nom_rp }).toArray();
        const parseMontant = (val) => {
          if (val === null || val === undefined || val === '/') return 0;
          if (typeof val === 'number') return val;
          return parseInt(String(val).replace(/[^\d-]/g, ''), 10) || 0;
        };
        const commissionTotal = ventes.reduce((s, v) => s + parseMontant(v.commission), 0);
        const volumeTotal = ventes.reduce((s, v) => s + parseMontant(v.prix), 0);
        const enService = await db.collection('services').findOne({ discord_id: membre.discord_id, fin: null });

        const embed = new EmbedBuilder()
          .setTitle(`👤 ${membre.nom_rp}`)
          .setColor(0x4fc3f7)
          .addFields(
            { name: 'Rôle', value: membre.role, inline: true },
            { name: 'En service', value: enService ? '🟢 Oui' : '🔴 Non', inline: true },
            { name: 'Nb ventes', value: String(ventes.length), inline: true },
            { name: 'Volume total', value: `${volumeTotal.toLocaleString('fr-FR')} $`, inline: true },
            { name: 'Commissions totales', value: `${commissionTotal.toLocaleString('fr-FR')} $`, inline: true },
          )
          .setTimestamp();

        await addLog('CMD_AGENT', { agent: membre.nom_rp }, interaction.user.id, utilisateur, 'bot');
        return interaction.editReply({ embeds: [embed] });
      } catch (e) {
        console.error('Erreur /agent:', e.message);
        return interaction.editReply('❌ Erreur lors de la recherche.');
      }
    }

    if (cmd === 'derniere-vente') {
      await interaction.deferReply();
      try {
        const db = getDb();
        const derniere = await db.collection('ventes').find().sort({ id: -1 }).limit(1).toArray();
        if (derniere.length === 0) {
          return interaction.editReply('ℹ️ Aucune vente enregistrée pour le moment.');
        }
        const v = derniere[0];
        const embed = new EmbedBuilder()
          .setTitle('🧾 Dernière vente enregistrée')
          .setColor(0x81c784)
          .addFields(
            { name: 'Bien', value: v.bien, inline: true },
            { name: 'Type', value: v.type, inline: true },
            { name: 'Prix', value: `${Number(v.prix).toLocaleString('fr-FR')} $`, inline: true },
            { name: 'Client', value: v.client, inline: true },
            { name: 'Agent', value: v.agent_nom, inline: true },
            { name: 'Date', value: v.date, inline: true },
          )
          .setTimestamp();
        await addLog('CMD_DERNIERE_VENTE', { message: `${v.bien} — ${v.client}` }, interaction.user.id, utilisateur, 'bot');
        return interaction.editReply({ embeds: [embed] });
      } catch (e) {
        console.error('Erreur /derniere-vente:', e.message);
        return interaction.editReply('❌ Erreur lors de la récupération.');
      }
    }

    if (cmd === 'service-liste') {
      await interaction.deferReply();
      try {
        const db = getDb();
        const enService = await db.collection('services').find({ fin: null }).toArray();
        if (enService.length === 0) {
          await addLog('CMD_SERVICE_LISTE', { message: 'Aucun agent en service' }, interaction.user.id, utilisateur, 'bot');
          return interaction.editReply('ℹ️ Aucun agent en service actuellement.');
        }
        const liste = enService.map(s => {
          const depuis = Math.floor((Date.now() - new Date(s.debut).getTime()) / 60000);
          return `• **${s.nom}** — depuis ${Math.floor(depuis / 60)}h${(depuis % 60).toString().padStart(2, '0')}`;
        }).join('\n');
        await addLog('CMD_SERVICE_LISTE', { message: `${enService.length} agent(s)` }, interaction.user.id, utilisateur, 'bot');
        return interaction.editReply({
          embeds: [{ title: `🟢 Agents en service (${enService.length})`, description: liste, color: 0x2ecc71 }],
        });
      } catch (e) {
        console.error('Erreur /service-liste:', e.message);
        return interaction.editReply('❌ Erreur lors de la récupération.');
      }
    }

    if (cmd === 'encheres') {
      await interaction.deferReply();
      try {
        const db = getDb();
        const actives = await db.collection('encheres').find({ statut: 'en_cours' }).toArray();
        if (actives.length === 0) {
          await addLog('CMD_ENCHERES', { message: 'Aucune enchère en cours' }, interaction.user.id, utilisateur, 'bot');
          return interaction.editReply('ℹ️ Aucune vente aux enchères en cours actuellement.');
        }
        const liste = actives.slice(0, 10).map(e =>
          `• **${e.nom}** — départ ${e.prixDepart.toLocaleString('fr-FR')}$ (coffre ${e.coffre.toLocaleString('fr-FR')}kg)`
        ).join('\n');
        await addLog('CMD_ENCHERES', { message: `${actives.length} enchère(s) en cours` }, interaction.user.id, utilisateur, 'bot');
        return interaction.editReply({
          embeds: [{ title: `🔨 Enchères en cours (${actives.length})`, description: liste, color: 0xa06bd6 }],
        });
      } catch (e) {
        console.error('Erreur /encheres:', e.message);
        return interaction.editReply('❌ Erreur lors de la récupération.');
      }
    }

    if (cmd === 'blacklist-check') {
      const id = interaction.options.getString('id', true).trim();
      await interaction.deferReply({ flags: 64 });
      try {
        const db = getDb();
        const [villa, deco] = await Promise.all([
          db.collection('blacklist_villa').findOne({ discord_id: id, fin_ts: { $gt: Date.now() } }),
          db.collection('blacklist_deco').findOne({ nom: id }),
        ]);
        await addLog('CMD_BLACKLIST_CHECK', { id }, interaction.user.id, utilisateur, 'bot');
        if (!villa && !deco) {
          return interaction.editReply(`✅ Aucune blacklist active pour \`${id}\`.`);
        }
        const lignes = [];
        if (villa) lignes.push(`🏠 **Villa** — jusqu'au ${villa.fin}${villa.raison ? ` (${villa.raison})` : ''}`);
        if (deco) lignes.push(`🎨 **Déco** — jusqu'au ${deco.fin}${deco.raison ? ` (${deco.raison})` : ''}`);
        return interaction.editReply({
          embeds: [{ title: `🚫 Blacklist — ${id}`, description: lignes.join('\n'), color: 0xed4245 }],
        });
      } catch (e) {
        console.error('Erreur /blacklist-check:', e.message);
        return interaction.editReply('❌ Erreur lors de la vérification.');
      }
    }

    // ── /bl-resa-villa ────────────────────────────────────────
    if (cmd === 'bl-resa-villa') {
      if (!(await verifierPermissionInteraction(interaction, 'hg'))) return;

      const userOption = interaction.options.getUser('user');
      const idOption = interaction.options.getString('id');
      const semaines = interaction.options.getInteger('semaines') ?? 2;
      const raison = interaction.options.getString('raison') || 'Villa non achetée avant la fin de la réservation';

      if (!userOption && !idOption) {
        return interaction.reply({ content: '⚠️ Renseigne soit `user`, soit `id`.', flags: 64 });
      }

      const discordId = userOption ? userOption.id : idOption.trim();
      let nomAffiche = userOption ? (userOption.globalName || userOption.username) : discordId;
      try {
        const guild = await discordClient.guilds.fetch(process.env.GUILD_ID);
        const membreCible = await guild.members.fetch(discordId);
        nomAffiche = membreCible.nickname || membreCible.user.globalName || membreCible.user.username;
      } catch (e) { /* membre pas trouvable, on garde le nom par défaut */ }

      const finDate = new Date(Date.now() + semaines * 7 * 24 * 60 * 60 * 1000);
      const entry = {
        id: Date.now(),
        nom: nomAffiche,
        discord_id: discordId,
        raison,
        fin: finDate.toLocaleDateString('fr-FR'),
        fin_ts: finDate.getTime(),
      };

      try {
        await getDb().collection('blacklist_villa').insertOne(entry);
        await addLog('BL_VILLA_ADD', { nom: nomAffiche, raison }, interaction.user.id, utilisateur, 'bot');
        await rafraichirMessageBlList();

        return interaction.reply({
          embeds: [{
            title: 'Blacklist Réservation Villa',
            description: `🚫 **${nomAffiche}** (\`${discordId}\`) est blacklisté pour **${semaines} semaine(s)**.\nRaison : ${raison}\nFin : ${entry.fin}`,
            color: 0xc0392b,
          }],
          flags: 64,
        });
      } catch (e) {
        console.error('Erreur bl-resa-villa:', e.message);
        return interaction.reply({ content: "❌ Erreur lors de l'ajout à la blacklist.", flags: 64 });
      }
    }

    // ── /unbl-resa-villa ──────────────────────────────────────
    if (cmd === 'unbl-resa-villa') {
      if (!(await verifierPermissionInteraction(interaction, 'hg'))) return;

      const userOption = interaction.options.getUser('user');
      const idOption = interaction.options.getString('id');
      if (!userOption && !idOption) {
        return interaction.reply({ content: '⚠️ Renseigne soit `user`, soit `id`.', flags: 64 });
      }
      const discordId = userOption ? userOption.id : idOption.trim();

      try {
        const db = getDb();
        const existants = await db.collection('blacklist_villa').find({ discord_id: discordId }).toArray();
        if (existants.length === 0) {
          return interaction.reply({ content: "⚠️ Ce membre n'est pas dans la blacklist.", flags: 64 });
        }

        const nomAffiche = existants[0].nom;
        await db.collection('blacklist_villa').deleteMany({ discord_id: discordId });
        await addLog('BL_VILLA_DEL', { nom: nomAffiche }, interaction.user.id, utilisateur, 'bot');
        await rafraichirMessageBlList();

        return interaction.reply({
          embeds: [{
            title: 'Unblacklist Réservation Villa',
            description: `✅ **${nomAffiche}** (\`${discordId}\`) retiré de la blacklist.`,
            color: 0x2e7d32,
          }],
          flags: 64,
        });
      } catch (e) {
        console.error('Erreur unbl-resa-villa:', e.message);
        return interaction.reply({ content: '❌ Erreur lors du retrait.', flags: 64 });
      }
    }

    // ── /bl-list ──────────────────────────────────────────────
    if (cmd === 'bl-list') {
      if (!(await verifierPermissionInteraction(interaction, 'hg'))) return;

      try {
        const db = getDb();
        const loc = await db.collection('config').findOne({ _id: 'bl_list_message' });

        if (loc?.channelId && loc?.messageId) {
          try {
            const ancienChannel = await discordClient.channels.fetch(loc.channelId);
            const ancienMessage = await ancienChannel.messages.fetch(loc.messageId);
            await ancienMessage.delete();
          } catch (e) { /* déjà supprimé ou introuvable, on continue */ }
        }

        const embed = await construireEmbedBlList();
        const message = await interaction.reply({ embeds: [embed], fetchReply: true });

        await db.collection('config').updateOne(
          { _id: 'bl_list_message' },
          { $set: { channelId: message.channelId, messageId: message.id } },
          { upsert: true }
        );
      } catch (e) {
        console.error('Erreur bl-list:', e.message);
        return interaction.reply({ content: '❌ Erreur lors de la récupération de la liste.', flags: 64 });
      }
    }

    return;
  }

  if (!interaction.isButton() || !['prise_service', 'fin_service'].includes(interaction.customId)) return;

  const discordId = interaction.user.id;
  const nomAffiche = interaction.member?.nickname || interaction.user.username;
  const db = getDb();
  const enCours = await db.collection('services').findOne({ discord_id: discordId, fin: null });

  if (interaction.customId === 'prise_service' && enCours) {
    return interaction.reply({ content: '⚠️ Tu es déjà en service.', flags: 64 });
  }
  if (interaction.customId === 'fin_service' && !enCours) {
    return interaction.reply({ content: "⚠️ Tu n'es pas en service.", flags: 64 });
  }

  await interaction.deferReply({ flags: 64 });
  const result = await toggleServiceMembre(discordId, nomAffiche);

  if (result.statut === 'on') {
    return interaction.editReply({
      embeds: [{ description: '🟢 Service commencé. Bonne journée !', color: 0x2e7d32 }],
    });
  }
  const h = Math.floor(result.duree_minutes / 60);
  const m = result.duree_minutes % 60;
  return interaction.editReply({
    embeds: [{ description: `🔴 Service terminé. Durée : **${h}h${m > 0 ? m + 'm' : ''}**`, color: 0xc0392b }],
  });
});

// ---------------------------------------------------------------
// BLOCAGE AUTOMATIQUE DES TICKETS VILLA BLACKLISTÉS
// ---------------------------------------------------------------
discordClient.on('channelCreate', async (channel) => {
  if (!process.env.CATEGORIE_TICKETS_VILLA_ID) return;
  if (channel.parentId !== process.env.CATEGORIE_TICKETS_VILLA_ID) return;

  try {
    const db = getDb();
    const overwritesMembre = channel.permissionOverwrites.cache.filter(o => o.type === 1);
    const botId = discordClient.user?.id;

    for (const [userId] of overwritesMembre) {
      if (userId === botId) continue;

      const bl = await db.collection('blacklist_villa').findOne({ discord_id: userId, fin_ts: { $gt: Date.now() } });
      if (bl) {
        try {
          const user = await discordClient.users.fetch(userId);
          await user.send(
            `🚫 Tu ne peux pas ouvrir de ticket de réservation de villa pour le moment.\n` +
            `Raison : ${bl.raison || 'Villa non achetée avant la fin de la réservation'}\n` +
            `Fin de la blacklist : ${bl.fin}`
          ).catch(() => {});
        } catch (e) {}

        await channel.delete(`Blacklist villa active pour ${userId}`).catch(e =>
          console.error('Erreur suppression ticket blacklisté:', e.message)
        );
        console.log(`🚫 Ticket villa bloqué pour utilisateur blacklisté : ${userId}`);
        break;
      }
    }
  } catch (e) {
    console.error('Erreur vérification blacklist villa:', e.message);
  }
});

// ---------------------------------------------------------------
// SALON "PING VENTE" — supprime immédiatement tout message de plus
// d'1 caractère. Les messages d'1 caractère restants sont balayés
// et supprimés par la purge périodique ci-dessous s'ils dépassent
// 1h (comportement repris de l'ancien server.js).
// ---------------------------------------------------------------
discordClient.on('messageCreate', async (message) => {
  if (message.channel.id !== SALON_PING_VENTE_ID) return;
  if (message.author.bot) return;

  if (message.content.length > 1) {
    await message.delete().catch(e =>
      console.error(`Suppression instantanée échouée (${message.id}):`, e.message)
    );
  }
  // Les messages d'1 caractère ne sont plus programmés individuellement :
  // ils seront nettoyés par le balayage périodique (voir ci-dessous).
});

// ---------------------------------------------------------------
// FILS DE VENTE — on enregistre simplement la création du thread ;
// le retrait des membres se fait lors du balayage périodique une
// fois le thread âgé de plus d'1h (comportement de l'ancien
// server.js), plutôt qu'un délai programmé fixe de 30min.
// ---------------------------------------------------------------
discordClient.on('threadCreate', async (thread) => {
  if (!process.env.SALON_VENTES_ID) return;
  if (thread.parentId !== process.env.SALON_VENTES_ID) return;

  await getDb().collection('threads_a_purger').insertOne({
    thread_id: thread.id,
    channel_id: thread.parentId,
    cree_a: Date.now(),
    purge: false,
  });
});

function login(tentative = 1) {
  if (!process.env.BOT_TOKEN) {
    console.error('❌ BOT_TOKEN manquant — bot Discord non démarré.');
    return Promise.resolve();
  }
  const MAX_TENTATIVES = 5;
  const delaiMs = Math.min(30000, 2000 * 2 ** (tentative - 1)); // backoff exponentiel, plafonné à 30s

  return discordClient.login(process.env.BOT_TOKEN).catch(e => {
    console.error(`❌ Erreur login bot Discord (tentative ${tentative}/${MAX_TENTATIVES}):`, e.message);
    if (tentative >= MAX_TENTATIVES) {
      console.error('❌ Abandon de la connexion du bot Discord après plusieurs tentatives.');
      return;
    }
    console.log(`🔄 Nouvelle tentative de connexion Discord dans ${delaiMs / 1000}s...`);
    return new Promise(resolve => setTimeout(resolve, delaiMs)).then(() => login(tentative + 1));
  });
}

// Reconnexion automatique si le client se déconnecte de manière inattendue
// (ex: coupure réseau, Discord qui redémarre le gateway) — sans ça, le bot
// resterait silencieusement hors ligne comme lors de l'incident du 503.
discordClient.on('shardDisconnect', () => {
  console.warn('⚠️ Bot Discord déconnecté du gateway — tentative de reconnexion...');
});
discordClient.on('error', (e) => {
  console.error('❌ Erreur client Discord:', e.message);
});

// ---------------------------------------------------------------
// BALAYAGE PÉRIODIQUE (toutes les 5min) — comportement repris de
// l'ancien server.js : purge les fils de vente âgés de plus d'1h,
// et nettoie le salon "Ping vente" (messages >1 caractère ratés,
// ou messages d'1 caractère âgés de plus d'1h).
// ---------------------------------------------------------------
async function purgerAnciensThreadsEtMessages() {
  const db = getDb();
  const maintenant = Date.now();
  const seuil = maintenant - SEUIL_AGE_PURGE_MS;

  // 1. Purge des membres des fils de vente âgés de plus d'1h
  try {
    const threadsAPurger = await db.collection('threads_a_purger')
      .find({ purge: false, cree_a: { $lte: seuil } })
      .toArray();

    for (const t of threadsAPurger) {
      try {
        const thread = await discordClient.channels.fetch(t.thread_id).catch(() => null);
        if (thread) {
          const membres = await thread.members.fetch();
          for (const [userId] of membres) {
            if (userId === discordClient.user?.id) continue;
            await thread.members.remove(userId).catch(e =>
              console.error(`❌ Retrait ${userId} du thread ${t.thread_id} échoué:`, e.message)
            );
          }
        } else {
          console.log(`ℹ️ Thread ${t.thread_id} introuvable (supprimé ?).`);
        }
      } catch (e) {
        console.error(`Erreur purge thread ${t.thread_id}:`, e.message);
      }
      await db.collection('threads_a_purger').updateOne({ _id: t._id }, { $set: { purge: true } });
    }
  } catch (e) {
    console.error('Erreur purge threads:', e.message);
  }

  // 2. Balayage du salon "Ping vente" : supprime tout message >1 caractère
  //    (filet de sécurité) ou tout message d'1 caractère âgé de plus d'1h
  try {
    const channel = await discordClient.channels.fetch(SALON_PING_VENTE_ID).catch(() => null);
    if (channel && channel.isTextBased()) {
      const messages = await channel.messages.fetch({ limit: 100 });
      const aSupprimer = messages.filter(msg => {
        const estTropLong = msg.content.length > 1;
        const estTropVieux = (maintenant - msg.createdTimestamp) >= SEUIL_AGE_PURGE_MS;
        return estTropLong || estTropVieux;
      });
      if (aSupprimer.size > 0) {
        await channel.bulkDelete(aSupprimer, true);
        console.log(`🧹 ${aSupprimer.size} message(s) supprimé(s) dans #${channel.name}`);
      }
    }
  } catch (e) {
    console.error('Erreur balayage salon ping vente:', e.message);
  }
}

discordClient.once('ready', () => {
  console.log(`✅ Bot Discord connecté : ${discordClient.user.tag}`);
  console.log(`🔎 SALON_PING_VENTE_ID configuré : ${SALON_PING_VENTE_ID}`);
  console.log(`🔎 SALON_VENTES_ID configuré : ${process.env.SALON_VENTES_ID || '(non défini)'}`);
  majSalonVentes();
  purgerAnciensThreadsEtMessages();
  setInterval(purgerAnciensThreadsEtMessages, INTERVALLE_PURGE_MS);
});

async function getRolesDiscordMembre(discordId) {
  try {
    const guild = await discordClient.guilds.fetch(process.env.GUILD_ID);
    const membre = await guild.members.fetch(discordId);
    return membre.roles.cache.map(r => r.id);
  } catch (e) {
    return null; // plus sur le serveur (kick/leave)
  }
}

module.exports = { discordClient, toggleServiceMembre, majSalonVentes, setSocketIO, login, getRolesDiscordMembre };