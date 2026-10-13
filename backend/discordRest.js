// ================================================================
//  DISCORD REST — post/édition/suppression des ventes sur Discord,
//  gestion des threads, envoi de DM avec certificat PDF.
// ================================================================
const axios = require('axios');
const FormData = require('form-data');

async function axiosAvecRetry(fn, maxTentatives = 3, delaiMs = 1500) {
  let derniereErreur;
  for (let tentative = 1; tentative <= maxTentatives; tentative++) {
    try {
      return await fn();
    } catch (e) {
      derniereErreur = e;
      console.error(`Tentative ${tentative}/${maxTentatives} échouée:`, e.response?.data || e.message);
      if (tentative < maxTentatives) await new Promise(r => setTimeout(r, tentative * delaiMs));
    }
  }
  throw derniereErreur;
}

function buildEmbed({ bien, type, duree, prix, client, tel, agent_nom, date, modifiee = false }) {
  return {
    title: modifiee ? '🏠 Transaction Dynasty 8 (modifiée)' : '🏠 Nouvelle Transaction — Dynasty 8',
    color: modifiee ? 0x1565c0 : 0x2e7d32,
    fields: [
      { name: '🏡 Intérieur', value: bien || '—', inline: false },
      { name: '📋 Choix', value: type || '—', inline: false },
      { name: '⏱️ Durée', value: duree || '—', inline: false },
      { name: '💵 Prix', value: prix || '—', inline: false },
      { name: '👤 Client', value: client || '—', inline: false },
      { name: '📞 Téléphone', value: tel || '—', inline: false },
      { name: '🤝 Agent', value: agent_nom || '—', inline: false },
    ],
    footer: { text: modifiee ? `Dynasty 8 • Modifiée le ${new Date().toLocaleDateString('fr-FR')}` : `Dynasty 8 • ${date || ''}` },
    timestamp: new Date().toISOString(),
  };
}

