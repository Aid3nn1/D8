// ================================================================
//  LOGGER — écrit chaque action dans la collection "logs".
// ================================================================
const { getDb } = require('./db');

async function addLog(type, details, agentId, agentNom, source = 'site') {
  try {
    const now = new Date();
    await getDb().collection('logs').insertOne({
      id: Date.now() + Math.random(), // évite le conflit avec l'index unique "id"
      type,
      details,
      source, // 'site' ou 'bot' — permet de filtrer les deux onglets de la page Logs
      agent_id: agentId || null,
      agent_nom: agentNom || 'Inconnu',
      date: now.toLocaleDateString('fr-FR'),
      heure: now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      dateISO: now.toISOString().split('T')[0],
      created_at: now,
    });
  } catch (e) {
    console.error('Erreur addLog:', e.message);
  }
}

module.exports = { addLog };