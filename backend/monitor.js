const axios = require("axios");

const SITE_URL        = "https://dynasty8-skyfa.sub-yorkhost.fr";
const WEBHOOK_MONITOR = "https://discord.com/api/webhooks/1522786017680031896/eSVG2N5U4YadEFewZyETLhn1144TbKOUop6Ya0TYTqmLLmBgPFoj5l7qAjMvPSsNChDR";
const PING_USER_ID    = "596460087330078738";
const CHECK_INTERVAL  = 60 * 1000;
const TIMEOUT         = 10 * 1000;
const LOGO_URL        = "https://imgg.fr/r/DearKTI7.png";

let dernierStatut = "ok";

async function verifierSite() {
    const debut = Date.now();
    try {
        const res = await axios.get(SITE_URL, { timeout: TIMEOUT });
        const duree = Date.now() - debut;

        if (res.status !== 200) {
            await envoyerAlerte(`❌ **Erreur HTTP ${res.status}**`, `Le site a répondu avec le code ${res.status}.`, duree);
            dernierStatut = "error";
            return;
        }

        if (duree > 5000) {
            await envoyerAlerte(`⚠️ **Site lent**`, `Le site a mis **${duree}ms** à répondre (seuil : 5000ms).`, duree);
            dernierStatut = "slow";
            return;
        }

        if (dernierStatut !== "ok") {
            await axios.post(WEBHOOK_MONITOR, {
                content: `<@${PING_USER_ID}>`,
                username: "Monitor - Dynasty8",
                avatar_url: LOGO_URL,
                embeds: [{
                    description: `✅ **Site de retour en ligne**\n\n⏱️ Temps de réponse : **${duree}ms**`,
                    color: 0x2ecc71,
                    timestamp: new Date().toISOString(),
                    footer: { text: "Dynasty 8 — Monitor" }
                }]
            });
        }

        dernierStatut = "ok";

    } catch(e) {
        const duree = Date.now() - debut;
        const message = e.code === "ECONNABORTED"
            ? `⏱️ **Timeout** — Le site n'a pas répondu en ${TIMEOUT / 1000}s`
            : `🔴 **Site inaccessible** — ${e.message}`;

        await envoyerAlerte(message, `Erreur : \`${e.code || e.message}\``, duree);
        dernierStatut = "error";
    }
}

async function envoyerAlerte(titre, detail, duree) {
    try {
        await axios.post(WEBHOOK_MONITOR, {
            content: `<@${PING_USER_ID}>`,
            username: "Monitor - Dynasty8",
            avatar_url: LOGO_URL,
            embeds: [{
                description: `${titre}\n\n${detail}\n\n⏱️ Temps de réponse : **${duree}ms**`,
                color: 0xe74c3c,
                timestamp: new Date().toISOString(),
                footer: { text: "Dynasty 8 — Monitor" }
            }]
        });
    } catch(e) {
        console.error("Erreur envoi alerte webhook:", e.message);
    }
}

console.log("🔍 Monitor Dynasty8 démarré — vérification toutes les 60s");
verifierSite();
setInterval(verifierSite, CHECK_INTERVAL);