async function posterVenteDiscord(data) {
  const fd = new FormData();
  fd.append('payload_json', JSON.stringify({ embeds: [buildEmbed(data)] }));
  if (data.pdfBase64) {
    fd.append('files[0]', Buffer.from(data.pdfBase64, 'base64'), {
      filename: `${data.nomDuFil || 'certificat'}.pdf`,
      contentType: 'application/pdf',
    });
  }

  const webhookRes = await axiosAvecRetry(() =>
    axios.post(process.env.WEBHOOK_URL + '?wait=true', fd, { headers: fd.getHeaders() })
  );
  const messageId = webhookRes.data.id;
  const channelId = webhookRes.data.channel_id;

  let threadId = null;
  try {
    const threadRes = await axios.post(
      `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/threads`,
      { name: data.nomDuFil || `${data.type} - ${data.bien} - ${data.client}`, auto_archive_duration: 1440 },
      { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    threadId = threadRes.data.id;
  } catch (e) {
    console.error('Erreur création thread:', e.response?.data || e.message);
  }

  return { messageId, channelId, threadId };
}

async function modifierVenteDiscord(vente, data) {
  const fd = new FormData();
  fd.append('payload_json', JSON.stringify({ embeds: [buildEmbed({ ...data, modifiee: true })] }));
  if (data.pdfBase64) {
    fd.append('files[0]', Buffer.from(data.pdfBase64, 'base64'), {
      filename: `${data.nomDuFil || 'certificat'}.pdf`,
      contentType: 'application/pdf',
    });
  }

  await axiosAvecRetry(() =>
    axios.patch(`${process.env.WEBHOOK_URL}/messages/${vente.discord_message_id}`, fd, { headers: fd.getHeaders() })
  );

  if (vente.discord_thread_id) {
    try {
      await axios.patch(
        `https://discord.com/api/v10/channels/${vente.discord_thread_id}`,
        { name: data.nomDuFil || `${data.type} - ${data.bien} - ${data.client}` },
        { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}`, 'Content-Type': 'application/json' } }
      );
    } catch (e) {
      console.error('Erreur renommage thread:', e.response?.data || e.message);
    }
  }
}

async function supprimerVenteDiscord(vente) {
  if (vente.discord_thread_id) {
    try {
      await axios.delete(`https://discord.com/api/v10/channels/${vente.discord_thread_id}`, {
        headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` },
      });
    } catch (e) {
      console.error('Erreur suppression thread Discord:', e.response?.data || e.message);
    }
  }
  if (vente.discord_message_id) {
    try {
      await axios.delete(`${process.env.WEBHOOK_URL}/messages/${vente.discord_message_id}`);
    } catch (e) {
      console.error('Erreur suppression message Discord:', e.response?.data || e.message);
    }
  }
}

async function envoyerCertificatDM({ discordUserId, clientName, bien, type, duree, prix, date, pdfBase64, isCorrection }) {
  const dmRes = await axios.post(
    'https://discord.com/api/v10/users/@me/channels',
    { recipient_id: discordUserId },
    { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}`, 'Content-Type': 'application/json' } }
  );
  const channelId = dmRes.data.id;

  if (isCorrection) {
    try {
      await axios.post(
        `https://discord.com/api/v10/channels/${channelId}/messages`,
        { embeds: [{ description: "⚠️ **Ne prenez pas en compte le document qui vient de vous être envoyé, il contenait une erreur.**\nVoici la version corrigée ci-dessous.", color: 0xe0a800 }] },
        { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}`, 'Content-Type': 'application/json' } }
      );
    } catch (e) { console.error('Erreur message avertissement:', e.response?.data || e.message); }
  }

  const embed = {
    title: isCorrection ? '🏠 Document Dynasty 8 corrigé' : '🏠 Votre document Dynasty 8',
    description: isCorrection
      ? 'Voici la version corrigée de votre certificat officiel Dynasty 8.'
      : 'Bonjour, veuillez trouver ci-joint votre certificat officiel Dynasty 8.',
    color: isCorrection ? 0x1565c0 : 0x2e7d32,
    fields: [
      { name: '🏡 Intérieur', value: bien || '—', inline: false },
      { name: '📋 Choix', value: type || '—', inline: false },
      { name: '⏱️ Durée', value: duree || '—', inline: false },
      { name: '💵 Prix', value: prix || '—', inline: false },
    ],
    footer: { text: `Dynasty 8 — Los Santos • ${date || ''}` },
    timestamp: new Date().toISOString(),
  };
  const fd = new FormData();
  fd.append('payload_json', JSON.stringify({ embeds: [embed] }));
  if (pdfBase64) {
    fd.append('files[0]', Buffer.from(pdfBase64, 'base64'), {
      filename: `certificat_D8_${(clientName || 'client').replace(/\s+/g, '_')}.pdf`,
      contentType: 'application/pdf',
    });
  }
  await axios.post(`https://discord.com/api/v10/channels/${channelId}/messages`, fd, {
    headers: { Authorization: `Bot ${process.env.BOT_TOKEN}`, ...fd.getHeaders() },
  });
}

async function updateVentesChannelCount(db) {
  try {
    const total = await db.collection('ventes').countDocuments();
    console.log(`📊 Total ventes : ${total} (mise à jour du salon vocal à faire côté bot.js)`);
  } catch (e) {
    console.error('Erreur comptage ventes:', e.message);
  }
}

async function envoyerWebhookGenerique(webhookUrl, content, pdfBase64, filename) {
  if (!webhookUrl) throw new Error('Aucune URL de webhook configurée');
  const fd = new FormData();
  fd.append('payload_json', JSON.stringify({ content }));
  if (pdfBase64) {
    fd.append('files[0]', Buffer.from(pdfBase64, 'base64'), {
      filename: filename || 'document.pdf',
      contentType: 'application/pdf',
    });
  }
  await axios.post(webhookUrl, fd, { headers: fd.getHeaders() });
}

module.exports = { posterVenteDiscord, modifierVenteDiscord, supprimerVenteDiscord, envoyerCertificatDM, updateVentesChannelCount, envoyerWebhookGenerique };