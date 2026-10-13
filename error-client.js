// ================================================================
//  ERROR CLIENT — capture les erreurs du navigateur + interface du
//  journal d'erreurs (page Config).
//  À charger AVANT main.js dans index.html.
// ================================================================
(function () {
  const API = (location.hostname === '127.0.0.1' || location.hostname === 'localhost')
    ? 'http://localhost:3000'
    : 'https://dynasty8-skyfa.sub-yorkhost.fr';

  // ==============================================================
  //  1. CAPTURE
  // ==============================================================
  // Messages ignorés : coupures réseau / redémarrage du VPS (502) et bruits classiques
  const BRUIT = [
    /failed to fetch/i, /networkerror/i, /load failed/i, /network request failed/i,
    /\b502\b/, /bad gateway/i, /resizeobserver loop/i, /^script error\.?$/i,
  ];
  const dejaVus = new Map();
  let envoyes = 0;

  function signaler(payload) {
    try {
      if (!window.currentUser) return; // pas connecté → le serveur refuserait
      const message = String(payload.message || '');
      if (!message || BRUIT.some(re => re.test(message))) return;
      if (envoyes >= 20) return; // plafond par chargement de page

      const cle = `${payload.type}|${message}`;
      const maintenant = Date.now();
      if (dejaVus.has(cle) && maintenant - dejaVus.get(cle) < 60000) return;
      dejaVus.set(cle, maintenant);
      envoyes++;

      let page = '';
      try { page = _currentPageKey; } catch (_) {}

      fetch(`${API}/api/errors/client`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, message, page, url: location.pathname }),
      }).catch(() => {});
    } catch (_) {}
  }

  function enTexte(a) {
    if (a instanceof Error) return a.message;
    if (typeof a === 'string') return a;
    try { return String(JSON.stringify(a)).slice(0, 200); } catch (_) { return String(a); }
  }

  window.addEventListener('error', (ev) => {
    signaler({
      type: 'window.onerror',
      message: ev.message || ev.error?.message,
      stack: ev.error?.stack,
      fichier: ev.filename, ligne: ev.lineno, colonne: ev.colno,
    });
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason;
    signaler({ type: 'unhandledrejection', message: r?.message || String(r), stack: r?.stack });
  });

  // Une grande partie du code de main.js attrape les erreurs dans des try/catch
  // puis fait console.error(...) : on les récupère ici.
  const consoleErrorOrigine = console.error.bind(console);
  console.error = function (...args) {
    consoleErrorOrigine(...args);
    try {
      const err = args.find(a => a instanceof Error);
      signaler({ type: 'console.error', message: args.map(enTexte).join(' '), stack: err?.stack });
    } catch (_) {}
  };

  // ==============================================================
  //  2. INTERFACE — page Config > "Journal d'erreurs"
  // ==============================================================
  let erreurs = [];

  function echapper(s) {
    return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function filtreActuel() {
    return document.getElementById('cfgErreursFiltre')?.value || 'nouveau';
  }

  function rendreErreurs() {
    const tbody = document.getElementById('cfgErreursBody');
    const badge = document.getElementById('cfgErreursBadge');
    if (!tbody) return;

    const aTraiter = erreurs.filter(e => e.statut !== 'corrige').length;
    if (badge) {
      badge.textContent = aTraiter === 0 ? 'Aucune erreur' : `${aTraiter} à traiter`;
      badge.className = `cfg-badge ${aTraiter === 0 ? 'off' : 'on'}`;
    }

    if (erreurs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="logs-empty">Aucune erreur enregistrée 🎉</td></tr>`;
      return;
    }

    tbody.innerHTML = erreurs.map(e => {
      const corrige = e.statut === 'corrige';
      const quand = new Date(e.last_seen).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      const source = e.source === 'navigateur' ? '🌐 Navigateur' : '🖥️ Serveur';
      const ou = [e.method, e.route || e.page].filter(Boolean).join(' ') || '—';
      return `
        <tr>
          <td style="color:var(--ink-faint);">${quand}</td>
          <td>${source}<div style="font-size:10.5px;color:var(--ink-faint);">${echapper(e.type)}</div></td>
          <td style="white-space:normal;max-width:420px;word-break:break-word;">${echapper(e.message)}</td>
          <td style="white-space:normal;max-width:220px;word-break:break-word;color:var(--ink-faint);">${echapper(ou)}</td>
          <td>${e.count}</td>
          <td>
            <div style="display:flex;gap:8px;align-items:center;">
              <button class="decorateur-toggle-pill ${corrige ? 'oui' : 'non'}" onclick="basculerStatutErreur(${e.id})">${corrige ? '✅ Corrigé' : '— À traiter'}</button>
              <button class="btn-supprimer" onclick="supprimerErreurConfig(${e.id})">🗑</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  async function raison(res) {
    let msg = '';
    try { msg = (await res.json()).error || ''; } catch (_) {}
    return `HTTP ${res.status}${msg ? ' — ' + msg : ''}`;
  }

  async function chargerErreursConfig() {
    try {
      const res = await fetch(`${API}/api/errors?statut=${filtreActuel()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      erreurs = await res.json();
    } catch (e) { console.warn("Erreur chargement journal d'erreurs:", e); }
    rendreErreurs();
  }

  async function telechargerErreursJSON() {
    if (erreurs.length === 0 && filtreActuel() === 'nouveau') { alert('✅ Aucune erreur à exporter.'); return; }
    try {
      const res = await fetch(`${API}/api/errors/export?statut=${filtreActuel()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `erreurs_dynasty8_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (e) { alert("❌ Impossible de télécharger le journal d'erreurs."); }
  }

  async function basculerStatutErreur(id) {
    const err = erreurs.find(e => e.id === id);
    if (!err) return;
    const nouveau = err.statut === 'corrige' ? 'nouveau' : 'corrige';
    try {
      const res = await fetch(`${API}/api/errors/${id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statut: nouveau }),
      });
      if (!res.ok) throw new Error();
      err.statut = nouveau;
      rendreErreurs();
    } catch (e) { alert('❌ Impossible de changer le statut.'); }
  }

  async function supprimerErreurConfig(id) {
    try {
      const res = await fetch(`${API}/api/errors/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error();
      erreurs = erreurs.filter(e => e.id !== id);
      rendreErreurs();
    } catch (e) { alert('❌ Impossible de supprimer cette erreur.'); }
  }

  async function viderErreursConfig(seulementCorrigees) {
    const msg = seulementCorrigees
      ? 'Supprimer toutes les erreurs marquées comme corrigées ?'
      : 'Supprimer TOUTES les erreurs du journal ?';
    if (!confirm(msg)) return;
    try {
      const res = await fetch(`${API}/api/errors${seulementCorrigees ? '?corriges=1' : ''}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(await raison(res));
      await chargerErreursConfig();
    } catch (e) { alert(`❌ Impossible de vider le journal : ${e.message}`); }
  }

  // Exposées pour les onclick="" de index.html et l'appel depuis genererConfig()
  window.chargerErreursConfig = chargerErreursConfig;
  window.telechargerErreursJSON = telechargerErreursJSON;
  window.basculerStatutErreur = basculerStatutErreur;
  window.supprimerErreurConfig = supprimerErreurConfig;
  window.viderErreursConfig = viderErreursConfig;
})();