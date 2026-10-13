// ================================================================
//  CONFIG — URL du backend, adaptée automatiquement à l'environnement
// ================================================================
const SERVER_URL = (location.hostname === '127.0.0.1' || location.hostname === 'localhost')
  ? 'http://localhost:3000'
  : 'https://dynasty8-skyfa.sub-yorkhost.fr';

let _sessionExpiree = false;
const _fetchOrig = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const res = await _fetchOrig(input, init);
  const url = typeof input === 'string' ? input : (input?.url || '');
  if (res.status === 401 && !_sessionExpiree && window.currentUser
      && url.startsWith(SERVER_URL) && !url.includes('/auth/me')) {
    _sessionExpiree = true;
    alert('⏱️ Session expirée, reconnexion nécessaire.');
    location.reload();
  }
  return res;
};

// ================================================================
//  HELPER IMAGES — vignettes Cloudinary légères (perf + anti-bug
//  d'affichage "images tranchées/compressées" sur les grilles avec
//  beaucoup de photos chargées d'un coup)
// ================================================================
function vignette(url, w = 300, h = 200) {
  if (!url) return '';
  if (url.includes('/upload/')) {
    return url.replace('/upload/', `/upload/w_${w},h_${h},c_fill,q_auto,f_auto/`);
  }
  return url;
}

async function chargerVentes() {
  try {
    const res = await fetch(`${SERVER_URL}/api/ventes`, { credentials: 'include' });
    if (res.ok) VENTES_DATA = await res.json();
  } catch (e) { console.error('Erreur chargement ventes:', e); }
}

async function chargerMembres() {
  try {
    const res = await fetch(`${SERVER_URL}/api/membres`, { credentials: 'include' });
    if (res.ok) MEMBRES_DATA = await res.json();
  } catch (e) { console.error('Erreur chargement membres:', e); }
}

// Upload générique vers Cloudinary (conversion WEBP auto côté serveur)
async function uploaderPhotos(fichiers) {
  const formData = new FormData();
  fichiers.forEach(f => formData.append('photos', f));
  const res = await fetch(`${SERVER_URL}/api/upload-photos`, {
    method: 'POST', credentials: 'include', body: formData
  });
  if (!res.ok) throw new Error("Échec de l'upload des photos");
  const data = await res.json();
  return data.urls; // tableau d'URLs Cloudinary (.webp)
}

async function initGate() {
  let user = null;
  try {
    const res = await fetch(`${SERVER_URL}/auth/me`, { credentials: 'include' });
    if (res.ok) user = await res.json();
  } catch (e) { console.error('Erreur chargement session:', e); }

  window.currentUser = user;

  let maintenance = { active: false, message: '', bypass: false };
  try {
    // credentials:'include' — nécessaire pour que le serveur connaisse
    // la session en cours et calcule le bypass éventuel.
    const res = await fetch(`${SERVER_URL}/api/maintenance`, { credentials: 'include' });
    if (res.ok) maintenance = await res.json();
  } catch (e) { console.error('Erreur chargement maintenance:', e); }

  // Maintenance active + pas de bypass (ni owner, ni ID whitelisté) → page maintenance
  if (maintenance.active && !maintenance.bypass) {
    showMaintenancePage(maintenance, !!user);
    return;
  }

  // Pas connecté → page login
  if (!user) {
    showLoginPage();
    return;
  }

  // Blocage d'accès individuel ou ban Discord — s'applique à tous sauf owner
  let accesRestreint = { bloque: false };
  try {
    const res = await fetch(`${SERVER_URL}/api/config/acces-restreint`, { credentials: 'include' });
    if (res.ok) accesRestreint = await res.json();
  } catch (e) { console.error('Erreur chargement accès restreint:', e); }
  if (accesRestreint.bloque) {
    showAccessRestreintPage(accesRestreint);
    return;
  }

  // Blocage d'accès aux clients (rôle "client" uniquement)
  if (user.role === 'client') {
    let accessClients = { bloque: false, message: '' };
    try {
      const res = await fetch(`${SERVER_URL}/api/config/access-clients`, { credentials: 'include' });
      if (res.ok) accessClients = await res.json();
    } catch (e) { console.error('Erreur chargement blocage clients:', e); }
    if (accessClients.bloque) {
      showClientsBlockedPage(accessClients);
      return;
    }
  }

  showApp(user);
}

function showClientsBlockedPage(config) {
  hideAllGates();
  document.getElementById('appRoot').style.display = 'none';
  const page = document.getElementById('page-maintenance');
  page.style.display = 'flex';
  document.getElementById('maintenanceMessage').textContent =
    config.message || "L'accès au site est temporairement réservé au personnel Dynasty 8.";
  const btnLogin = document.getElementById('btnLoginDiscordMaintenance');
  const btnLogout = document.getElementById('btnLogoutMaintenance');
  btnLogin.style.display = 'none';
  btnLogout.style.display = 'inline-flex';
  btnLogout.onclick = async () => {
    await fetch(`${SERVER_URL}/auth/logout`, { credentials: 'include' }).catch(() => {});
    location.reload();
  };
}

function hideAllGates() {
  document.getElementById('page-login').style.display = 'none';
  document.getElementById('page-maintenance').style.display = 'none';
}

async function deconnexionReelle() {
  await fetch(`${SERVER_URL}/auth/logout`, { credentials: 'include' }).catch(() => {});
  location.reload();
}

function showLoginPage() {
  hideAllGates();
  document.getElementById('appRoot').style.display = 'none';
  document.getElementById('page-login').style.display = 'flex';
  document.getElementById('btnLoginDiscord').href = `${SERVER_URL}/auth/discord`;
}

function showMaintenancePage(maintenance, estConnecte) {
  hideAllGates();
  document.getElementById('appRoot').style.display = 'none';
  const page = document.getElementById('page-maintenance');
  page.style.display = 'flex';
  document.getElementById('maintenanceMessage').textContent =
    maintenance.message || "Le site est actuellement en maintenance. Merci de revenir un peu plus tard 🙏";

  const btnLogin = document.getElementById('btnLoginDiscordMaintenance');
  const btnLogout = document.getElementById('btnLogoutMaintenance');

  if (estConnecte) {
    btnLogin.style.display = 'none';
    btnLogout.style.display = 'inline-flex';
    btnLogout.onclick = async () => {
      await fetch(`${SERVER_URL}/auth/logout`, { credentials: 'include' }).catch(() => {});
      location.reload();
    };
  } else {
    btnLogin.style.display = 'inline-flex';
    btnLogin.href = `${SERVER_URL}/auth/discord`;
    btnLogout.style.display = 'none';
  }
}

function showAccessRestreintPage(info) {
  hideAllGates();
  document.getElementById('appRoot').style.display = 'none';
  const page = document.getElementById('page-maintenance');
  page.style.display = 'flex';
  document.getElementById('maintenanceMessage').textContent =
    info.source === 'discord_ban'
      ? `Accès refusé — tu es banni du serveur Discord Dynasty 8. Motif : ${info.raison}`
      : `Accès refusé — ${info.raison}`;
  const btnLogin = document.getElementById('btnLoginDiscordMaintenance');
  const btnLogout = document.getElementById('btnLogoutMaintenance');
  btnLogin.style.display = 'none';
  btnLogout.style.display = 'inline-flex';
  btnLogout.onclick = async () => {
    await fetch(`${SERVER_URL}/auth/logout`, { credentials: 'include' }).catch(() => {});
    location.reload();
  };
}

async function showApp(user) {
  hideAllGates();
  document.getElementById('appRoot').style.display = 'block';
  await Promise.all([chargerVentes(), chargerMembres(), chargerBiens(), chargerDecorateurs(), chargerStylesDeco(), chargerBiensVideos(), chargerTaxes(), chargerCloture()]);
  genererStylesDecoSelects();
  genererFiltreAgents();
  genererVentes();
  appliquerVisibiliteSidebar(user.role);
  majStatsAccueil();
  majStatsDeco();
  initSocket();

  // Affiche la page d'accueil par défaut (sans marquer d'item de sidebar actif)
  ALL_PAGE_KEYS.forEach(k => {
    const pageId = (k === 'home-agence') ? 'page-agence'
                  : (k === 'home-deco') ? 'page-deco'
                  : `page-${k}`;
    const page = document.getElementById(pageId);
    if (page) page.style.display = 'none';
  });
  document.getElementById('page-agence').style.display = 'block';
}

const PAGE_ACCESS_MIN_ROLE = {
  'ressources': 'agent',
  'ventes': 'agent',
  'mon-espace': 'agent',
  'statistiques': 'hg',
  'encheres': 'hg',
  'permissions': 'hg',
  'logs': 'hg',
  'config': 'owner',
  'config-deco': 'owner',
};

function appliquerVisibiliteSidebar(role) {
  const niveau = ROLE_LEVELS[role] ?? 0;
  document.querySelectorAll('.side-item[data-page]').forEach(item => {
    const minRole = PAGE_ACCESS_MIN_ROLE[item.dataset.page];
    if (!minRole) return;
    item.style.display = niveau >= (ROLE_LEVELS[minRole] ?? 0) ? '' : 'none';
  });
  const profilEl = document.querySelector('.side-item[data-page="profil"]');
  if (profilEl) {
    const estDeco = role === 'decorateur' || window.currentUser?.isDecorateur || hasPermission('staff');
    profilEl.style.display = estDeco ? '' : 'none';
  }

  const maPageEl = document.getElementById('sideItemMaPage');
  if (maPageEl) {
    maPageEl.style.display = (role === 'decorateur' || window.currentUser?.isDecorateur) ? 'flex' : 'none';
  }

  // Masque les titres de section dont tous les items sont cachés
  document.querySelectorAll('.sidebar').forEach(sidebar => {
    let titre = null, visibles = 0;
    const fermer = () => { if (titre) titre.style.display = visibles ? '' : 'none'; };
    [...sidebar.children].forEach(el => {
      if (el.classList.contains('side-group-label')) {
        fermer();
        titre = el;
        visibles = 0;
      } else if (el.classList.contains('side-item') && el.style.display !== 'none') {
        visibles++;
      }
    });
    fermer();
  });
}

async function chargerBiens() {
  try {
    const res = await fetch(`${SERVER_URL}/api/biens`, { credentials: 'include' });
    if (res.ok) BIENS_DYNAMIQUES = await res.json();
  } catch (e) { console.error('Erreur chargement biens:', e); }
}

async function chargerTaxes() {
  try {
    const res = await fetch(`${SERVER_URL}/api/config/taxes`, { credentials: 'include' });
    if (res.ok) CFG_TAXES = await res.json();
  } catch (e) { console.error('Erreur chargement taxes:', e); }
}

async function chargerDecorateurs() {
  try {
    const res = await fetch(`${SERVER_URL}/api/decorateurs`, { credentials: 'include' });
    if (res.ok) DECORATEURS_DATA = await res.json();
  } catch (e) { console.error('Erreur chargement décorateurs:', e); }
}

let _serviceEnCours = false;
let _serviceEnCoursListe = [];
let _monServiceActif = false;

async function chargerServiceEnCours() {
  try {
    const res = await fetch(`${SERVER_URL}/api/service/en-cours`, { credentials: 'include' });
    if (res.ok) {
      _serviceEnCoursListe = await res.json();
      _monServiceActif = _serviceEnCoursListe.some(s => s.discord_id === window.currentUser?.id);
    }
  } catch (e) { console.error('Erreur chargement service en cours:', e); }
}

let _socket = null;

function initSocket() {
  if (typeof io === 'undefined' || _socket) return;
  _socket = io(SERVER_URL, { withCredentials: true });

  _socket.on('service:update', (data) => {
    _serviceEnCoursListe = data.agents || [];
    _monServiceActif = _serviceEnCoursListe.some(s => s.discord_id === window.currentUser?.id);

    if (_currentPageKey === 'mon-espace') renderBoutonService();

    const elService = document.getElementById('statHomeService');
    if (elService && _currentPageKey === 'home-agence') elService.textContent = data.enService;
  });
}

function estEnService(discordId) {
  return _serviceEnCoursListe.some(s => s.discord_id === discordId);
}

// ================================================================
//  CLÔTURE & PÉRIODE COURANTE — lie les ventes et les heures de
//  service affichées dans Statistiques à la période "depuis la
//  dernière clôture" (bouton 🔒 Close Semaine).
// ================================================================
let VENTES_CLOTURE_DATE = null; // ISO string, ou null si jamais clôturé
let HEURES_PAR_AGENT = {};      // minutes de service par agent, période courante

async function chargerCloture() {
  try {
    const res = await fetch(`${SERVER_URL}/api/ventes/cloture`, { credentials: 'include' });
    if (res.ok) VENTES_CLOTURE_DATE = (await res.json()).date || null;
  } catch (e) { console.error('Erreur chargement clôture:', e); }
}

let CLOTURES_DATES = [];   // dates ISO croissantes
let _meSemaineIdx = 0;     // 0 = semaine en cours, 1 = précédente, etc.

async function chargerClotures() {
  try {
    const res = await fetch(`${SERVER_URL}/api/ventes/clotures`, { credentials: 'include' });
    if (res.ok) CLOTURES_DATES = ((await res.json()).dates || []).sort();
  } catch (e) { console.error('Erreur chargement clôtures:', e); }
  if (_meSemaineIdx > CLOTURES_DATES.length) _meSemaineIdx = 0;
}

function getBornesSemaine(idx) {
  const d = CLOTURES_DATES.map(x => new Date(x).getTime());
  const n = d.length;
  if (idx === 0) return { debut: n ? d[n - 1] : 0, fin: Infinity };
  return { debut: d[n - idx - 1] ?? 0, fin: d[n - idx] ?? Infinity };
}

function estDansBornes(v, b) {
  const t = Number(v.id);
  return t >= b.debut && t < b.fin;
}

// v.id = Date.now() à la création de la vente, donc précis à la milliseconde
function estDepuisClotureVente(v) {
  if (!VENTES_CLOTURE_DATE) return true;
  return Number(v.id) >= new Date(VENTES_CLOTURE_DATE).getTime();
}

function renderSelecteurSemaines() {
  const wrap = document.getElementById('meSemaineWrap');
  const sel = document.getElementById('meSemaineSelect');
  if (!wrap || !sel) return;
  wrap.style.display = _mePeriode === 'semaine' ? 'block' : 'none';
  const d = CLOTURES_DATES;
  const fmt = iso => new Date(iso).toLocaleDateString('fr-FR');
  const opts = [`<option value="0">Semaine en cours${d.length ? ` (depuis le ${fmt(d[d.length - 1])})` : ''}</option>`];
  for (let k = 1; k <= d.length; k++) {
    const fin = d[d.length - k], debut = d[d.length - k - 1];
    opts.push(`<option value="${k}">${debut ? `Du ${fmt(debut)} au ${fmt(fin)}` : `Jusqu'au ${fmt(fin)}`}</option>`);
  }
  sel.innerHTML = opts.join('');
  sel.value = String(_meSemaineIdx);
}

function changerSemaineMonEspace(val) {
  _meSemaineIdx = Number(val) || 0;
  _mePagination.page = 1;
  genererMonEspace();
}

function voirEspaceAgent(nom) {
  if (!hasPermission('hg')) return;
  _meSelectedAgent = (nom === window.currentUser?.nom_rp) ? null : nom;
  _meSemaineIdx = 0;
  _mePeriode = 'semaine';
  _mePagination.page = 1;
  document.querySelectorAll('.me-periode-btn').forEach(b => b.classList.toggle('active', b.dataset.periode === 'semaine'));
  const item = document.querySelector('.side-item[data-page="mon-espace"]');
  if (item) showSection(item, 'mon-espace');
}

function estDepuisCloture(dateStr) {
  if (!VENTES_CLOTURE_DATE) return true; // jamais clôturé -> tout compte
  const [d, m, y] = dateStr.split('/');
  return new Date(Number(y), Number(m) - 1, Number(d)) >= new Date(VENTES_CLOTURE_DATE);
}

// Ventes de la période courante (depuis la dernière clôture, ou tout
// l'historique si aucune clôture n'a encore eu lieu).
function getVentesPeriodeCourante() {
  return VENTES_DATA.filter(estDepuisClotureVente);
}

function getNomRPParDiscordId(discordId) {
  const m = MEMBRES_DATA.find(mm => mm.discord_id === discordId);
  return m ? m.nom_rp : discordId;
}

async function chargerHeuresService(bornes = null) {
  HEURES_PAR_AGENT = {};
  const url = hasPermission('hg')
    ? `${SERVER_URL}/api/service/historique`
    : `${SERVER_URL}/api/service/historique/moi`;
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return;
    const services = await res.json();
    const debutPeriode = bornes ? bornes.debut : (VENTES_CLOTURE_DATE ? new Date(VENTES_CLOTURE_DATE).getTime() : 0);
    const finPeriode = bornes ? bornes.fin : Infinity;

    services.forEach(s => {
      const debut = new Date(s.debut).getTime();
      const fin = new Date(s.fin).getTime();
      if (!debut || !fin) return;
      const minutes = Math.round((Math.min(fin, finPeriode) - Math.max(debut, debutPeriode)) / 60000);
      if (minutes <= 0) return;
      const nom = getNomRPParDiscordId(s.discord_id) || s.nom_rp || s.agent_nom || s.discord_id;
      HEURES_PAR_AGENT[nom] = (HEURES_PAR_AGENT[nom] || 0) + minutes;
    });
  } catch (e) { console.error('Erreur chargement heures de service:', e); }
}

async function toggleMonService() {
  const btn = document.getElementById('btnMonService');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${SERVER_URL}/api/service/toggle`, { method: 'POST', credentials: 'include' });
    if (!res.ok) throw new Error('Échec');
    await chargerServiceEnCours();
    renderBoutonService();
  } catch (e) { alert('❌ Impossible de mettre à jour ton statut de service.'); }
  finally { if (btn) btn.disabled = false; }
}

async function forcerFinServiceAgent(discordId) {
  if (!confirm('Mettre fin au service de cet agent ?')) return;
  try {
    const res = await fetch(`${SERVER_URL}/api/service/toggle/${discordId}`, { method: 'POST', credentials: 'include' });
    if (!res.ok) throw new Error('Échec');
    await chargerServiceEnCours();
    renderBoutonService();
  } catch (e) { alert('❌ Impossible de mettre fin à ce service.'); }
}

function renderProfilMonEspace() {
  const wrap = document.getElementById('meProfilCard');
  if (!wrap) return;

  const agentCible = getAgentConnecte();
  const moi = window.currentUser?.nom_rp;
  const estMoi = agentCible === moi;
  const membre = MEMBRES_DATA.find(m => m.nom_rp === agentCible);

  const avatar = estMoi ? window.currentUser?.avatar : null;
  const discordId = estMoi ? window.currentUser?.id : (membre?.discord_id || '—');
  const pseudo = estMoi ? window.currentUser?.nom_hrp : (membre?.nom_hrp || '—');
  const role = (estMoi ? window.currentUser?.role : membre?.role) || 'agent';

  wrap.innerHTML = `
    <div class="me-profil-avatar">
      ${avatar
        ? `<img src="${avatar}" alt="${pseudo}">`
        : `<div class="me-profil-avatar-fallback">${(agentCible || '?').charAt(0).toUpperCase()}</div>`}
    </div>
    <div class="me-profil-infos">
      <div class="me-profil-nom">${agentCible}</div>
      <div class="me-profil-meta">
        <span class="role-badge ${role}">${ROLE_CONFIG[role]?.label || role}</span>
        <span class="me-profil-tag">@${pseudo}</span>
        <span class="me-profil-tag">ID: ${discordId}</span>
      </div>
    </div>
  `;
}

function renderBoutonService() {
  const wrap = document.getElementById('meServiceWrap');
  if (!wrap) return;

  const agentCible = getAgentConnecte();
  const moi = window.currentUser?.nom_rp;

  if (agentCible === moi) {
    wrap.innerHTML = `
      <button id="btnMonService" class="btn-service ${_monServiceActif ? 'actif' : ''}" onclick="toggleMonService()">
        ${_monServiceActif ? '🔴 Fin de service' : '🟢 Prise de service'}
      </button>`;
    return;
  }

  const membre = MEMBRES_DATA.find(m => m.nom_rp === agentCible);
  const actif = membre ? estEnService(membre.discord_id) : false;
  wrap.innerHTML = (hasPermission('hg') && actif)
    ? `<button class="btn-service actif" onclick="forcerFinServiceAgent('${membre.discord_id}')">🔴 Mettre fin au service de ${agentCible}</button>`
    : `<span style="font-size:12px;color:var(--ink-faint);">${actif ? 'En service' : 'Pas en service'}</span>`;
}

document.addEventListener('DOMContentLoaded', initGate);

async function majStatsAccueil() {
  const elBiens = document.getElementById('statHomeBiens');
  if (elBiens) elBiens.textContent = BIENS_DYNAMIQUES.length;

  let stats = null;
  try {
    const res = await fetch(`${SERVER_URL}/api/stats/agence`, { credentials: 'include' });
    if (res.ok) stats = await res.json();
  } catch (e) { console.error('Erreur stats accueil:', e); }

  const elAgents = document.getElementById('statHomeAgents');
  if (elAgents) elAgents.textContent = stats ? stats.agents : '—';

  const elService = document.getElementById('statHomeService');
  if (elService) {
    let enService = stats?.enService;
    if (enService === undefined && hasPermission('agent')) {
      try {
        const res = await fetch(`${SERVER_URL}/api/service/en-cours`, { credentials: 'include' });
        if (res.ok) enService = (await res.json()).length;
      } catch (e) {}
    }
    elService.textContent = enService ?? '—';
  }
}

function majStatsDeco() {
  const totalDecos = DECORATEURS_DATA.reduce((s, d) => s + (d.decos?.length || 0), 0);
  const biensDecores = Object.keys(BIENS_VIDEOS_DATA).length;
  const decorateursActifs = DECORATEURS_DATA.filter(d => (d.decos || []).length > 0).length;

  const elTotal = document.getElementById('statDecoTotal');
  const elBiens = document.getElementById('statDecoBiens');
  const elActifs = document.getElementById('statDecoActifs');
  if (elTotal) elTotal.textContent = totalDecos;
  if (elBiens) elBiens.textContent = biensDecores;
  if (elActifs) elActifs.textContent = decorateursActifs;
}

// ================================================================
//  NAVIGATION — commun à toutes les pages (mode + sidebar + sections)
// ================================================================

function goHome(){
  const isDeco = document.body.classList.contains('mode-deco');
  const sidebar = document.getElementById(isDeco ? 'sidebar-deco' : 'sidebar-agence');
  const homeItem = sidebar.querySelector('.side-item');
  showSection(homeItem, isDeco ? 'home-deco' : 'home-agence');
}

function setMode(mode){
  const isDeco = mode === 'deco';
  document.body.classList.toggle('mode-deco', isDeco);
  document.body.classList.toggle('mode-agence', !isDeco);
  document.getElementById('btn-agence').classList.toggle('active', !isDeco);
  document.getElementById('btn-deco').classList.toggle('active', isDeco);
  document.getElementById('sidebar-agence').style.display = isDeco ? 'none' : 'flex';
  document.getElementById('sidebar-deco').style.display = isDeco ? 'flex' : 'none';

  // Revient toujours sur la page d'accueil du mode choisi
  const sidebar = isDeco ? document.getElementById('sidebar-deco') : document.getElementById('sidebar-agence');
  const homeItem = sidebar.querySelector('.side-item');
  showSection(homeItem, isDeco ? 'home-deco' : 'home-agence');

  document.querySelector('.sidebar.open')?.classList.remove('open');
}

// Toutes les pages existantes de l'app. Chaque clé correspond à un
// <div id="page-<clé>"> dans index.html. Pour ajouter une future page,
// il suffit d'ajouter son id ici (et le div + son data-page dans le HTML).
const ALL_PAGE_KEYS = [
  'home-agence', 'catalogue', 'ressources', 'ventes',
  'mon-espace', 'statistiques', 'encheres', 'permissions', 'logs', 'config',
  'home-deco', 'decorateurs', 'styles', 'profil', 'deconnexion',
  'fiche-decorateur'
];

let _currentPageKey = 'home-agence';
const AUTOREFRESH_INTERVALLE_MS = 20000; // 20 secondes

function unModalEstOuvert() {
  return !!document.querySelector('.modal-overlay.open, .enchere-zoom-overlay.open, .decoProfilOverlay.open, #bienZoomOverlay.open, #decoProfilOverlay.open');
}

function rafraichirPageActive() {
  if (_sessionExpiree) return;
  if (!window.currentUser) return;
  if (unModalEstOuvert()) return;

  switch (_currentPageKey) {
    case 'home-agence': majStatsAccueil(); break;
    case 'catalogue': genererCatalogue(); break;
    case 'ventes': chargerVentes().then(rafraichirVentesAffichees); break;
    case 'mon-espace': chargerVentes().then(genererMonEspace); break;
    case 'statistiques': chargerVentes().then(genererStatistiques); break;
    case 'encheres': chargerEncheres().then(genererEncheres); break;
    case 'permissions': chargerMembres().then(genererPermissions); break;
    case 'logs': genererLogs().then(genererLogsFiltres); break;
    case 'config': genererConfig(); break;
    case 'home-deco': chargerDecorateurs().then(() => { genererDerniereDecos(); majStatsDeco(); }); break;
    case 'decorateurs': chargerDecorateurs().then(genererPageDecorateurs); break;
    // 'profil' retiré : c'est un formulaire, on ne rafraîchit jamais une saisie en cours
    case 'config-deco': genererConfigDeco(); break;
  }
}

setInterval(rafraichirPageActive, AUTOREFRESH_INTERVALLE_MS);

function showSection(el, key){
  // Met à jour l'item actif dans la sidebar visible
  _currentPageKey = key;
  const sidebar = el.closest('.sidebar');
  sidebar.querySelectorAll('.side-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');

  // Cache toutes les pages, puis n'affiche que celle demandée
  ALL_PAGE_KEYS.forEach(k => {
    const pageId = (k === 'home-agence') ? 'page-agence'
                  : (k === 'home-deco') ? 'page-deco'
                  : `page-${k}`;
    const page = document.getElementById(pageId);
    if (page) page.style.display = 'none';
  });

  const pageId = (key === 'home-agence') ? 'page-agence'
                : (key === 'home-deco') ? 'page-deco'
                : `page-${key}`;
  const page = document.getElementById(pageId);
  if (page) page.style.display = 'block';

  // Données à générer selon la page affichée
  if (key === 'catalogue') genererCatalogue(); // partie CATALOGUE
  if (key === 'ressources') genererRessources(); // partie RESSOURCES
  if (key === 'ventes') filtrerParAgent();          // partie VENTES
  if (key === 'mon-espace') genererMonEspace();   // partie MON ESPACE
  if (key === 'statistiques') genererStatistiques(); // partie STATISTIQUES
  if (key === 'encheres') { chargerEncheres().then(genererEncheres); } // partie ENCHÈRES
  if (key === 'permissions') genererPermissions(); // partie PERMISSIONS
  if (key === 'logs') { genererLogs().then(genererLogsFiltres); } // partie LOGS
  if (key === 'config') genererConfig(); // partie CONFIG
  // Partie déco
  if (key === 'home-deco') genererDerniereDecos(); // dernières décorations sur l'accueil déco
  if (key === 'decorateurs') genererPageDecorateurs(); // partie DÉCORATEURS
  if (key === 'profil') genererMonProfilDeco();          // partie MON PROFIL DÉCO
  if (key === 'config-deco') genererConfigDeco();        // partie CONFIG DÉCO

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('DOMContentLoaded', () => {
  genererRessources();
  genererFiltreAgents();
  filtrerParAgent();

  document.getElementById('filterVentes')?.addEventListener('change', filtrerParAgent);
  document.querySelector('.ventes-search')?.addEventListener('input', rechercherVentes);
  document.getElementById('filterDu')?.addEventListener('change', filtrerParAgent);
  document.getElementById('filterAu')?.addEventListener('change', filtrerParAgent);
  document.getElementById('filterPage')?.addEventListener('change', filtrerParAgent);

  document.querySelector('.hamburger-mobile')?.addEventListener('click', () => {
    document.querySelector('.sidebar:not([style*="display: none"])').classList.toggle('open');
  });
});

// ================================================================
//  PAGE : CATALOGUE — biens dynamiques, zoom, zones, déco
// ================================================================
let CATALOGUE_CATEGORIES_BASE = [];
let CATALOGUE_CATEGORIES_CUSTOM = [];
let BIENS_VIDEOS_DATA = {};
let _catalogueRechercheTerme = '';
let _catalogueCategorieFiltre = 'all';
let _cataloguePrixAchatMax = null;
let _cataloguePrixLocMax = null;
let _catalogueCoffreMin = null;
let _catalogueTri = 'recent';
let _bienZoomState = { images: [], index: 0 };
let _decoTypeActuelBien = 'video';

// Passe à true pour n'afficher dans le catalogue que les déco validées par le staff
const CATALOGUE_DECOS_VALIDEES_SEULEMENT = false;
let _catalogueDecoFiltre = 'all';

// Déco d'un bien = déco ajoutées sur le bien (BIENS_VIDEOS_DATA)
// + déco postées par les décorateurs (DECORATEURS_DATA) qui ciblent ce bien.
function getDecosDuBien(nomBien) {
  const directes = (BIENS_VIDEOS_DATA[nomBien] || []).map(d => ({ ...d, source: 'bien' }));
  const parDecorateurs = DECORATEURS_DATA.flatMap(dec =>
    (dec.decos || [])
      .filter(d => d.bien === nomBien && (!CATALOGUE_DECOS_VALIDEES_SEULEMENT || d.valide))
      .map(d => ({
        id: `dec-${dec.id}-${d.id}`,
        source: 'decorateur',
        decorateurId: dec.id,
        decorateurNom: dec.nom_rp,
        officiel: dec.officiel,
        decoId: d.id,
        nom: d.nom,
        type: d.type === 'video' ? 'video' : 'photo',
        url: d.type === 'video' ? d.video_url : (d.photos?.[0] || ''),
        photos: d.photos || [],
      }))
  );
  return [...directes, ...parDecorateurs];
}

// Rafraîchit compteur + liste du panneau déco dans la fiche d'un bien
function majPanneauDecoBien(nomBien) {
  const decos = getDecosDuBien(nomBien);
  const span = document.querySelector('#bienZoomDecoSection .zoom-deco-toggle span');
  if (span) span.textContent = `🎬 Décorations (${decos.length})`;
  const list = document.getElementById('bienZoomDecoList');
  if (list && !decos.length) list.innerHTML = '<p class="zoom-deco-empty">Aucune décoration pour le moment</p>';
  renderZoomDecoListBien(nomBien, decos);
}

async function chargerCategoriesCatalogue() {
  try {
    const res = await fetch(`${SERVER_URL}/api/config/categories`, { credentials: 'include' });
    if (res.ok) {
      const d = await res.json();
      CATALOGUE_CATEGORIES_BASE = d.base;
      CATALOGUE_CATEGORIES_CUSTOM = d.custom;
    }
  } catch (e) { console.error('Erreur chargement catégories:', e); }
}

async function chargerBiensVideos() {
  try {
    const res = await fetch(`${SERVER_URL}/api/biens-videos`, { credentials: 'include' });
    if (res.ok) BIENS_VIDEOS_DATA = await res.json();
  } catch (e) { console.error('Erreur chargement vidéos biens:', e); }
}

async function genererCatalogue() {
  await Promise.all([chargerBiens(), chargerCategoriesCatalogue(), chargerBiensVideos(), chargerDecorateurs()]);
  genererFiltreCategorieCatalogue();
  renderCatalogueGrid();
}

let _cataloguePagination = { page: 1, parPage: 24, options: [24, 48, 96] };

function allerPageCatalogue(p) {
  _cataloguePagination.page = p;
  renderCatalogueGrid();
  document.getElementById('page-catalogue')?.scrollIntoView({ behavior: 'smooth' });
}
function changerParPageCatalogue(v) { _cataloguePagination.parPage = v; _cataloguePagination.page = 1; renderCatalogueGrid(); }

function genererFiltreCategorieCatalogue() {
  const select = document.getElementById('catalogueFiltreCategorie');
  if (!select) return;
  const val = select.value;
  const toutes = [...CATALOGUE_CATEGORIES_BASE, ...CATALOGUE_CATEGORIES_CUSTOM];
  select.innerHTML = `<option value="all">Toutes catégories</option>` + toutes.map(c => `<option value="${c}">${c}</option>`).join('');
  if (toutes.includes(val)) select.value = val;
}

function filtrerCatalogueBiens() {
  _catalogueRechercheTerme = (document.getElementById('catalogueRecherche')?.value || '').toLowerCase();
  _catalogueCategorieFiltre = document.getElementById('catalogueFiltreCategorie')?.value || 'all';
  _cataloguePrixAchatMax = Number(document.getElementById('catalogueFiltrePrixAchatMax')?.value) || null;
  _cataloguePrixLocMax = Number(document.getElementById('catalogueFiltrePrixLocMax')?.value) || null;
  _catalogueCoffreMin = Number(document.getElementById('catalogueFiltreCoffreMin')?.value) || null;
  _catalogueTri = document.getElementById('catalogueTri')?.value || 'recent';
  _catalogueDecoFiltre = document.getElementById('catalogueFiltreDeco')?.value || 'all';
  _cataloguePagination.page = 1;
  renderCatalogueGrid();
}

function resetFiltresCatalogue() {
  document.getElementById('catalogueRecherche').value = '';
  document.getElementById('catalogueFiltreCategorie').value = 'all';
  document.getElementById('catalogueFiltrePrixAchatMax').value = '';
  document.getElementById('catalogueFiltrePrixLocMax').value = '';
  document.getElementById('catalogueFiltreCoffreMin').value = '';
  document.getElementById('catalogueTri').value = 'recent';
  document.getElementById('catalogueFiltreDeco').value = 'all';
  filtrerCatalogueBiens();
}

function renderCatalogueGrid() {
  const container = document.getElementById('catalogueContainer');
  if (!container) return;

  let liste = BIENS_DYNAMIQUES;
  if (_catalogueCategorieFiltre !== 'all') liste = liste.filter(b => b.categorie === _catalogueCategorieFiltre);
  if (_catalogueRechercheTerme) liste = liste.filter(b => b.nom.toLowerCase().includes(_catalogueRechercheTerme));
  if (_cataloguePrixAchatMax) liste = liste.filter(b => b.prixAchat <= _cataloguePrixAchatMax);
  if (_cataloguePrixLocMax) liste = liste.filter(b => b.prixLoc <= _cataloguePrixLocMax);
  if (_catalogueCoffreMin) liste = liste.filter(b => b.coffre >= _catalogueCoffreMin);
  if (_catalogueDecoFiltre === 'decore') liste = liste.filter(b => getDecosDuBien(b.nom).length > 0);
  else if (_catalogueDecoFiltre === 'non_decore') liste = liste.filter(b => getDecosDuBien(b.nom).length === 0);

  const comparateurs = {
    prix_achat_asc: (a, b) => a.prixAchat - b.prixAchat,
    prix_achat_desc: (a, b) => b.prixAchat - a.prixAchat,
    prix_loc_asc: (a, b) => a.prixLoc - b.prixLoc,
    prix_loc_desc: (a, b) => b.prixLoc - a.prixLoc,
    nom: (a, b) => a.nom.localeCompare(b.nom),
    recent: (a, b) => (a.id || 0) - (b.id || 0),
  };
  liste = [...liste].sort(comparateurs[_catalogueTri] || comparateurs.recent);

  if (liste.length === 0) {
    container.innerHTML = `<p class="ventes-empty" style="text-align:center;padding:40px 0;">Aucun bien ne correspond à votre recherche.</p>`;
    return;
  }

  const parCategorie = {};
  liste.forEach(b => {
    const cat = b.categorie || 'Autres';
    if (!parCategorie[cat]) parCategorie[cat] = [];
    parCategorie[cat].push(b);
  });

  container.innerHTML = Object.entries(parCategorie).map(([cat, biens]) => `
    <div class="catalogue-section" style="margin-bottom:36px;">
      <h3 style="margin:0 0 14px; font-size:18px; color:#173a24; border-bottom:2px solid var(--green); padding-bottom:6px; display:inline-block;">
        ${cat} <span style="font-size:12px;color:#999;font-weight:400;">(${biens.length})</span>
      </h3>
      <div class="property-grid">
        ${biens.map(b => renderCarteBienCatalogue(b)).join('')}
      </div>
    </div>
  `).join('');
}

function renderCarteBienCatalogue(b) {
  const decos = getDecosDuBien(b.nom);
  const aDeco = decos.length > 0;
  return `
    <div class="property-card" style="position:relative;cursor:pointer;" onclick="ouvrirZoomBien(${b.id})">
      <span style="position:absolute;top:8px;left:8px;z-index:2;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(0,0,0,0.55);color:${aDeco ? '#fff' : '#eee'};">
        ${aDeco ? `Décoré (${decos.length})` : 'Pas de déco'}
      </span>
      <img src="${vignette(b.images[0], 400, 300)}" loading="lazy" style="background:#0c2416;" onerror="this.src='assets/placeholder.png'">
      <div class="property-body">
        <h4>${b.nom}</h4>
        <div class="zone">${(b.zones || []).join(', ') || 'Zone non assignée'}</div>
        <div class="price">${b.prixAchat.toLocaleString('fr-FR')} $ <span style="font-size:11px;color:#888;font-weight:400;">/ ${b.prixLoc.toLocaleString('fr-FR')} $ sem</span></div>
      </div>
    </div>`;
}

// ---------- Zoom sur un bien ----------
function ouvrirZoomBien(id) {
  const bien = BIENS_DYNAMIQUES.find(b => b.id === id);
  if (!bien) return;
  _bienZoomState = { images: bien.images, index: 0 };
  const decos = getDecosDuBien(bien.nom);

  const mediaNavHTML = bien.images.length > 1 ? `
    <button class="enchere-zoom-nav prev" onclick="event.stopPropagation(); naviguerZoomPhotoBien(-1)">‹</button>
    <button class="enchere-zoom-nav next" onclick="event.stopPropagation(); naviguerZoomPhotoBien(1)">›</button>
    <div class="enchere-zoom-dots" id="bienZoomDots">${bien.images.map((_, i) => `<span class="dot ${i === 0 ? 'active' : ''}"></span>`).join('')}</div>` : '';

    const tauxAchat = CFG_TAXES?.achat ?? 0;
    const tauxLoc = CFG_TAXES?.location ?? 0;
    const prixAchatTTC = Math.round(bien.prixAchat * (1 + tauxAchat / 100));
    const prixLocTTC = Math.round(bien.prixLoc * (1 + tauxLoc / 100))
    const zonesHTML = (bien.zones && bien.zones.length)
    ? bien.zones.map(z => `<span class="zone-chip">${z}</span>`).join('')
    : `<span style="color:#999;font-size:12px;">Zone non assignée</span>`;

  const peutGerer = hasPermission('staff') || window.currentUser?.isDecorateur;

  document.getElementById('bienZoomOverlay').innerHTML = `
    <div class="enchere-zoom-card" onclick="event.stopPropagation()">
      <button class="modal-close enchere-zoom-close" onclick="fermerZoomBien()">✕</button>
      <div class="enchere-zoom-media">
        <img id="bienZoomImg" src="${vignette(bien.images[0], 900, 600)}" loading="lazy" style="background:#0c2416;" onerror="this.src='assets/placeholder.png'">
        ${mediaNavHTML}
        <div class="enchere-zoom-title">${bien.nom}</div>
      </div>
      <div class="enchere-zoom-body">
        <div class="enchere-zoom-price-row">
          <div class="enchere-zoom-pill"><span class="lbl">Achat (TTC)</span><span class="val">${prixAchatTTC.toLocaleString('fr-FR')}$</span></div>
          <div class="enchere-zoom-pill"><span class="lbl">Location / sem (TTC)</span><span class="val">${prixLocTTC.toLocaleString('fr-FR')}$</span></div>
          <div class="enchere-zoom-pill"><span class="lbl">Coffre</span><span class="val">${bien.coffre.toLocaleString('fr-FR')} kg</span></div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0;">${zonesHTML}</div>
        ${hasPermission('agent') ? `<button class="btn-vendre-zoom" onclick="demarrerVenteDepuisFicheBien(${bien.id})">🧾 Nouvelle vente sur ce bien</button>` : ''}
        <div class="zoom-deco-section" id="bienZoomDecoSection">
          <button class="zoom-deco-toggle" onclick="toggleDecoPanelBien()">
            <span>🎬 Décorations (${decos.length})</span>
            <i class="chevron">▾</i>
          </button>
          <div class="zoom-deco-panel" id="bienZoomDecoPanel">
            <div class="zoom-deco-list-wrap">
              <div id="bienZoomDecoList" class="zoom-deco-list">${decos.length ? '' : '<p class="zoom-deco-empty">Aucune décoration pour le moment</p>'}</div>
            </div>
            ${peutGerer ? `
            <button class="zoom-deco-add-btn" onclick="ouvrirFormDecoInlineBien()">+ Ajouter une décoration</button>
            <div class="deco-type-switch" id="bienDecoTypeSwitch" style="display:none;">
              <button type="button" class="deco-type-btn active" data-type="video" onclick="switchDecoTypeBien('video')">🎬 Vidéo</button>
              <button type="button" class="deco-type-btn" data-type="photo" onclick="switchDecoTypeBien('photo')">📸 Photo</button>
            </div>
            <div class="zoom-deco-form-row" id="bienDecoFormRow" style="display:none;margin-top:16px;">
              <input type="text" id="bienDecoNom" placeholder="Nom de la déco">
              <input type="url" id="bienDecoUrl" placeholder="https://youtube.com/...">
              <input type="file" id="bienDecoPhoto" accept="image/*" multiple style="display:none;">
              <input type="tel" id="bienDecoTel" placeholder="Numéro de téléphone" style="width:150px;">
              <input type="number" id="bienDecoPrix" placeholder="Prix (optionnel)" min="0" style="width:110px;">
              <button onclick="sauvegarderDecoBien('${bien.nom.replace(/'/g, "\\'")}')">Enregistrer</button>
            </div>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  document.getElementById('bienZoomOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  renderZoomDecoListBien(bien.nom, decos);
}

function fermerZoomBien() {
  document.getElementById('bienZoomOverlay').classList.remove('open');
  document.body.style.overflow = '';
}
function fermerZoomBienOutside(event) {
  if (event.target.id === 'bienZoomOverlay') fermerZoomBien();
}
function naviguerZoomPhotoBien(direction) {
  if (_bienZoomState.images.length < 2) return;
  _bienZoomState.index = (_bienZoomState.index + direction + _bienZoomState.images.length) % _bienZoomState.images.length;
  document.getElementById('bienZoomImg').src = vignette(_bienZoomState.images[_bienZoomState.index], 900, 600);
  document.querySelectorAll('#bienZoomDots .dot').forEach((d, i) => d.classList.toggle('active', i === _bienZoomState.index));
}

function demarrerVenteDepuisFicheBien(id) {
  const bien = BIENS_DYNAMIQUES.find(b => b.id === id);
  if (!bien) return;
  fermerZoomBien();
  openVenteModal();
  _venteSelectedBien = bien;
  document.getElementById('v_bien_preview').innerHTML = `
    <img src="${vignette(bien.images[0], 80, 80)}" loading="lazy" style="width:40px;height:40px;object-fit:cover;border-radius:6px;background:#f0f0ec;" onerror="this.src='assets/placeholder.png'">
    <span style="font-size:13px;font-weight:600;color:#222;">${bien.nom}</span>`;
  updatePrixAuto();
}

// ---------- Panneau déco (vidéo / photo) ----------
function toggleDecoPanelBien() {
  const panel = document.getElementById('bienZoomDecoPanel');
  const toggle = panel.closest('.zoom-deco-section').querySelector('.zoom-deco-toggle');
  const isOpen = panel.classList.toggle('open');
  toggle.classList.toggle('open', isOpen);
}

function ouvrirFormDecoInlineBien() {
  document.getElementById('bienDecoTypeSwitch').style.display = 'flex';
  document.getElementById('bienDecoFormRow').style.display = 'flex';
  document.querySelector('#bienZoomDecoSection .zoom-deco-add-btn').style.display = 'none';
  switchDecoTypeBien('video');
}

function switchDecoTypeBien(type) {
  _decoTypeActuelBien = type;
  document.querySelectorAll('#bienDecoTypeSwitch .deco-type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  const urlInput = document.getElementById('bienDecoUrl');
  const photoInput = document.getElementById('bienDecoPhoto');
  if (type === 'video') { urlInput.style.display = ''; photoInput.style.display = 'none'; }
  else { urlInput.style.display = 'none'; photoInput.style.display = ''; }
}

async function sauvegarderDecoBien(nomBien) {
  const nom = document.getElementById('bienDecoNom').value.trim();
  const tel = document.getElementById('bienDecoTel').value.trim();
  const prixVal = document.getElementById('bienDecoPrix').value.trim();
  const prix = prixVal ? Number(prixVal) : null;
  if (!nom) { alert('Merci de renseigner un titre.'); return; }

  let url = '';
  let photos = null;

  if (_decoTypeActuelBien === 'video') {
    url = document.getElementById('bienDecoUrl').value.trim();
    if (!url) { alert('Merci de renseigner un lien YouTube.'); return; }
  } else {
    const fichiers = document.getElementById('bienDecoPhoto').files;
    if (!fichiers || fichiers.length === 0) { alert('Merci de choisir au moins une photo.'); return; }
    try {
      photos = await uploaderPhotos(Array.from(fichiers));
      url = photos[0];
    } catch (e) { alert("Erreur lors de l'upload des photos."); return; }
  }

  try {
    const res = await fetch(`${SERVER_URL}/api/biens-videos`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bien: nomBien, nom, url, tel, prix, type: _decoTypeActuelBien, photos })
    });
    const saved = await res.json();
    if (!res.ok) { alert(`❌ ${saved.error || 'Erreur'}`); return; }

    if (!BIENS_VIDEOS_DATA[nomBien]) BIENS_VIDEOS_DATA[nomBien] = [];
    BIENS_VIDEOS_DATA[nomBien].push(saved);

    document.getElementById('bienDecoFormRow').style.display = 'none';
    document.getElementById('bienDecoTypeSwitch').style.display = 'none';
    document.querySelector('#bienZoomDecoSection .zoom-deco-add-btn').style.display = '';
    ['bienDecoNom', 'bienDecoUrl', 'bienDecoPhoto', 'bienDecoTel', 'bienDecoPrix'].forEach(id => document.getElementById(id).value = '');
    majPanneauDecoBien(nomBien);
    renderCatalogueGrid();
  } catch (e) { alert("❌ Erreur lors de l'enregistrement."); }
}

let _oembedCacheBien = {};
async function fetchYoutubeOembedBien(url) {
  if (_oembedCacheBien[url]) return _oembedCacheBien[url];
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (!res.ok) return null;
    const data = await res.json();
    _oembedCacheBien[url] = data;
    return data;
  } catch (e) { return null; }
}

function peutGererDecoBien(deco) {
  if (hasPermission('staff')) return true;
  if (window.currentUser?.isDecorateur) return String(deco.ajoute_par_id) === String(window.currentUser?.id);
  return false;
}

async function renderZoomDecoListBien(nomBien, decos) {
  const list = document.getElementById('bienZoomDecoList');
  if (!list || !decos.length) return;
  list.innerHTML = decos.map(d => `<div class="yt-embed" id="ytb-${d.id}" style="flex:0 0 320px;"><div class="yt-embed-skeleton">Chargement…</div></div>`).join('');

  for (const d of decos) {
    const el = document.getElementById(`ytb-${d.id}`);
    if (!el) continue;

    // Déco postée par un décorateur → carte cliquable qui ouvre la fiche de la déco
    if (d.source === 'decorateur') {
      const estVideo = d.type === 'video';
      const thumb = estVideo ? await fetchYoutubeThumb(d.url) : vignette(d.photos[0], 400, 225);
      el.innerHTML = `
        <div class="yt-embed-site">${estVideo ? '🎬 Vidéo' : `📸 Photo${d.photos.length > 1 ? `s (${d.photos.length})` : ''}`}</div>
        <div class="yt-embed-author">${d.officiel ? '✅' : '🎨'} ${escapeHtml(d.decorateurNom)}</div>
        <span class="yt-embed-title">${escapeHtml(d.nom)}</span>
        <div class="yt-embed-thumb-wrap" style="cursor:pointer;" onclick="ouvrirZoomDeco(${d.decorateurId}, ${d.decoId})">
          <img src="${thumb || 'assets/placeholder.png'}" loading="lazy" class="yt-embed-thumb" onerror="this.src='assets/placeholder.png'">
          ${estVideo ? '<div class="yt-embed-play">▶</div>' : ''}
        </div>`;
      continue;
    }

    // Déco ajoutée directement sur le bien (comportement d'origine)
    const prixHTML = `
      <div class="yt-embed-prix" style="margin-top:8px;font-size:13px;color:var(--green);font-weight:600;">
        ${d.prix ? `💰 ${Number(d.prix).toLocaleString('fr-FR')}$` : ''}
      </div>
      ${d.tel ? `<div style="margin-top:4px;font-size:12px;color:#666;">📞 ${d.tel}</div>` : ''}
      ${peutGererDecoBien(d) ? `<div class="yt-embed-actions"><button class="yt-embed-action-btn" onclick="supprimerDecoBien('${nomBien.replace(/'/g, "\\'")}', '${d.id}')">🗑️ Supprimer</button></div>` : ''}`;

    if (d.type === 'photo') {
      const photos = Array.isArray(d.photos) && d.photos.length ? d.photos : [d.url];
      el.innerHTML = `
        <div class="yt-embed-site">📸 Photo${photos.length > 1 ? `s (${photos.length})` : ''}</div>
        <span class="yt-embed-title">${d.nom}</span>
        <div class="yt-embed-thumb-wrap"><img src="${vignette(photos[0], 400, 225)}" loading="lazy" class="yt-embed-thumb" onerror="this.src='assets/placeholder.png'"></div>
        ${prixHTML}`;
      continue;
    }

    const info = await fetchYoutubeOembedBien(d.url);
    el.innerHTML = `
      <a class="yt-embed-site" href="${d.url}" target="_blank" rel="noopener">YouTube</a>
      <div class="yt-embed-author">${info?.author_name || 'Chaîne inconnue'}</div>
      <a class="yt-embed-title" href="${d.url}" target="_blank" rel="noopener">${d.nom}</a>
      <div class="yt-embed-thumb-wrap"><img src="${info?.thumbnail_url || ''}" loading="lazy" class="yt-embed-thumb"><div class="yt-embed-play">▶</div></div>
      ${prixHTML}`;
  }
}

async function supprimerDecoBien(nomBien, id) {
  if (!confirm('Supprimer cette décoration ?')) return;
  try {
    await fetch(`${SERVER_URL}/api/biens-videos/${encodeURIComponent(nomBien)}/${id}`, { method: 'DELETE', credentials: 'include' });
    BIENS_VIDEOS_DATA[nomBien] = (BIENS_VIDEOS_DATA[nomBien] || []).filter(d => String(d.id) !== String(id));
    majPanneauDecoBien(nomBien);
    renderCatalogueGrid();
  } catch (e) { alert('❌ Erreur lors de la suppression.'); }
}

// ================================================================
//  PAGE RESSOURCES — tout ce qui concerne les documents employés
// ================================================================
const RESSOURCES_DATA = [
  {
    id: 'infos-primordiales',
    titre: 'Document cohérences',
    image: 'assets/documents_coherences.png',
    lien: 'https://docs.google.com/presentation/d/1ygUzrEie1ZF9P0-uoiATFx3B-0lGBpSG8bpyzyI8dBg/edit?usp=drivesdk',
    texte_lien: 'Consulter le document'
  },
  {
    id: 'guides',
    titre: 'Cohérences entreprises',
    image: 'assets/documents_coherences.png',
    lien: 'https://docs.google.com/presentation/d/1Bq0CxPsaZ8A8fQxQ61VO_BiwjiVSNQnCGO-k8wXQJh8/edit',
    texte_lien: 'Consulter le document'
  },
  {
    id: 'ressources-avancees',
    titre: 'Cohérences illégal',
    image: 'assets/documents_coherences.png',
    lien: 'https://docs.google.com/presentation/d/1cMYx4Q3Uz38oZ5Oo_qdSoI3T7hxvpSuus-P_ECER7HI/edit',
    texte_lien: 'Consulter le document'
  }
];

function genererRessources() {
  const grid = document.getElementById('ressourcesGrid');
  if (!grid) return;

  grid.innerHTML = '';
  RESSOURCES_DATA.forEach(ressource => {
    const carte = document.createElement('div');
    carte.className = 'ressource-card';
    carte.innerHTML = `
      <div class="ressource-header">
        <img src="${ressource.image}" alt="${ressource.titre}" class="ressource-img" loading="lazy" />
      </div>
      <div class="ressource-body">
        <h3>${ressource.titre}</h3>
        ${ressource.description ? `<p>${ressource.description}</p>` : ''}
        <a href="${ressource.lien}" class="ressource-link" target="_blank" rel="noopener noreferrer">${ressource.texte_lien}</a>
      </div>
    `;
    grid.appendChild(carte);
  });
}


// ================================================================
//  PAGE VENTES — agents, données, tableau, recherche, filtre, modal
// ================================================================
const AGENTS_DATA = [];
const ROLES_AUTORISES = ['agent', 'hg', 'co_patron', 'owner'];

function genererFiltreAgents() {
  const select = document.getElementById('filterVentes');
  if (!select) return;
  select.innerHTML = `<option value="toutes">Toutes les ventes</option><option value="mes-ventes">Mes ventes</option>`;
  const nomsAutorises = new Set(MEMBRES_DATA.filter(m => ROLES_AUTORISES.includes(m.role)).map(m => m.nom_rp));
  const agentsUniques = [...new Set(VENTES_DATA.map(v => v.agent_nom).filter(Boolean))]
    .filter(nom => nomsAutorises.size === 0 || nomsAutorises.has(nom))
    .sort();
  agentsUniques.forEach(nom => {
    const option = document.createElement('option');
    option.value = nom;
    option.textContent = nom;
    select.appendChild(option);
  });
}

let VENTES_DATA = [];

function peutGererVente(v) {
  if (hasPermission('hg')) return true; // HG et plus : tout
  return !!v.agent_discord && String(v.agent_discord) === String(window.currentUser?.id);
}

let _ventesPagination = { page: 1, parPage: 30 };

function genererVentes(liste = VENTES_DATA) {
  const tbody = document.getElementById('ventesTableBody');
  if (!tbody) return;
  assurerConteneurPagination('paginationVentes', 'ventesTableBody');

  const triees = [...liste].sort((a, b) => (b.id || 0) - (a.id || 0));
  const { pageListe, totalPages } = paginerListe(triees, _ventesPagination);

  if (pageListe.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="ventes-empty">Aucune vente ne correspond à votre recherche.</td></tr>`;
  } else {
    tbody.innerHTML = pageListe.map(v => {
      const index = VENTES_DATA.indexOf(v);
      const incoherent = v.incoherence && !v.incoherence_resolue;
      const peutGerer = peutGererVente(v);
      return `
      <tr>
        <td>${v.date}</td>
        <td>${v.bien}</td>
        <td><span class="badge-type ${v.type.toLowerCase()}">${v.type.toUpperCase()}</span></td>
        <td class="prix">${Number(v.prix).toLocaleString('fr-FR')} $</td>
        <td class="commission">${Number(v.commission || 0).toLocaleString('fr-FR')} $</td>
        <td>${v.semaines}</td>
        <td>${v.client}</td>
        <td>${v.tel}</td>
        <td>${v.agent_nom}</td>
        <td>
        <div class="action-cell">
            ${incoherent ? `<span class="badge-incoherence" onclick="toggleIncoherence(${index})" style="cursor:pointer;">⚠️ Incohérence</span>` : ''}
            <button class="btn-dots" onclick="toggleDropdown(event, ${index})">⋯</button>
            ${peutGerer ? `<button class="btn-supprimer" onclick="supprimerVente(${index})">🗑 Supprimer</button>` : ''}
            <div class="dropdown-menu" id="dropdown-${index}">
              <button class="pdf" onclick="event.stopPropagation(); actionVente('pdf', ${index})"><span class="ico">📄</span> PDF</button>
              <button class="certificat" onclick="event.stopPropagation(); actionVente('certificat', ${index})"><span class="ico">✉️</span> Envoyer certificat au client</button>
              ${peutGerer ? `<button class="modifier" onclick="event.stopPropagation(); actionVente('modifier', ${index})"><span class="ico">✏️</span> Modifier</button>` : ''}
              <button class="relouer" onclick="event.stopPropagation(); actionVente('relouer', ${index})"><span class="ico">🔁</span> Relouer</button>
              ${!incoherent ? `<button onclick="event.stopPropagation(); toggleIncoherence(${index})"><span class="ico">⚠️</span> Signaler incohérence</button>` : `<button onclick="event.stopPropagation(); toggleIncoherence(${index})"><span class="ico">✅</span> Résoudre incohérence</button>`}
            </div>
          </div>
        </td>
      </tr>`; 
    }).join('');
  }
  renderBoutonsPagination('paginationVentes', _ventesPagination, totalPages, 'allerPageVentes');
}

function allerPageVentes(page) { _ventesPagination.page = page; genererVentes(getVentesFiltrees()); }
function changerParPageVentes(val) { _ventesPagination.parPage = val; _ventesPagination.page = 1; filtrerParAgent(); }  


async function toggleIncoherence(index) {
  const v = VENTES_DATA[index];
  if (!v) return;
  const nouvelEtat = !(v.incoherence && !v.incoherence_resolue);
  try {
    await fetch(`${SERVER_URL}/api/ventes/${v.id}/incoherence`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incoherence: nouvelEtat, incoherence_resolue: !nouvelEtat, bien: v.bien })
    });
    v.incoherence = nouvelEtat;
    v.incoherence_resolue = !nouvelEtat;
    rafraichirVentesAffichees();
  } catch (e) { alert('❌ Impossible de mettre à jour l\'incohérence.'); }
}

function estAujourdhui(dateStr) {
  const now = new Date();
  const [d, m, y] = dateStr.split('/');
  return Number(d) === now.getDate() && Number(m) === now.getMonth() + 1 && Number(y) === now.getFullYear();
}

function getDebutSemaine() {
  const now = new Date();
  const jour = (now.getDay() + 6) % 7; // lundi = 0
  const lundi = new Date(now);
  lundi.setDate(now.getDate() - jour);
  lundi.setHours(0, 0, 0, 0);
  return lundi;
}

function estCetteSemaine(dateStr) {
  const [d, m, y] = dateStr.split('/');
  return new Date(Number(y), Number(m) - 1, Number(d)) >= getDebutSemaine();
}

function genererVentesStats(liste = VENTES_DATA) {
  const container = document.getElementById('ventesStatsCards');
  if (!container) return;

  const volumeTotal = liste.reduce((s, v) => s + parseMontant(v.prix), 0);
  const commissionsTotal = liste.reduce((s, v) => s + parseMontant(v.commission), 0);
  const nbAchats = liste.filter(v => v.type === 'Achat').length;
  const pctAchats = liste.length ? Math.round((nbAchats / liste.length) * 100) : 0;
  const pctLocations = liste.length ? 100 - pctAchats : 0;
  const commJour = liste.filter(v => estAujourdhui(v.date)).reduce((s, v) => s + parseMontant(v.commission), 0);
  const commSemaine = liste.filter(estDepuisClotureVente).reduce((s, v) => s + parseMontant(v.commission), 0);

  container.innerHTML = `
    <div class="ventes-stat-card"><div class="lbl">Ventes</div><div class="val">${liste.length}</div></div>
    <div class="ventes-stat-card"><div class="lbl">Volume total</div><div class="val gold">${volumeTotal.toLocaleString('fr-FR')} $</div></div>
    <div class="ventes-stat-card"><div class="lbl">Commissions totales</div><div class="val gold">${commissionsTotal.toLocaleString('fr-FR')} $</div></div>
    <div class="ventes-stat-card"><div class="lbl">Achats / Locations</div><div class="val small">${pctAchats}% / ${pctLocations}%</div></div>
    <div class="ventes-stat-card"><div class="lbl">CA du jour</div><div class="val gold">${commJour.toLocaleString('fr-FR')} $</div></div>
    <div class="ventes-stat-card"><div class="lbl">CA de la semaine</div><div class="val gold">${commSemaine.toLocaleString('fr-FR')} $</div></div>
  `;
}

function getVentesFiltrees() {
  const agent = document.getElementById('filterVentes')?.value || 'toutes';
  const du = document.getElementById('filterDu')?.value;
  const au = document.getElementById('filterAu')?.value;
  const terme = (document.querySelector('.ventes-search')?.value || '').trim().toLowerCase();

  let liste = VENTES_DATA;

  if (agent === 'mes-ventes') liste = liste.filter(v => v.agent_nom === window.currentUser?.nom_rp);
  else if (agent !== 'toutes') liste = liste.filter(v => v.agent_nom === agent);

  if (du || au) {
    const toISO = (dmy) => { const [d, m, y] = dmy.split('/'); return `${y}-${m}-${d}`; };
    liste = liste.filter(v => {
      const iso = toISO(v.date);
      return (!du || iso >= du) && (!au || iso <= au);
    });
  }

  if (terme) {
    liste = liste.filter(v =>
      v.bien.toLowerCase().includes(terme) || v.client.toLowerCase().includes(terme) ||
      (v.agent_nom || '').toLowerCase().includes(terme) || (v.tel || '').toLowerCase().includes(terme) ||
      v.date.toLowerCase().includes(terme) || v.type.toLowerCase().includes(terme)
    );
  }

  return liste;
}

function filtrerParAgent() {
  _ventesPagination.page = 1;
  const liste = getVentesFiltrees();
  genererVentes(liste);
  genererVentesStats(liste);
}

function rechercherVentes() {
  _ventesPagination.page = 1;
  filtrerParAgent();
}

function closeFloatingDropdown(menu) {
  if (!menu) return;
  menu.classList.remove('open');
  if (menu._placeholder) {
    menu._placeholder.parentNode.insertBefore(menu, menu._placeholder);
    menu._placeholder.remove();
    menu._placeholder = null;
    menu.style.position = '';
    menu.style.top = '';
    menu.style.left = '';
    menu.style.right = '';
    menu.style.zIndex = '';
  }
}

function openFloatingDropdown(btn, menu) {
  if (!menu._placeholder) {
    menu._placeholder = document.createComment('dropdown-placeholder');
    menu.parentNode.insertBefore(menu._placeholder, menu);
  }
  document.body.appendChild(menu);
  menu.classList.add('open');
  menu.style.position = 'fixed';
  menu.style.zIndex = '999999';

  const rect = btn.getBoundingClientRect();
  const menuWidth = menu.offsetWidth || 200;
  let left = rect.right - menuWidth;
  let top = rect.bottom + 6;

  if (left < 8) left = 8;
  if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = rect.top - menu.offsetHeight - 6;

  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.style.right = 'auto';
}

function toggleDropdown(event, index) {
  event.stopPropagation();
  const menu = document.getElementById(`dropdown-${index}`);
  const isOpen = menu.classList.contains('open');

  document.querySelectorAll('.dropdown-menu.open').forEach(m => closeFloatingDropdown(m));

  if (!isOpen) openFloatingDropdown(event.currentTarget, menu);
}

document.addEventListener('click', () => {
  document.querySelectorAll('.dropdown-menu.open').forEach(m => closeFloatingDropdown(m));
});
document.addEventListener('scroll', () => {
  document.querySelectorAll('.dropdown-menu.open').forEach(m => closeFloatingDropdown(m));
}, true);

async function supprimerVente(index) {
  const vente = VENTES_DATA[index];
  if (!vente) return;
  if (!peutGererVente(vente)) { alert('⛔ Tu ne peux supprimer que tes propres ventes.'); return; }
  if (!confirm(`Supprimer la vente de "${vente.bien}" ?`)) return;
  try {
    const res = await fetch(`${SERVER_URL}/api/ventes/${vente.id}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Échec de la suppression');
    }
    VENTES_DATA.splice(index, 1);
    rafraichirVentesAffichees();
  } catch (e) { alert(`❌ ${e.message}`); }
}

let _mePeriode = 'semaine';

function changerPeriodeMonEspace(periode) {
  _mePeriode = periode;
  _mePagination.page = 1;
  document.querySelectorAll('.me-periode-btn').forEach(b => b.classList.toggle('active', b.dataset.periode === periode));
  genererMonEspace();
}

function filtrerParPeriode(liste) {
  if (_mePeriode !== 'semaine') return liste;
  const b = getBornesSemaine(_meSemaineIdx);
  return liste.filter(v => estDansBornes(v, b));
}

// ---------- Sélecteur de bien ----------
let _venteSelectedBien = null;

function ouvrirSelecteurBienVente() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999999;display:flex;align-items:center;justify-content:center;padding:20px;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:14px;width:900px;max-width:95vw;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;color:#222;';
  const toutesCategories = [...CATEGORIES_BIENS_BASE, ...CATEGORIES_BIENS_CUSTOM];
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #eee;">
      <h3 style="margin:0;font-family:var(--font-display);font-size:20px;">Choisir un bien</h3>
      <button id="selbien-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:#666;">✕</button>
    </div>
    <div style="padding:12px 20px;border-bottom:1px solid #eee;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <input type="text" id="selbien-recherche" placeholder="🔎 Rechercher un bien..." style="flex:1;min-width:180px;margin:0;padding:9px 12px;border:1px solid #ddd;border-radius:8px;">
      <select id="selbien-cat" style="margin:0;padding:9px 12px;border:1px solid #ddd;border-radius:8px;">
        <option value="all">Toutes catégories</option>
        ${toutesCategories.map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>
    <div id="selbien-grid" style="flex:1;overflow-y:auto;padding:18px 20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;"></div>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => document.body.removeChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  box.querySelector('#selbien-close').onclick = close;

  function render() {
    const recherche = box.querySelector('#selbien-recherche').value.trim().toLowerCase();
    const cat = box.querySelector('#selbien-cat').value;
    let liste = BIENS_DYNAMIQUES;
    if (cat !== 'all') liste = liste.filter(b => b.categorie === cat);
    if (recherche) liste = liste.filter(b => b.nom.toLowerCase().includes(recherche));

    const grid = box.querySelector('#selbien-grid');
    if (liste.length === 0) { grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:#aaa;">Aucun bien trouvé.</p>`; return; }

    grid.innerHTML = liste.map(b => `
      <div data-id="${b.id}" style="border:1px solid #eee;border-radius:10px;overflow:hidden;cursor:pointer;transition:border-color .15s;">
        <div style="width:100%;height:90px;background:#f0f0ec;">
          <img src="${vignette(b.images[0], 300, 180)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.src='assets/placeholder.png'">
        </div>
        <div style="padding:8px 10px;">
          <div style="font-size:12px;font-weight:600;">${b.nom}</div>
          <div style="font-size:10px;color:#888;">Achat: ${b.prixAchat.toLocaleString('fr-FR')}$ · Loc: ${b.prixLoc.toLocaleString('fr-FR')}$</div>
          <div style="font-size:10px;color:#888;margin-top:2px;">Coffre: ${b.coffre.toLocaleString('fr-FR')} kg</div>
        </div>
      </div>`).join('');
    grid.querySelectorAll('[data-id]').forEach(card => {
      card.onclick = () => {
        const bien = BIENS_DYNAMIQUES.find(b => b.id === Number(card.dataset.id));
        _venteSelectedBien = bien;
        document.getElementById('v_bien_preview').innerHTML = `
          <img src="${vignette(bien.images[0], 80, 80)}" loading="lazy" style="width:40px;height:40px;object-fit:cover;border-radius:6px;background:#f0f0ec;" onerror="this.src='assets/placeholder.png'">
          <span style="font-size:13px;font-weight:600;color:#222;">${bien.nom}</span>`;
        updatePrixAuto();
        close();
      };
    });
  }
  box.querySelector('#selbien-recherche').addEventListener('input', render);
  box.querySelector('#selbien-cat').addEventListener('change', render);
  render();
}

function selectTypeTransaction(type) {
  document.getElementById('typeTransaction').value = type;
  document.querySelectorAll('#typeTransactionTabs button').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  toggleSemaines();
  updatePrixAuto();
}

function toggleSemaines() {
  const type = document.getElementById('typeTransaction').value;
  document.getElementById('groupeSemaines').style.display = type === 'Location' ? 'block' : 'none';
}

// ---------- Villas spéciales : usage garage / habitation ----------
function estVillaSpeciale(bien) {
  return /^villa special\s*[123]\b/.test(_normTexte(bien?.nom));
}

function selectUsageVilla(usage) {
  document.getElementById('v_usage_villa').value = usage;
  document.querySelectorAll('#usageVillaTabs button').forEach(b => b.classList.toggle('active', b.dataset.usage === usage));
  updatePrixAuto();
}

function majUsageVilla() {
  const groupe = document.getElementById('groupeUsageVilla');
  if (!groupe) return;
  const type = document.getElementById('typeTransaction').value;
  const visible = type === 'Location' && estVillaSpeciale(_venteSelectedBien);
  groupe.style.display = visible ? 'block' : 'none';
  // Resynchronise les onglets avec la valeur cachée (après un form.reset())
  const usage = document.getElementById('v_usage_villa').value || 'habitation';
  document.querySelectorAll('#usageVillaTabs button').forEach(b => b.classList.toggle('active', b.dataset.usage === usage));
}

// ---------- Vente employé (HG+, location uniquement) ----------
const REMISE_EMPLOYE = 0.30;

function venteEmployeActive() {
  const type = document.getElementById('typeTransaction').value;
  return hasPermission('hg') && type === 'Location' && !!document.getElementById('v_vente_employe')?.checked;
}

function majVenteEmploye() {
  const groupe = document.getElementById('groupeVenteEmploye');
  if (!groupe) return;
  const visible = hasPermission('hg') && document.getElementById('typeTransaction').value === 'Location';
  groupe.style.display = visible ? 'block' : 'none';
  if (!visible) document.getElementById('v_vente_employe').checked = false;
}

// ---------- Calcul prix/commission auto (logique V1 conservée) ----------
function updatePrixAuto() {
  const bien = _venteSelectedBien;
  const type = document.getElementById('typeTransaction').value;
  const inputPrix = document.getElementById('v_prix');
  const inputSemaines = document.getElementById('v_semaines');
  const inputComm = document.getElementById('v_commission');
  majUsageVilla();
  majVenteEmploye();
  if (!bien) return;

  if (type === 'Achat') {
    inputPrix.value = bien.prixAchat.toLocaleString('fr-FR') + ' $';
    inputComm.value = Math.round(bien.prixAchat * 0.10);
  } else {
    let semaines = parseInt(inputSemaines.value) || 1;
    if (semaines < 1) semaines = 1;
    if (semaines > 4) semaines = 4;
    inputSemaines.value = semaines;

    // Vente employé : -30 % sur le prix et la commission
    const coef = venteEmployeActive() ? 1 - REMISE_EMPLOYE : 1;

    inputPrix.value = Math.round(bien.prixLoc * semaines * coef).toLocaleString('fr-FR') + ' $';

    const nomBien = bien.nom.toLowerCase();
    const usageVilla = document.getElementById('v_usage_villa').value;
    // Villas spéciales : seul le bouton décide. Autres biens : comportement habituel.
    const isGarage = estVillaSpeciale(bien)
      ? usageVilla === 'garage'
      : (bien.categorie === 'Garages' || nomBien.includes('garage'));
    const isMotel = nomBien.includes('motel');
    let commParSemaine;
    if (isMotel) {
      commParSemaine = 687;
    } else {
      // Commission = (5% - taux catégorie) du prix d'achat, par semaine
      const tauxComm = isGarage ? 0.04 : 0.0125;
      commParSemaine = Math.round(bien.prixAchat * (0.05 - tauxComm));
    }
    inputComm.value = Math.round(commParSemaine * semaines * coef);
  }

  updatePrixIG();
}

function updatePrixIG() {
  const spanIG = document.getElementById('v_prix_ig');
  if (!spanIG) return;

  const type = document.getElementById('typeTransaction')?.value;
  if (type !== 'Achat' || !_venteSelectedBien) {
    spanIG.textContent = '';
    return;
  }

  const commission = Number(document.getElementById('v_commission').value) || 0;
  const prixIG = _venteSelectedBien.prixAchat - commission;
  spanIG.textContent = `→ Prix IG : ${prixIG.toLocaleString('fr-FR')}$`;
}

function updatePrixLocAutoBien(box) {
  const inputAchat = box.querySelector('#bien_prix_achat');
  const inputLoc = box.querySelector('#bien_prix_loc');
  if (!inputAchat || !inputLoc) return;
  const prixAchat = Number(inputAchat.value) || 0;
  inputLoc.value = Math.round(prixAchat * 0.05);
}

// ---------- Génération PDF certificat ----------
let _jspdfReady = false;
function chargerJsPDF() {
  return new Promise((resolve, reject) => {
    if (_jspdfReady) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = () => { _jspdfReady = true; resolve(); };
    s.onerror = () => reject(new Error('Impossible de charger jsPDF'));
    document.head.appendChild(s);
  });
}

function logoToBase64() {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = 'assets/logo_dynasty8.png';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
  });
}

async function genererCertificatPDF(data) {
  await chargerJsPDF();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const ref = 'D8-' + Date.now().toString(36).toUpperCase();
  const duree = data.type === 'Achat' ? 'Acquisition définitive' : `${data.semaines} semaine(s)`;
  const prixFmt = Number(data.prix).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' $';

  doc.setFillColor(13, 31, 15);
  doc.rect(0, 0, W, H, 'F');

  const logoB64 = await logoToBase64();
  if (logoB64) {
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.1 }));
    doc.addImage(logoB64, 'PNG', (W - 110) / 2, (H - 80) / 2, 110, 80);
    doc.restoreGraphicsState();
  }

  doc.setDrawColor(200, 168, 32);
  doc.setLineWidth(1.2);
  doc.rect(6, 6, W - 12, H - 12);
  doc.setLineWidth(0.3);
  doc.rect(10, 10, W - 20, H - 20);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(200, 168, 32);
  doc.setCharSpace(1.5);
  doc.text('DYNASTY 8 — AGENCE IMMOBILIÈRE', W / 2, 22, { align: 'center' });
  doc.setCharSpace(0);
  doc.line(20, 26, W - 20, 26);

  doc.setFontSize(24);
  doc.setTextColor(255, 255, 255);
  doc.text('CERTIFICAT DE PROPRIÉTÉ', W / 2, 45, { align: 'center' });

  const typeLabel = data.type === 'Achat' ? 'TITRE DE PROPRIÉTÉ' : 'CONTRAT DE LOCATION';
  const [tr, tg, tb] = data.type === 'Achat' ? [46, 213, 115] : [255, 165, 2];
  doc.setFontSize(11);
  doc.setTextColor(tr, tg, tb);
  doc.text(typeLabel, W / 2, 56, { align: 'center' });
  doc.setDrawColor(255, 255, 255);
  doc.line(20, 60, W - 20, 60);

  const champs = [
    ['TITULAIRE', data.client], ['BIEN IMMOBILIER', data.bien], ['PRIX', prixFmt],
    ['DURÉE', duree], ["DATE D'ÉMISSION", data.date], ['AGENT DYNASTY 8', data.agent_nom],
  ];
  const colX = [22, W / 2 + 5];
  const startY = 72, lineH = 24;
  champs.forEach(([label, valeur], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = colX[col], y = startY + row * lineH;
    doc.setFontSize(7); doc.setTextColor(200, 168, 32); doc.setFont('helvetica', 'bold');
    doc.text(label, x, y);
    doc.setFontSize(13); doc.setTextColor(255, 255, 255);
    doc.text(doc.splitTextToSize(String(valeur), W / 2 - 28)[0], x, y + 8);
    if (row < Math.ceil(champs.length / 2) - 1 && col === 1) {
      doc.setDrawColor(80, 80, 80); doc.setLineWidth(0.15);
      doc.line(20, y + 14, W - 20, y + 14);
    }
  });

  doc.setDrawColor(200, 168, 32);
  doc.line(20, H - 22, W - 20, H - 22);
  doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(160, 160, 160);
  doc.text('Ce document est un certificat officiel délivré par Dynasty 8 — Los Santos', W / 2, H - 15, { align: 'center' });
  doc.setTextColor(200, 168, 32);
  doc.text('Référence : ' + ref, W / 2, H - 9, { align: 'center' });

  return { blob: doc.output('blob'), ref };
}

async function blobToBase64(blob) {
  const arr = await blob.arrayBuffer();
  const uint8 = new Uint8Array(arr);
  let binary = '';
  for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
  return btoa(binary);
}

async function envoyerWebhook(vente, pdfBlob) {
  const duree = vente.type === 'Achat' ? 'Achat définitif' : `${vente.semaines} semaine(s)`;
  const prixFmt = Number(vente.prix).toLocaleString('fr-FR') + ' $';
  const nomDuFil = `${vente.type} - ${vente.bien} - ${vente.client}`;
  const pdfBase64 = pdfBlob ? await blobToBase64(pdfBlob) : null;

  try {
    const res = await fetch(`${SERVER_URL}/api/webhook`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venteId: vente.id, bien: vente.bien, type: vente.type, duree, prix: prixFmt, client: vente.client, tel: vente.tel, agent_nom: vente.agent_nom, date: vente.date, nomDuFil, pdfBase64 })
    });
    if (!res.ok) throw new Error();
  } catch (e) { console.error('Erreur webhook:', e); }
}

async function envoyerDMViaServeur(discordUserId, vente, pdfBlob, isCorrection = false) {
  if (!discordUserId?.trim()) return;
  const pdfBase64 = pdfBlob ? await blobToBase64(pdfBlob) : null;
  try {
    await fetch(`${SERVER_URL}/api/send-dm`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        discordUserId, clientName: vente.client, bien: vente.bien, type: vente.type,
        duree: vente.type === 'Achat' ? 'Acquisition définitive' : `${vente.semaines} semaine(s)`,
        prix: Number(vente.prix).toLocaleString('fr-FR') + ' $', date: vente.date, pdfBase64, isCorrection
      })
    });
  } catch (e) { console.error('Erreur DM:', e); }
}

// ---------- Recherche d'un client existant ----------
const _normTexte = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
let _clientsResultats = [];

function getClientsConnus() {
  const map = new Map();
  // Du plus récent au plus ancien : on garde les infos les plus récentes de chaque client
  [...VENTES_DATA].sort((a, b) => (b.id || 0) - (a.id || 0)).forEach(v => {
    if (!v.client) return;
    const cle = v.discord || `${v.client.toLowerCase()}|${v.tel || ''}`;
    if (!map.has(cle)) map.set(cle, { client: v.client, tel: v.tel || '', discord: v.discord || '' });
  });
  return [...map.values()];
}

function rechercherClientVente(terme) {
  const box = document.getElementById('v_client_results');
  if (!box) return;
  const t = _normTexte(terme.trim());
  if (!t) { box.style.display = 'none'; return; }

  _clientsResultats = getClientsConnus()
    .filter(c => _normTexte(`${c.client} ${c.tel} ${c.discord}`).includes(t))
    .slice(0, 8);

  box.style.display = 'block';
  box.innerHTML = _clientsResultats.length === 0
    ? `<div style="padding:10px 12px;font-size:12px;color:#999;">Aucun client trouvé</div>`
    : _clientsResultats.map((c, i) => `
      <div onclick="choisirClientVente(${i})" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #f0f0ec;color:#222;" onmouseover="this.style.background='#f7f7f5'" onmouseout="this.style.background=''">
        <div style="font-size:13px;font-weight:600;">${escapeHtml(c.client)}</div>
        <div style="font-size:11px;color:#888;">📞 ${escapeHtml(c.tel || '—')} · Discord : ${escapeHtml(c.discord || '—')}</div>
      </div>`).join('');
}

function choisirClientVente(i) {
  const c = _clientsResultats[i];
  if (!c) return;
  document.getElementById('v_client').value = c.client;
  document.getElementById('v_tel').value = c.tel;
  document.getElementById('v_discord').value = c.discord;
  document.getElementById('v_client_search').value = '';
  document.getElementById('v_client_results').style.display = 'none';
}

document.addEventListener('click', (e) => {
  const box = document.getElementById('v_client_results');
  if (box && !e.target.closest('#v_client_search') && !e.target.closest('#v_client_results')) box.style.display = 'none';
});

// ---------- Modal & soumission ----------
function openVenteModal(editIndex) {
  const modal = document.getElementById('venteModalOverlay');
  const form = document.getElementById('venteForm');
  const titre = modal.querySelector('h3');
  const submitBtn = form.querySelector('.btn-submit-vente');

  // Toujours repartir d'un bouton actif (au cas où une soumission
  // précédente n'aurait pas nettoyé correctement).
  submitBtn.disabled = false;
  const res = document.getElementById('v_client_results');
  if (res) res.style.display = 'none';

  if (typeof editIndex === 'number' && VENTES_DATA[editIndex]) {
    const v = VENTES_DATA[editIndex];
    form.setAttribute('data-edit-id', v.id);
    form.setAttribute('data-edit-index', editIndex);
    titre.textContent = 'Modifier la Transaction';
    submitBtn.textContent = 'ENREGISTRER LES MODIFICATIONS';

    document.getElementById('v_client').value = v.client;
    document.getElementById('v_tel').value = v.tel;
    document.getElementById('v_discord').value = v.discord || '';
    document.getElementById('v_client_search_group').style.display = 'none';
    document.getElementById('v_vente_employe').checked = !!v.vente_employe;
    selectTypeTransaction(v.type);

    _venteSelectedBien = BIENS_DYNAMIQUES.find(b => b.nom === v.bien) || null;
    document.getElementById('v_bien_preview').innerHTML = _venteSelectedBien
      ? `<img src="${vignette(_venteSelectedBien.images[0], 80, 80)}" loading="lazy" style="width:40px;height:40px;object-fit:cover;border-radius:6px;background:#f0f0ec;" onerror="this.src='assets/placeholder.png'"><span style="font-size:13px;font-weight:600;color:#222;">${_venteSelectedBien.nom}</span>`
      : `<span style="color:#222;font-size:13px;">${v.bien}</span>`;

    if (v.type === 'Location') document.getElementById('v_semaines').value = (v.semaines && v.semaines !== '/') ? v.semaines : 1;
    document.getElementById('v_prix').value = Number(v.prix).toLocaleString('fr-FR') + ' $';
    document.getElementById('v_commission').value = v.commission || '';
  } else {
    form.reset();
    form.removeAttribute('data-edit-id');
    form.removeAttribute('data-edit-index');
    titre.textContent = 'Nouvelle Transaction';
    submitBtn.textContent = 'Enregistrer la vente';
    _venteSelectedBien = null;
    document.getElementById('v_bien_preview').innerHTML = `<span style="color:#9a9a94;font-size:13px;">📋 Cliquer pour choisir un bien</span>`;
    document.getElementById('v_client_search_group').style.display = '';
    selectTypeTransaction('Achat');
  }
  modal.classList.add('open');
}
function closeVenteModal() { document.getElementById('venteModalOverlay').classList.remove('open'); }
function closeVenteModalOutside(event) { if (event.target.id === 'venteModalOverlay') closeVenteModal(); }

async function submitVenteForm(event) {
  event.preventDefault();
  const form = event.target;
  const editId = form.getAttribute('data-edit-id');
  const editIndex = form.getAttribute('data-edit-index');
  const submitBtn = form.querySelector('.btn-submit-vente');

  if (!_venteSelectedBien) { alert('Sélectionne un bien.'); return false; }

  const type = document.getElementById('typeTransaction').value;
  const semainesEl = document.getElementById('v_semaines');
  if (type === 'Location') {
    const s = parseInt(semainesEl.value);
    if (!s || s < 1 || s > 4) { alert('Nombre de semaines invalide (1-4).'); return false; }
  }

  // Vente employé : seul un HG+ peut cocher/décocher. Si un agent modifie une vente
  // déjà marquée employé, on conserve le flag pour ne pas perdre la remise.
  let employe;
  if (editId && !hasPermission('hg')) {
    employe = type === 'Location' && !!VENTES_DATA[parseInt(editIndex)]?.vente_employe;
  } else {
    employe = venteEmployeActive();
  }
  const coef = employe ? 1 - REMISE_EMPLOYE : 1;

  const venteData = {
    bien: _venteSelectedBien.nom,
    type,
    prix: type === 'Achat'
      ? _venteSelectedBien.prixAchat
      : Math.round(_venteSelectedBien.prixLoc * (parseInt(semainesEl.value) || 1) * coef),
    vente_employe: employe,
    commission: Number(document.getElementById('v_commission').value) || 0,
    semaines: type === 'Achat' ? '/' : (semainesEl.value || '1'),
    client: document.getElementById('v_client').value,
    tel: document.getElementById('v_tel').value,
    discord: document.getElementById('v_discord').value,
  };

  submitBtn.disabled = true;
  submitBtn.textContent = editId ? 'Modification...' : 'Envoi en cours...';

  try {
    if (editId) {
      const res = await fetch(`${SERVER_URL}/api/ventes/${editId}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(venteData)
      });
      if (res.ok) {
        const idx = parseInt(editIndex);
        VENTES_DATA[idx] = { ...VENTES_DATA[idx], ...venteData };
        const venteMaj = VENTES_DATA[idx];
        try {
          const { blob: pdfBlob } = await genererCertificatPDF(venteMaj);
          const pdfBase64 = await blobToBase64(pdfBlob);
          await fetch(`${SERVER_URL}/api/ventes/${editId}/redo-webhook`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pdfBase64 })
          });
          if (venteMaj.discord) {
            const { blob: pdfBlobDM } = await genererCertificatPDF(venteMaj);
            await envoyerDMViaServeur(venteMaj.discord, venteMaj, pdfBlobDM, true);
          }
        } catch (e) { console.error('Erreur renvoi Discord:', e); }
        alert('✅ Vente modifiée.');
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`❌ ${err.error || 'Erreur lors de la modification.'}`);
      }
      genererVentes(VENTES_DATA);
      filtrerParAgent();
      closeVenteModal();
      return false;
    }

    const now = new Date();
    const vente = { date: now.toLocaleDateString('fr-FR'), dateISO: now.toISOString().split('T')[0], ...venteData, agent_nom: window.currentUser?.nom_rp, agent_discord: window.currentUser?.id };

    const saveRes = await fetch(`${SERVER_URL}/api/ventes`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vente)
    });
    if (saveRes.ok) { const saved = await saveRes.json(); vente.id = saved.id; }

    const { blob: pdfBlob } = await genererCertificatPDF(vente);
    vente._pdfBlob = pdfBlob;
    await envoyerWebhook(vente, pdfBlob);
    await envoyerDMViaServeur(vente.discord, vente, pdfBlob);
    alert('✅ Vente enregistrée.');

    VENTES_DATA.push(vente);
    genererFiltreAgents();
    filtrerParAgent();
    closeVenteModal();
    return false;
  } catch (e) {
    alert('❌ Erreur lors de l\'envoi.');
    return false;
  } finally {
    // Toujours réactiver le bouton, succès ou échec — c'est ça qui
    // forçait un refresh entre deux ventes.
    submitBtn.disabled = false;
    submitBtn.textContent = editId ? 'ENREGISTRER LES MODIFICATIONS' : 'Enregistrer la vente';
  }
}

// ---------- Actions du menu ⋯ ----------
async function actionVente(action, index) {
  const v = VENTES_DATA[index];
  if (!v) return;

  if (action === 'pdf') {
    if (v._pdfBlob) {
      const url = URL.createObjectURL(v._pdfBlob);
      const a = document.createElement('a');
      a.href = url; a.download = `certificat_D8_${v.client.replace(/\s+/g, '_')}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } else {
      const { blob } = await genererCertificatPDF(v);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `certificat_D8_${v.client.replace(/\s+/g, '_')}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  } else if (action === 'certificat') {
    if (!v.discord) { alert('Aucun ID Discord renseigné pour cette vente.'); return; }
    const { blob } = await genererCertificatPDF(v);
    await envoyerDMViaServeur(v.discord, v, blob, false);
    alert('✅ Certificat envoyé au client.');
  } else if (action === 'modifier') {
    if (!peutGererVente(v)) { alert('⛔ Tu ne peux modifier que tes propres ventes.'); return; }
    openVenteModal(index);
  } else if (action === 'relouer') {
    openVenteModal();
    document.getElementById('v_client_search_group').style.display = 'none';
    document.getElementById('v_client').value = v.client;
    document.getElementById('v_tel').value = v.tel;
    document.getElementById('v_discord').value = v.discord || '';
    selectTypeTransaction(v.type);
    _venteSelectedBien = BIENS_DYNAMIQUES.find(b => b.nom === v.bien) || null;
    if (_venteSelectedBien) {
      document.getElementById('v_bien_preview').innerHTML = `<img src="${vignette(_venteSelectedBien.images[0], 80, 80)}" loading="lazy" style="width:40px;height:40px;object-fit:cover;border-radius:6px;background:#f0f0ec;" onerror="this.src='assets/placeholder.png'"><span style="font-size:13px;font-weight:600;color:#222;">${_venteSelectedBien.nom}</span>`;
    }
    toggleSemaines();
    if (v.type === 'Location') document.getElementById('v_semaines').value = (v.semaines && v.semaines !== '/') ? v.semaines : 1;
    updatePrixAuto();
  }
}

// ================================================================
//  COPIE POUR EXCEL — helpers communs (Mon espace + Statistiques)
// ================================================================
const EXCEL_INCLURE_ENTETES = true; // false = copie sans la ligne d'en-têtes

async function copierTexteClipboard(texte) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(texte);
    return;
  }
  // Fallback si le presse-papier moderne n'est pas dispo
  const ta = document.createElement('textarea');
  ta.value = texte;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  if (!ok) throw new Error('Copie impossible');
}

// ---------- Copie au format Excel (colonnes séparées par des tabulations) ----------
async function copierPourExcel(lignes, btn) {
  if (!lignes || lignes.length === 0) { alert('Rien à copier pour le moment.'); return; }

  const tsv = lignes
    .map(l => l.map(c => String(c ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t'))
    .join('\n');

  let ok = false;
  try {
    await navigator.clipboard.writeText(tsv);
    ok = true;
  } catch (e) {
    // Fallback si le presse-papier moderne n'est pas dispo
    const ta = document.createElement('textarea');
    ta.value = tsv;
    ta.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
  }

  if (!ok) { alert('❌ Impossible de copier dans le presse-papier.'); return; }

  if (btn) {
    const original = btn.textContent;
    btn.textContent = '✅ Copié !';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1500);
  }
}

// ================================================================
//  PAGE MON ESPACE — stats live de l'agent connecté
//  (calculées à partir de VENTES_DATA, définie dans la partie VENTES)
// ================================================================
function getAgentConnecte() {
  return window.currentUser?.nom_rp || '';
} // à remplacer par l'agent réellement authentifié

function parseMontant(val) {
  if (val === null || val === undefined || val === '/') return 0;
  if (typeof val === 'number') return val;
  return parseInt(String(val).replace(/[^\d-]/g, ''), 10) || 0;
}

let _meSelectedAgent = null; // null = soi-même

function getAgentConnecte() {
  return _meSelectedAgent || window.currentUser?.nom_rp || '';
}

function listeAgentsVisibles() {
  return MEMBRES_DATA
    .filter(m => ROLES_AUTORISES.includes(m.role))
    .map(m => m.nom_rp)
    .sort((a, b) => a.localeCompare(b));
}

function initSelecteurAgentMonEspace() {
  const wrap = document.getElementById('meAgentSelectWrap');
  const select = document.getElementById('meAgentSelect');
  if (!wrap || !select) return;
  if (!hasPermission('hg')) { wrap.style.display = 'none'; return; }

  wrap.style.display = 'block';
  const moi = window.currentUser?.nom_rp;
  const valeurActuelle = _meSelectedAgent || moi;
  select.innerHTML = listeAgentsVisibles().map(nom =>
    `<option value="${nom}" ${nom === valeurActuelle ? 'selected' : ''}>${nom === moi ? nom + ' (moi)' : nom}</option>`
  ).join('');
}

function changerAgentMonEspace(nom) {
  _meSelectedAgent = (nom === window.currentUser?.nom_rp) ? null : nom;
  _mePagination.page = 1;
  genererMonEspace();
}

function rafraichirVentesAffichees() {
  const liste = getVentesFiltrees();
  genererVentes(liste);
  genererVentesStats(liste);
}

async function genererMonEspace() {
  const statsEl = document.getElementById('meStats');
  if (!statsEl) return;

  initSelecteurAgentMonEspace();
  await Promise.all([chargerServiceEnCours(), chargerCloture(), chargerClotures()]);
  await chargerHeuresService(_mePeriode === 'semaine' ? getBornesSemaine(_meSemaineIdx) : null);
  renderSelecteurSemaines();

  const agentCible = getAgentConnecte();
  document.getElementById('meAgentName').textContent = agentCible;

  const mesVentes = filtrerParPeriode(VENTES_DATA.filter(v => v.agent_nom === agentCible))
    .sort((a, b) => (b.id || 0) - (a.id || 0));
  const mesCommissions = mesVentes.reduce((sum, v) => sum + parseMontant(v.commission), 0);

  const totauxParAgent = {};
  filtrerParPeriode(VENTES_DATA).forEach(v => {
    totauxParAgent[v.agent_nom] = (totauxParAgent[v.agent_nom] || 0) + parseMontant(v.commission);
  });
  const classement = Object.entries(totauxParAgent).sort((a, b) => b[1] - a[1]);
  const rang = classement.findIndex(([agent]) => agent === agentCible) + 1;
  const meilleur = classement[0];
  const meilleurMontant = meilleur ? meilleur[1] : 0;
  const ecart = Math.max(meilleurMontant - mesCommissions, 0);
  const meilleureVente = mesVentes.reduce((max, v) => Math.max(max, parseMontant(v.prix)), 0);

  const estGlobal = _mePeriode === 'global';
  const passee = !estGlobal && _meSemaineIdx > 0;
  const labelVentes = estGlobal ? 'Ventes au total' : (passee ? 'Ventes de la période' : 'Ventes cette semaine');
  const labelCommission = estGlobal ? 'Commissions (total)' : (passee ? 'Commissions (période)' : 'Commissions (semaine)');
  const labelClassement = estGlobal ? 'Classement général' : (passee ? 'Classement de la période' : 'Classement de la semaine');
  const labelMeilleur = estGlobal ? 'meilleur agent au total' : (passee ? 'meilleur agent de la période' : 'meilleur agent de la semaine');
  const minutesService = HEURES_PAR_AGENT[agentCible] || 0;

  statsEl.innerHTML = `
    <div class="ventes-stat-card"><div class="lbl">${labelVentes}</div><div class="val">${mesVentes.length}</div></div>
    <div class="ventes-stat-card"><div class="lbl">${labelCommission}</div><div class="val gold">${mesCommissions.toLocaleString('fr-FR')} $</div></div>
    <div class="ventes-stat-card"><div class="lbl">Meilleure vente</div><div class="val">${meilleureVente.toLocaleString('fr-FR')} $</div></div>
    <div class="ventes-stat-card"><div class="lbl">Heures de service (période)</div><div class="val">${formatHeures(minutesService)}</div></div>
    <div class="ventes-stat-card"><div class="lbl">${labelClassement}</div><div class="val">#${rang || '—'} / ${classement.length}</div></div>
  `;

  const pourcentage = meilleurMontant > 0 ? Math.min((mesCommissions / meilleurMontant) * 100, 100) : 0;
  document.getElementById('meProgressBar').style.width = `${pourcentage}%`;
  document.getElementById('meProgressNote').textContent = rang === 1
    ? (agentCible === window.currentUser?.nom_rp
        ? `Tu es actuellement le ${labelMeilleur} 🏆`
        : `${agentCible} est actuellement le ${labelMeilleur} 🏆`)
    : `Il manque ${ecart.toLocaleString('fr-FR')} $ pour égaler le ${labelMeilleur}.`;

  genererTableauMonEspace(mesVentes);
  renderProfilMonEspace();
  renderBoutonService();
}

let _mePagination = { page: 1, parPage: 30 };

function genererTableauMonEspace(liste) {
  _meListeAffichee = liste; // la copie Excel prend toujours la liste complète
  const tbody = document.getElementById('meTableBody');
  if (!tbody) return;

  assurerConteneurPagination('paginationMonEspace', 'meTableBody');
  const { pageListe, totalPages } = paginerListe(liste, _mePagination);

  if (liste.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="ventes-empty">Aucune vente ne correspond à votre recherche.</td></tr>`;
  } else {
    tbody.innerHTML = pageListe.map(v => `
      <tr>
        <td>${v.date}</td>
        <td>${v.bien}</td>
        <td><span class="badge-type ${v.type}">${v.type.toUpperCase()}</span></td>
        <td class="prix">${v.prix}</td>
        <td class="commission">${v.commission}</td>
        <td>${v.client}</td>
      </tr>`).join('');
  }
  renderBoutonsPagination('paginationMonEspace', _mePagination, totalPages, 'allerPageMonEspace');
}

function allerPageMonEspace(p) { _mePagination.page = p; genererTableauMonEspace(_meListeAffichee); }
function changerParPageMonEspace(v) { _mePagination.parPage = v; _mePagination.page = 1; genererTableauMonEspace(_meListeAffichee); }

let _meListeAffichee = [];

function rechercherMesVentes() {
  _mePagination.page = 1;
  const terme = document.getElementById('meSearch').value.trim().toLowerCase();
  const agentCible = getAgentConnecte();
    const mesVentes = filtrerParPeriode(VENTES_DATA.filter(v => v.agent_nom === agentCible))
    .sort((a, b) => (b.id || 0) - (a.id || 0));
  if (!terme) { genererTableauMonEspace(mesVentes); return; }
  const resultats = mesVentes.filter(v =>
    v.bien.toLowerCase().includes(terme) || v.client.toLowerCase().includes(terme) ||
    v.date.toLowerCase().includes(terme) || v.type.toLowerCase().includes(terme)
  );
  genererTableauMonEspace(resultats);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('meSearch')?.addEventListener('input', rechercherMesVentes);
});

let _meVentesAffichees = [];

// Copie UNIQUEMENT le total des commissions de la période (un seul nombre)
function copierCommissionTotalMonEspace(btn) {
  const agentCible = getAgentConnecte();
  const total = filtrerParPeriode(VENTES_DATA.filter(v => v.agent_nom === agentCible))
    .reduce((s, v) => s + parseMontant(v.commission), 0);
  copierPourExcel([[total]], btn);
}

// Copie le tableau des ventes actuellement affiché
function copierVentesMonEspaceExcel(btn) {
  const lignes = _meListeAffichee.map(v => [
    v.date, v.bien, v.type, parseMontant(v.prix), parseMontant(v.commission), v.client
  ]);
  copierPourExcel(lignes, btn);
}

// ================================================================
//  PAGE STATISTIQUES — vue d'ensemble de toute l'agence
// ================================================================

function formatHeures(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${m.toString().padStart(2, '0')}m`;
}

function genererStatsFilters() {
  const select = document.getElementById('statAgentFilter');
  if (!select) return;
  select.innerHTML = `<option value="tous">Tous les agents</option>`;
  MEMBRES_DATA
    .filter(m => ROLES_AUTORISES.includes(m.role))
    .sort((a, b) => a.nom_rp.localeCompare(b.nom_rp))
    .forEach(membre => {
      const option = document.createElement('option');
      option.value = membre.nom_rp;
      option.textContent = membre.nom_rp;
      select.appendChild(option);
    });
}

async function genererStatistiques() {
  const overview = document.getElementById('statsOverview');
  if (!overview) return;

  genererStatsFilters();
  // Charge la date de la dernière clôture + les heures de service réelles
  // avant de calculer quoi que ce soit, pour que toute la page reflète
  // la période "depuis la dernière clôture" (Close Semaine).
  await Promise.all([chargerCloture(), chargerHeuresService()]);

  const ventesPeriode = getVentesPeriodeCourante();

  // Pré-remplit les filtres de dates avec la période courante si
  // l'utilisateur ne les a pas déjà personnalisés — la page reste liée
  // à la clôture par défaut, tout en restant ajustable manuellement.
  const inputDu = document.getElementById('statDu');
  const inputAu = document.getElementById('statAu');
  if (inputDu && inputAu && !inputDu.dataset.userSet && !inputAu.dataset.userSet) {
    inputDu.value = VENTES_CLOTURE_DATE ? VENTES_CLOTURE_DATE.split('T')[0] : '';
    inputAu.value = '';
  }

  const periodeLabel = document.getElementById('statsPeriodeLabel');
  if (periodeLabel) {
    periodeLabel.textContent = VENTES_CLOTURE_DATE
      ? `Période en cours depuis le ${new Date(VENTES_CLOTURE_DATE).toLocaleDateString('fr-FR')} (dernière clôture)`
      : 'Aucune clôture effectuée pour le moment — toutes les ventes sont comptabilisées';
  }

  // --- Vue d'ensemble (période courante = depuis la dernière clôture) ---
  renderStatsOverview();

  // --- Classement des agents (période courante) ---
  const totauxParAgent = {};
  ventesPeriode.forEach(v => {
    if (!totauxParAgent[v.agent_nom]) totauxParAgent[v.agent_nom] = { ventes: 0, volume: 0, commission: 0 };
    totauxParAgent[v.agent_nom].ventes += 1;
    totauxParAgent[v.agent_nom].volume += parseMontant(v.prix);
    totauxParAgent[v.agent_nom].commission += parseMontant(v.commission);
  });
  const classement = Object.entries(totauxParAgent).sort((a, b) => b[1].commission - a[1].commission);

  document.getElementById('statsClassementBody').innerHTML = classement.length === 0
    ? `<tr><td colspan="5" class="ventes-empty">Aucune vente sur la période.</td></tr>`
    : classement.map(([agent, d], i) => `
    <tr>
      <td class="rank-num">${i + 1}</td>
      <td><a style="cursor:pointer;text-decoration:underline;" onclick="voirEspaceAgent('${agent.replace(/'/g, "\\'")}')">${agent}</a></td>
      <td>${d.ventes}</td>
      <td>${d.volume.toLocaleString('fr-FR')} $</td>
      <td class="commission">${d.commission.toLocaleString('fr-FR')} $</td>
    </tr>
  `).join('');

  // --- Biens les plus vendus (période courante) ---
  const totauxParBien = {};
  ventesPeriode.forEach(v => { totauxParBien[v.bien] = (totauxParBien[v.bien] || 0) + 1; });
  const biens = Object.entries(totauxParBien).sort((a, b) => b[1] - a[1]);

  document.getElementById('statsBiensBody').innerHTML = biens.length === 0
    ? `<tr><td colspan="4" class="ventes-empty">Aucune vente sur la période.</td></tr>`
    : biens.slice(0, 5).map(([bien, count], i) => {
    const pct = Math.round((count / ventesPeriode.length) * 100);
    return `
      <tr>
        <td class="rank-num">${i + 1}</td>
        <td>${bien}</td>
        <td>${count}</td>
        <td>
          <div class="biens-bar-wrap">
            <div class="biens-bar-track"><div class="biens-bar-fill" style="width:${pct}%"></div></div>
            ${pct}%
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // --- Ventes de la période (filtrable) ---
  genererStatsVentes();
  genererStatsParSemaine();
}

function renderStatsOverview() {
  const overview = document.getElementById('statsOverview');
  if (!overview) return;

  const agentFiltre = document.getElementById('statAgentFilter')?.value || 'tous';
  const ventesPeriode = getVentesPeriodeCourante();
  const ventesFiltrees = agentFiltre === 'tous'
    ? ventesPeriode
    : ventesPeriode.filter(v => v.agent_nom === agentFiltre);

  const volumeTotal = ventesFiltrees.reduce((s, v) => s + parseMontant(v.prix), 0);
  const commissionsTotal = ventesFiltrees.reduce((s, v) => s + parseMontant(v.commission), 0);
  const nbAchats = ventesFiltrees.filter(v => v.type === 'Achat').length;
  const pctAchats = ventesFiltrees.length ? Math.round((nbAchats / ventesFiltrees.length) * 100) : 0;
  const pctLocations = ventesFiltrees.length ? 100 - pctAchats : 0;
  const totalMinutes = agentFiltre === 'tous'
    ? Object.values(HEURES_PAR_AGENT).reduce((s, m) => s + m, 0)
    : (HEURES_PAR_AGENT[agentFiltre] || 0);

  overview.innerHTML = `
    <div class="ventes-stat-card">
      <div class="lbl">Ventes (période)</div>
      <div class="val">${ventesFiltrees.length}</div>
    </div>
    <div class="ventes-stat-card">
      <div class="lbl">Volume (période)</div>
      <div class="val gold">${volumeTotal.toLocaleString('fr-FR')} $</div>
    </div>
    <div class="ventes-stat-card" style="position:relative;">
      <button onclick="copierCommissionsStatsExcel(this)" title="Copier pour Excel" style="
          position:absolute; top:8px; right:8px; background:none; border:none;
          cursor:pointer; font-size:14px; color:#bbb; padding:4px;
      " onmouseover="this.style.color='#c8a820'" onmouseout="this.style.color='#bbb'">📋</button>
      <div class="lbl">Commissions (période)</div>
      <div class="val gold">${commissionsTotal.toLocaleString('fr-FR')} $</div>
    </div>
    <div class="ventes-stat-card">
      <div class="lbl">Achats / Locations</div>
      <div class="val small">${pctAchats}% / ${pctLocations}%</div>
    </div>
    <div class="ventes-stat-card stat-card-clickable" id="cardHeures">
      <div class="lbl">Heures de service (période)</div>
      <div class="val small">${formatHeures(totalMinutes)} — voir détail</div>
    </div>
  `;

  document.getElementById('cardHeures').onclick = toggleHeuresDetail;
}

async function copierCommissionsStatsExcel(btn) {
  const agentFiltre = document.getElementById('statAgentFilter')?.value || 'tous';
  const ventesPeriode = getVentesPeriodeCourante();
  const ventes = agentFiltre === 'tous'
    ? ventesPeriode
    : ventesPeriode.filter(v => v.agent_nom === agentFiltre);

  const total = ventes.reduce((s, v) => s + parseMontant(v.commission), 0);
  const formate = total.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  try {
    await copierTexteClipboard(formate);
    if (btn) {
      const original = btn.textContent;
      btn.textContent = '✅ Copié !';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1500);
    }
  } catch (e) {
    alert('❌ Impossible de copier dans le presse-papier.');
  }
}

function toggleHeuresDetail() {
  const panel = document.getElementById('heuresDetailPanel');
  const isOpen = panel.style.display === 'block';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    const tri = Object.entries(HEURES_PAR_AGENT).sort((a, b) => b[1] - a[1]);
    document.getElementById('heuresDetailBody').innerHTML = tri.length === 0
      ? `<tr><td colspan="2" class="ventes-empty">Aucune session de service sur la période.</td></tr>`
      : tri.map(([agent, minutes]) => `
      <tr><td><a style="cursor:pointer;text-decoration:underline;" onclick="voirEspaceAgent('${agent.replace(/'/g, "\\'")}')">${agent}</a></td><td>${formatHeures(minutes)}</td></tr>
    `).join('');
  }
}

let _statsVentesPagination = { page: 1, parPage: 30 };

function genererStatsVentes() {
  const agent = document.getElementById('statAgentFilter')?.value || 'tous';
  const type = document.getElementById('statTypeFilter')?.value || 'toutes';
  const du = document.getElementById('statDu')?.value;
  const au = document.getElementById('statAu')?.value;

  let liste = VENTES_DATA.filter(estDepuisClotureVente);
  if (agent !== 'tous') liste = liste.filter(v => v.agent_nom === agent);
  if (type !== 'toutes') liste = liste.filter(v => v.type.toLowerCase() === type);
  if (du || au) {
    const toISO = (dmy) => { const [d, m, y] = dmy.split('/'); return `${y}-${m}-${d}`; };
    liste = liste.filter(v => {
      const iso = toISO(v.date);
      return (!du || iso >= du) && (!au || iso <= au);
    });
  }
  liste = [...liste].sort((a, b) => (b.id || 0) - (a.id || 0));

  assurerConteneurPagination('paginationStatsVentes', 'statsVentesBody');
  const { pageListe, totalPages } = paginerListe(liste, _statsVentesPagination);

  document.getElementById('statsVentesCount').textContent = liste.length;
  document.getElementById('statsVentesBody').innerHTML = liste.length === 0
    ? `<tr><td colspan="6" class="ventes-empty">Aucune vente ne correspond à ce filtre.</td></tr>`
    : pageListe.map(v => `
        <tr>
          <td>${v.date}</td>
          <td>${v.bien}</td>
          <td><span class="badge-type ${v.type}">${v.type.toUpperCase()}</span></td>
          <td class="prix">${v.prix}</td>
          <td>${v.agent_nom}</td>
          <td>${v.client}</td>
        </tr>`).join('');

  renderBoutonsPagination('paginationStatsVentes', _statsVentesPagination, totalPages, 'allerPageStatsVentes');
}

function allerPageStatsVentes(p) { _statsVentesPagination.page = p; genererStatsVentes(); }
function changerParPageStatsVentes(v) { _statsVentesPagination.parPage = v; _statsVentesPagination.page = 1; genererStatsVentes(); }
function filtrerStatsVentes() { _statsVentesPagination.page = 1; genererStatsVentes(); }

document.getElementById('statAgentFilter')?.addEventListener('change', () => {
  renderStatsOverview();
  filtrerStatsVentes();
});
document.getElementById('statTypeFilter')?.addEventListener('change', filtrerStatsVentes);
document.getElementById('statDu')?.addEventListener('change', (e) => { e.target.dataset.userSet = '1'; filtrerStatsVentes(); });
document.getElementById('statAu')?.addEventListener('change', (e) => { e.target.dataset.userSet = '1'; filtrerStatsVentes(); });

function getSemaineISO(dateStr) {
  const [d, m, y] = dateStr.split('/');
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  const janvier1 = new Date(date.getFullYear(), 0, 1);
  const jours = Math.floor((date - janvier1) / 86400000);
  const semaine = Math.ceil((jours + janvier1.getDay() + 1) / 7);
  return `${date.getFullYear()}-S${String(semaine).padStart(2, '0')}`;
}

function genererStatsParSemaine() {
  const tbody = document.getElementById('statsSemaineBody');
  if (!tbody) return;

  const parSemaine = {};
  VENTES_DATA.forEach(v => {
    const sem = getSemaineISO(v.date);
    if (!parSemaine[sem]) parSemaine[sem] = { ventes: 0, volume: 0, commission: 0 };
    parSemaine[sem].ventes += 1;
    parSemaine[sem].volume += parseMontant(v.prix);
    parSemaine[sem].commission += parseMontant(v.commission);
  });

  const semaines = Object.entries(parSemaine).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8);
  tbody.innerHTML = semaines.length === 0
    ? `<tr><td colspan="4" class="ventes-empty">Aucune donnée.</td></tr>`
    : semaines.map(([sem, d]) => `
      <tr><td>${sem}</td><td>${d.ventes}</td><td>${d.volume.toLocaleString('fr-FR')} $</td><td class="commission">${d.commission.toLocaleString('fr-FR')} $</td></tr>`).join('');
}

// ================================================================
//  PAGE VENTES AUX ENCHÈRES
//  Connecté à l'API — CRUD complet + attribution du gagnant.
// ================================================================
let ENCHERES_DATA = [];

let _enchereEditId = null;
let _enchereNouveauxFichiers = [];
let _enchereImagesExistantes = [];
let _enchereZoomId = null;
let _enchereZoomIndex = 0;
let _enchereVendreId = null;

async function chargerEncheres() {
  try {
    const res = await fetch(`${SERVER_URL}/api/encheres`, { credentials: 'include' });
    if (res.ok) ENCHERES_DATA = await res.json();
  } catch (e) { console.error('Erreur chargement enchères:', e); }
}

function genererEncheres() {
  const grid = document.getElementById('encheresGrid');
  if (!grid) return;

  if (ENCHERES_DATA.length === 0) {
    grid.innerHTML = `<p class="encheres-empty">Aucune enchère en cours.</p>`;
    return;
  }

  const triees = [...ENCHERES_DATA].sort((a, b) => b.id - a.id);
  assurerConteneurPagination('paginationEncheres', 'encheresGrid');
  const { pageListe, totalPages } = paginerListe(triees, _encheresPagination);

  grid.innerHTML = pageListe.map(e => {
    const vendue = e.statut === 'vendue';
    return `
    <div class="enchere-card">
      <div class="enchere-media" onclick="ouvrirZoomEnchere(${e.id})">
        <img src="${vignette(e.images[0], 400, 300)}" loading="lazy" style="background:#0c2416;" onerror="this.src='assets/placeholder.png'">
        <span class="enchere-statut-badge ${e.statut}">${vendue ? 'Vendue' : 'En cours'}</span>
      </div>
      <div class="enchere-body">
        <h4>${e.nom}</h4>
        <div class="infos">Prix de départ : ${e.prixDepart.toLocaleString('fr-FR')}$ | Coffre : ${e.coffre.toLocaleString('fr-FR')} kg</div>
        ${vendue ? `<div class="vendu-info">Vendu à ${e.vendu.client} — ${e.vendu.prixFinal.toLocaleString('fr-FR')}$</div>` : ''}
      </div>
      <div class="enchere-actions">
        ${!vendue ? `<button class="btn-ench-vendre" onclick="ouvrirModalVendre(${e.id})">💰 Vendre</button>` : ''}
        <button class="btn-ench-modifier" onclick="ouvrirModalEnchere(${e.id})">✏️ Modifier</button>
        <button class="btn-ench-supprimer" onclick="supprimerEnchere(${e.id})">🗑️ Supprimer</button>
      </div>
    </div>`;
  }).join('');

  renderBoutonsPagination('paginationEncheres', _encheresPagination, totalPages, 'allerPageEncheres');
}

let _encheresPagination = { page: 1, parPage: 12, options: [12, 24, 48] };

function allerPageEncheres(p) { _encheresPagination.page = p; genererEncheres(); }
function changerParPageEncheres(v) { _encheresPagination.parPage = v; _encheresPagination.page = 1; genererEncheres(); }

// ---------- Créer / Modifier ----------
function ouvrirModalEnchere(id) {
  _enchereEditId = id ?? null;
  _enchereNouveauxFichiers = [];
  const enchere = id ? ENCHERES_DATA.find(e => e.id === id) : null;
  _enchereImagesExistantes = enchere ? [...enchere.images] : [];

  document.getElementById('enchereModalTitle').textContent = enchere ? "✏️ Modifier l'enchère" : '🔨 Créer une vente aux enchères';
  document.getElementById('ench_nom').value = enchere ? enchere.nom : '';
  document.getElementById('ench_prix').value = enchere ? enchere.prixDepart : '';
  document.getElementById('ench_coffre').value = enchere ? enchere.coffre : '';
  document.getElementById('ench_photos').value = '';

  renderEncherePhotosPreview();
  document.getElementById('enchereModalOverlay').classList.add('open');
}

function fermerModalEnchere() {
  document.getElementById('enchereModalOverlay').classList.remove('open');
}
function fermerModalEnchereOutside(event) {
  if (event.target.id === 'enchereModalOverlay') fermerModalEnchere();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('ench_photos')?.addEventListener('change', (e) => {
    _enchereNouveauxFichiers.push(...Array.from(e.target.files));
    renderEncherePhotosPreview();
    e.target.value = '';
  });
});

function renderEncherePhotosPreview() {
  const wrap = document.getElementById('enchPhotosPreview');
  if (!wrap) return;

  const apercus = [
    ..._enchereImagesExistantes.map(url => vignette(url, 120, 120)),
    ..._enchereNouveauxFichiers.map(f => URL.createObjectURL(f))
  ];

  if (apercus.length === 0) {
    wrap.innerHTML = `<p class="photo-upload-empty">Aucune photo sélectionnée</p>`;
    return;
  }

  wrap.innerHTML = apercus.map((src, i) => `
    <div class="photo-thumb ${i === 0 ? 'principale' : ''}">
      <img src="${src}" loading="lazy">
      <button type="button" class="remove-photo" onclick="retirerPhotoEnchere(${i})">✕</button>
    </div>
  `).join('');
}

function retirerPhotoEnchere(indexGlobal) {
  if (indexGlobal < _enchereImagesExistantes.length) {
    _enchereImagesExistantes.splice(indexGlobal, 1);
  } else {
    _enchereNouveauxFichiers.splice(indexGlobal - _enchereImagesExistantes.length, 1);
  }
  renderEncherePhotosPreview();
}

async function soumettreEnchereForm(event) {
  event.preventDefault();

  const nom = document.getElementById('ench_nom').value.trim();
  const prixDepart = Number(document.getElementById('ench_prix').value) || 0;
  const coffre = Number(document.getElementById('ench_coffre').value) || 0;

  if (!nom) { alert('Le nom du bien est requis.'); return false; }
  if (_enchereImagesExistantes.length + _enchereNouveauxFichiers.length === 0) {
    alert('Ajoute au moins une photo.'); return false;
  }

  const submitBtn = event.target.querySelector('button[type=submit]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Envoi...'; }

  try {
    let nouvellesUrls = [];
    if (_enchereNouveauxFichiers.length > 0) nouvellesUrls = await uploaderPhotos(_enchereNouveauxFichiers);
    const images = [..._enchereImagesExistantes, ...nouvellesUrls];

    const url = _enchereEditId ? `${SERVER_URL}/api/encheres/${_enchereEditId}` : `${SERVER_URL}/api/encheres`;
    const method = _enchereEditId ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method, credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom, images, prixDepart, coffre })
    });
    const data = await res.json();
    if (!res.ok) { alert(`❌ ${data.error || 'Échec'}`); return false; }

    if (_enchereEditId) {
      const idx = ENCHERES_DATA.findIndex(e => e.id === _enchereEditId);
      if (idx >= 0) ENCHERES_DATA[idx] = data;
    } else {
      ENCHERES_DATA.push(data);
    }

    fermerModalEnchere();
    genererEncheres();
  } catch (e) {
    console.error(e);
    alert("❌ Erreur lors de l'enregistrement.");
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Enregistrer'; }
  }
  return false;
}

async function supprimerEnchere(id) {
  const e = ENCHERES_DATA.find(x => x.id === id);
  if (!e) return;
  if (!confirm(`Supprimer définitivement l'enchère "${e.nom}" ?`)) return;

  try {
    const res = await fetch(`${SERVER_URL}/api/encheres/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) throw new Error('Échec');
    ENCHERES_DATA = ENCHERES_DATA.filter(x => x.id !== id);
    genererEncheres();
  } catch (e) { alert('❌ Impossible de supprimer cette enchère.'); }
}

// ---------- Zoom / détail ----------
function ouvrirZoomEnchere(id) {
  const e = ENCHERES_DATA.find(x => x.id === id);
  if (!e) return;
  _enchereZoomId = id;
  _enchereZoomIndex = 0;

  document.getElementById('enchereZoomTitle').textContent = e.nom;
  document.getElementById('enchereZoomPrix').textContent = `${e.prixDepart.toLocaleString('fr-FR')}$`;
  document.getElementById('enchereZoomCoffre').textContent = `${e.coffre.toLocaleString('fr-FR')} kg`;

  const nav = e.images.length > 1;
  document.getElementById('enchereZoomPrev').style.display = nav ? 'flex' : 'none';
  document.getElementById('enchereZoomNext').style.display = nav ? 'flex' : 'none';
  document.getElementById('enchereZoomDots').innerHTML = nav
    ? e.images.map((_, i) => `<span class="dot ${i === 0 ? 'active' : ''}"></span>`).join('')
    : '';

  const btnVendre = document.getElementById('enchereZoomBtnVendre');
  const vendueInfo = document.getElementById('enchereZoomVendueInfo');
  if (e.statut === 'vendue') {
    btnVendre.style.display = 'none';
    vendueInfo.style.display = 'block';
    vendueInfo.innerHTML = `<div class="enchere-zoom-vendue-box">Vendue à ${e.vendu.client} — ${e.vendu.prixFinal.toLocaleString('fr-FR')}$ le ${e.vendu.date}</div>`;
  } else {
    btnVendre.style.display = 'block';
    vendueInfo.style.display = 'none';
    btnVendre.onclick = () => { fermerZoomEnchere(); ouvrirModalVendre(id); };
  }

  majImageZoom();
  document.getElementById('enchereZoomOverlay').classList.add('open');
}

function majImageZoom() {
  const e = ENCHERES_DATA.find(x => x.id === _enchereZoomId);
  if (!e) return;
  document.getElementById('enchereZoomImg').src = vignette(e.images[_enchereZoomIndex], 900, 600);
  document.querySelectorAll('#enchereZoomDots .dot').forEach((d, i) => d.classList.toggle('active', i === _enchereZoomIndex));
}

function naviguerZoomPhoto(direction) {
  const e = ENCHERES_DATA.find(x => x.id === _enchereZoomId);
  if (!e || e.images.length < 2) return;
  _enchereZoomIndex = (_enchereZoomIndex + direction + e.images.length) % e.images.length;
  majImageZoom();
}

function fermerZoomEnchere() {
  document.getElementById('enchereZoomOverlay').classList.remove('open');
}
function fermerZoomEnchereOutside(event) {
  if (event.target.id === 'enchereZoomOverlay') fermerZoomEnchere();
}

// ---------- Vendre / attribuer le gagnant ----------
function ouvrirModalVendre(id) {
  const e = ENCHERES_DATA.find(x => x.id === id);
  if (!e) return;
  _enchereVendreId = id;

  document.getElementById('vendreSubtitle').textContent = `${e.nom} — départ ${e.prixDepart.toLocaleString('fr-FR')}$`;
  document.getElementById('vendre_client').value = '';
  document.getElementById('vendre_tel').value = '';
  document.getElementById('vendre_discord').value = '';
  document.getElementById('vendre_prix').value = e.prixDepart;

  document.getElementById('vendreModalOverlay').classList.add('open');
}

function fermerModalVendre() {
  document.getElementById('vendreModalOverlay').classList.remove('open');
}
function fermerModalVendreOutside(event) {
  if (event.target.id === 'vendreModalOverlay') fermerModalVendre();
}

async function soumettreVendreForm(event) {
  event.preventDefault();

  const client = document.getElementById('vendre_client').value.trim();
  const tel = document.getElementById('vendre_tel').value.trim();
  const discord = document.getElementById('vendre_discord').value.trim();
  const prixFinal = Number(document.getElementById('vendre_prix').value) || 0;

  if (!client || !discord || !prixFinal) { alert('Nom, ID Discord et prix final sont requis.'); return false; }

  try {
    const res = await fetch(`${SERVER_URL}/api/encheres/${_enchereVendreId}/vendre`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client, tel, discord, prixFinal })
    });
    const data = await res.json();
    if (!res.ok) { alert(`❌ ${data.error || 'Échec'}`); return false; }

    const idx = ENCHERES_DATA.findIndex(e => e.id === _enchereVendreId);
    if (idx >= 0) ENCHERES_DATA[idx] = data.enchere;

    fermerModalVendre();
    genererEncheres();
  } catch (e) {
    console.error(e);
    alert('❌ Erreur lors de la vente.');
  }
  return false;
}

// ================================================================
//  PAGE PERMISSIONS — membres, rôles Discord, matrice des accès
// ================================================================

const ROLE_CONFIG = {
  owner:      { label: 'OWNER',      discordId: '1445407258891780165' },
  co_patron:  { label: 'CO-PATRON',  discordId: '1445407258891780164' },
  staff:      { label: 'STAFF',      discordId: '1445407258891780166' },
  hg:         { label: 'HG',         discordId: '1445407258891780163' },
  agent:      { label: 'AGENT IMMO', discordId: '1445407258891780162' },
  decorateur: { label: 'DÉCORATEUR', discordId: '1529124122578391080' }
};

const ROLE_LEVELS = {
  client: 0,
  decorateur: 0.5,
  agent: 1,
  hg: 2,
  staff: 3,
  co_patron: 4,
  owner: 5
};

function hasPermission(minRole) {
  const roleActuel = window.currentUser?.role || 'client';
  return (ROLE_LEVELS[roleActuel] ?? 0) >= (ROLE_LEVELS[minRole] ?? 0);
}

// ================================================================
//  PAGINATION GÉNÉRIQUE — réutilisable sur toutes les listes longues
//  Convention : allerPageXxx(page) + changerParPageXxx(val)
// ================================================================
function paginerListe(liste, etat) {
  const parPage = etat.parPage === 'all' ? Math.max(liste.length, 1) : Number(etat.parPage);
  const totalPages = Math.max(1, Math.ceil(liste.length / parPage));
  if (etat.page > totalPages) etat.page = totalPages;
  if (etat.page < 1) etat.page = 1;
  etat.total = liste.length;
  const debut = (etat.page - 1) * parPage;
  return { pageListe: liste.slice(debut, debut + parPage), totalPages };
}

function renderSelecteurParPage(etat, onChangeFn, options = etat.options || [30, 50, 100]) {
  return `<select onchange="${onChangeFn}(this.value)" style="width:auto;margin:0;padding:5px 8px;">
    ${options.map(n => `<option value="${n}" ${etat.parPage == n ? 'selected' : ''}>${n} / page</option>`).join('')}
    <option value="all" ${etat.parPage == 'all' ? 'selected' : ''}>Voir tout</option>
  </select>`;
}

// Crée le conteneur juste après le tableau (ou après l'élément si c'est une grille)
function assurerConteneurPagination(containerId, anchorId) {
  if (document.getElementById(containerId)) return;
  const anchor = document.getElementById(anchorId);
  if (!anchor) return;
  const table = anchor.closest('table');
  const wrap = table ? (table.closest('.ventes-table-wrap') || table) : anchor;
  const el = document.createElement('div');
  el.id = containerId;
  wrap.after(el);
}

function renderBoutonsPagination(containerId, etat, totalPages, onPageFn) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const options = etat.options || [30, 50, 100];
  const total = etat.total || 0;
  if (total <= options[0]) { el.innerHTML = ''; return; }

  const parPage = etat.parPage === 'all' ? total : Number(etat.parPage);
  const debut = (etat.page - 1) * parPage + 1;
  const fin = Math.min(etat.page * parPage, total);
  const onParPageFn = onPageFn.replace('allerPage', 'changerParPage');

  const btn = (label, page, actif = false, off = false) => `
    <button ${off ? 'disabled' : ''} onclick="${onPageFn}(${page})" style="
      padding:6px 12px;margin:0;border:1px solid ${actif ? '#2e7d32' : '#ddd'};
      background:${actif ? '#2e7d32' : 'white'};color:${actif ? 'white' : '#333'};
      border-radius:6px;cursor:${off ? 'default' : 'pointer'};font-size:13px;opacity:${off ? .45 : 1};">${label}</button>`;

  // 1 … 4 5 6 … 20
  const pages = [...new Set([1, etat.page - 1, etat.page, etat.page + 1, totalPages])]
    .filter(p => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  let numeros = '', prec = 0;
  pages.forEach(p => {
    if (p - prec > 1) numeros += `<span style="padding:0 4px;color:#999;">…</span>`;
    numeros += btn(p, p, p === etat.page);
    prec = p;
  });

  const selecteur = typeof window[onParPageFn] === 'function'
    ? renderSelecteurParPage(etat, onParPageFn, options) : '';

  el.style.cssText = 'display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:6px;margin-top:14px;';
  el.innerHTML = `
    <span style="font-size:12px;color:#888;margin-right:8px;">${debut}–${fin} sur ${total}</span>
    ${totalPages > 1 ? btn('‹', etat.page - 1, false, etat.page <= 1) + numeros + btn('›', etat.page + 1, false, etat.page >= totalPages) : ''}
    ${selecteur}`;
}

let MEMBRES_DATA = [];

function genererPermissions() {
  genererFiltreGrades();
  genererTableauMembres();
  genererMatricePermissions();
}

function genererFiltreGrades() {
  const select = document.getElementById('filterGrade');
  if (!select) return;
  select.innerHTML = `<option value="tous">Tous les grades</option>` +
    Object.entries(ROLE_CONFIG).map(([key, r]) => `<option value="${key}">${r.label}</option>`).join('');
    select.onchange = () => { _membresPagination.page = 1; genererTableauMembres(); };
}

let _membresPagination = { page: 1, parPage: 30 };

function genererTableauMembres() {
  const tbody = document.getElementById('membresTableBody');
  if (!tbody) return;
  const peutModifier = hasPermission('hg'); // ← AJOUTÉ
  const filtre = document.getElementById('filterGrade')?.value || 'tous';
  const liste = filtre === 'tous' ? MEMBRES_DATA : MEMBRES_DATA.filter(m => m.role === filtre);
  const { pageListe, totalPages } = paginerListe(liste, _membresPagination);
  assurerConteneurPagination('paginationMembres', 'membresTableBody');

  tbody.innerHTML = pageListe.map(m => {
    const roleCell = (peutModifier && m.role !== 'owner')
      ? `<select class="role-select-inline role-${m.role}" onchange="changerRolePreview('${m.discord_id}', this.value)">
          ${Object.entries(ROLE_CONFIG).map(([key, r]) =>
            `<option value="${key}" ${key === m.role ? 'selected' : ''}>${r.label}</option>`
          ).join('')}
        </select>`
      : `<span class="role-badge ${m.role}">${ROLE_CONFIG[m.role].label}</span>`;

    const actionCell = (peutModifier && m.role !== 'owner')
      ? `<button class="btn-supprimer" onclick="revoquerMembrePreview('${m.discord_id}')">Révoquer</button>`
      : `<span style="color:var(--ink-faint);">—</span>`;

    return `
      <tr>
        <td>${m.nom_rp}</td>
        <td style="color:var(--ink-faint);">${m.nom_hrp}</td>
        <td><code style="font-size:11px;color:var(--ink-faint);">${m.discord_id}</code></td>
        <td>${roleCell}</td>
        <td>${actionCell}</td>
      </tr>
    `;
  }).join('');
  renderBoutonsPagination('paginationMembres', _membresPagination, totalPages, 'allerPageMembres');
}

function allerPageMembres(page) { _membresPagination.page = page; genererTableauMembres(); }
function changerParPageMembres(val) { _membresPagination.parPage = val; _membresPagination.page = 1; genererTableauMembres(); }

async function revoquerMembrePreview(discordId) {
  if (!confirm('Révoquer ce membre ?')) return;
  try {
    const res = await fetch(`${SERVER_URL}/api/membres/${discordId}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) throw new Error('Échec');
    MEMBRES_DATA = MEMBRES_DATA.filter(m => m.discord_id !== discordId);
    genererTableauMembres();
    genererConfigMembresTable();
  } catch (e) {
    console.error(e);
    alert('❌ Impossible de révoquer ce membre.');
  }
}

async function changerRolePreview(discordId, nouveauRole) {
  try {
    const res = await fetch(`${SERVER_URL}/api/membres/${discordId}/role`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: nouveauRole })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Échec');
    }
    const membre = MEMBRES_DATA.find(m => m.discord_id === discordId);
    if (membre) membre.role = nouveauRole;
    genererTableauMembres();
  } catch (e) {
    alert(`❌ ${e.message}`);
    genererTableauMembres();
  }
}

const MATRICE_PERMISSIONS = [
  { action: 'Catalogue & carte des cohérences', acces: { decorateur:1, agent:1, hg:1, staff:1, co_patron:1, owner:1 } },
  { action: 'Ventes / Ressources / Mon Espace', acces: { decorateur:0, agent:1, hg:1, staff:1, co_patron:1, owner:1 } },
  { action: 'Statistiques', acces: { decorateur:0, agent:0, hg:1, staff:1, co_patron:1, owner:1 } },
  { action: "Journal d'activité", acces: { decorateur:0.5, agent:0, hg:1, staff:1, co_patron:1, owner:1 } },
  { action: 'Espace Décoration', acces: { decorateur:1, agent:0, hg:1, staff:1, co_patron:1, owner:1 } },
  { action: 'Ventes aux enchères', acces: { decorateur:0, agent:0, hg:1, staff:1, co_patron:1, owner:1 } },
  { action: 'Page Permissions', acces: { decorateur:0, agent:0, hg:1, staff:1, co_patron:1, owner:1 } },
  { action: 'Config (maintenance, taxes, zones)', acces: { decorateur:0, agent:0, hg:0, staff:0, co_patron:0, owner:1 } },
  { action: 'Config Décoration', acces: { decorateur:0, agent:0, hg:0, staff:0, co_patron:0, owner:1 } },
];

function genererMatricePermissions() {
  const tbody = document.getElementById('matrixTableBody');
  if (!tbody) return;
  const cols = ['decorateur','agent','hg','staff','co_patron','owner'];

  tbody.innerHTML = MATRICE_PERMISSIONS.map(row => `
    <tr>
      <td>${row.action}</td>
      ${cols.map(c => {
        const v = row.acces[c];
        if (v === 1) return `<td><span class="matrix-yes">✅</span></td>`;
        if (v === 0.5) return `<td><span class="matrix-partial">👁️</span></td>`;
        return `<td><span class="matrix-no">—</span></td>`;
      }).join('')}
    </tr>
  `).join('');
}

function openMemberModal() { document.getElementById('memberModalOverlay').classList.add('open'); }
function closeMemberModal() { document.getElementById('memberModalOverlay').classList.remove('open'); }
function closeMemberModalOutside(event) { if (event.target.id === 'memberModalOverlay') closeMemberModal(); }

async function submitMemberForm(event) {
  event.preventDefault();
  const nom_rp = document.getElementById('mb_nom_rp').value.trim();
  const nom_hrp = document.getElementById('mb_nom_hrp').value.trim();
  const discord_id = document.getElementById('mb_discord').value.trim();
  const role = document.getElementById('mb_role').value;

  try {
    const res = await fetch(`${SERVER_URL}/api/membres`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom_rp, nom_hrp, discord_id, role })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Échec de l\'ajout');

    MEMBRES_DATA.push(data);
    genererTableauMembres();
    closeMemberModal();
    event.target.reset();
  } catch (e) {
    alert(`❌ ${e.message}`);
  }
  return false;
}

// ================================================================
//  PAGE LOGS — logs du site + logs du bot Discord (onglets)
// ================================================================

const LOGS_SITE_TYPES = {
  LOGIN:         { label: 'Connexion',          icon: '🔐', color: '#4fc3f7' },
  LOGOUT:        { label: 'Déconnexion',        icon: '🚪', color: '#90a4ae' },
  VENTE:         { label: 'Vente enregistrée',  icon: '🏠', color: '#81c784' },
  VENTE_EDIT:    { label: 'Vente modifiée',     icon: '✏️', color: '#64b5f6' },
  VENTE_DELETE:  { label: 'Vente supprimée',    icon: '🗑️', color: '#ef5350' },
  VENTE_INCO:    { label: 'Incohérence signalée', icon: '⚠️', color: '#e0b13d' },
  VENTE_INCO_OK: { label: 'Incohérence résolue',  icon: '✅', color: '#3ba55c' },
  VENTES_RESET:  { label: 'Close Compta',       icon: '📅', color: '#ab47bc' },
  MEMBRE_ADD:    { label: 'Membre ajouté',      icon: '➕', color: '#80cbc4' },
  MEMBRE_DEL:    { label: 'Membre révoqué',     icon: '❌', color: '#ef9a9a' },
  ROLE_CHANGE:   { label: 'Rôle modifié',       icon: '🔄', color: '#fff176' },
  CONFIG_TAXES:  { label: 'Taxes modifiées',    icon: '💰', color: '#e0b13d' },
  BIEN_ADD:      { label: 'Bien ajouté',        icon: '🏠', color: '#66bb6a' },
  BIEN_EDIT:     { label: 'Bien modifié',       icon: '✏️', color: '#64b5f6' },
  BIEN_DEL:      { label: 'Bien supprimé',      icon: '🗑️', color: '#ef5350' },
  CATEGORIE_ADD: { label: 'Catégorie ajoutée',  icon: '🏷️', color: '#4fc3f7' },
  ZONES_SHAPES_MAJ: { label: 'Carte des zones mise à jour', icon: '🗺️', color: '#4fc3f7' },
  CATEGORIE_DEL: { label: 'Catégorie supprimée',icon: '🗑️', color: '#ef5350' },
  ZONE_ADD:      { label: 'Zone ajoutée',       icon: '🗺️', color: '#4fc3f7' },
  ZONE_DEL:      { label: 'Zone supprimée',     icon: '🗑️', color: '#ef5350' },
  CONFIG_WEBHOOKS: { label: 'Webhooks modifiés', icon: '🔗', color: '#5865F2' },
  BACKUP_MANUEL: { label: 'Backup manuel',      icon: '💾', color: '#747f8d' },
  EXPORT_VENTES: { label: 'Export ventes',      icon: '📤', color: '#66bb6a' },
  EXPORT_MEMBRES:{ label: 'Export membres',     icon: '📤', color: '#66bb6a' },
  BL_VILLA_ADD:  { label: 'Blacklist villa ajoutée', icon: '🚫', color: '#ed4245' },
  BL_VILLA_DEL:  { label: 'Blacklist villa retirée', icon: '✅', color: '#3ba55c' },
  DECO_PROFIL_MAJ: { label: 'Profil déco mis à jour', icon: '🎨', color: '#a06bd6' },
  DECO_OFFICIEL: { label: 'Statut officiel modifié',  icon: '✅', color: '#a06bd6' },
  DECO_REVOQUE:  { label: 'Décorateur révoqué', icon: '❌', color: '#ef9a9a' },
  DECO_ADD:      { label: 'Décoration ajoutée', icon: '🎬', color: '#5865F2' },
  DECO_EDIT:     { label: 'Décoration modifiée',icon: '✏️', color: '#64b5f6' },
  DECO_DEL:      { label: 'Décoration supprimée', icon: '🗑️', color: '#e74c3c' },
  DECO_VALIDATION: { label: 'Décoration validée', icon: '📋', color: '#3ba55c' },
  DECO_PAGE_MAJ: { label: 'Page déco modifiée', icon: '🗂️', color: '#a06bd6' },
  STYLE_DECO_ADD:  { label: 'Style ajouté',     icon: '🎨', color: '#a06bd6' },
  STYLE_DECO_DEL:  { label: 'Style supprimé',   icon: '🗑️', color: '#ef5350' },
  COMMISSION_DECO: { label: 'Commission modifiée', icon: '💼', color: '#e0b13d' },
  BL_DECO_ADD:   { label: 'Blacklist déco ajoutée', icon: '🚫', color: '#ed4245' },
  BL_DECO_DEL:   { label: 'Blacklist déco retirée', icon: '✅', color: '#3ba55c' },
  LOGS_CLEAR:    { label: 'Logs vidés',         icon: '🗑️', color: '#ef5350' },
  ACCESS_INDIV_ADD:  { label: 'Restriction individuelle ajoutée', icon: '🚫', color: '#ed4245' },
  ACCESS_INDIV_DEL:  { label: 'Restriction individuelle retirée', icon: '✅', color: '#3ba55c' },
  DISCORD_BANS_SYNC: { label: 'Bans Discord synchronisés',        icon: '🔄', color: '#5865F2' },
};

const LOGS_BOT_TYPES = {
  WEBHOOK_VENTE:     { label: 'Vente postée sur Discord', icon: '📨', color: '#5865F2' },
  WEBHOOK_EDIT:      { label: 'Message Discord modifié',  icon: '✏️', color: '#7289da' },
  DM_CERTIFICAT:     { label: 'Certificat envoyé (DM)',   icon: '✉️', color: '#43b581' },
  DM_CORRECTION:     { label: 'Correction envoyée (DM)',  icon: '⚠️', color: '#faa61a' },
  BACKUP_AUTO:       { label: 'Backup automatique',       icon: '💾', color: '#99aab5' },
  BACKUP_MANUEL:     { label: 'Backup manuel',             icon: '💾', color: '#747f8d' },
  BL_VILLA_ADD:      { label: 'Blacklist villa ajoutée',  icon: '🚫', color: '#ed4245' },
  BL_VILLA_DEL:      { label: 'Blacklist villa retirée',  icon: '✅', color: '#3ba55c' },
  DISCORD_STATS:     { label: 'Sync stats Discord',        icon: '📊', color: '#5865F2' }
};

let LOGS_SITE_DATA = [];

function formatLogDetails(type, d) {
  if (!d) return '';
  switch (type) {
    case 'VENTE': return `${d.type} — "${d.bien}" pour ${d.client} (${d.prix})`;
    case 'VENTE_EDIT': return `"${d.bien}" — client ${d.client}`;
    case 'VENTE_DELETE': return `"${d.bien}" — ${d.client} (${d.prix})`;
    case 'MEMBRE_ADD': return `${d.membre} ajouté en tant que ${d.role}`;
    case 'MEMBRE_DEL': return `${d.membre} révoqué (était ${d.role})`;
    case 'ROLE_CHANGE': return `${d.membre} — ${d.old_role} → ${d.new_role}`;
    case 'LOGIN': case 'LOGOUT': return d.message || '';
    case 'CONFIG_TAXES': return `Achat ${d.achat}% / Location ${d.location}%`;
    case 'BIEN_ADD': case 'BIEN_EDIT': case 'BIEN_DEL': return `Bien "${d.bien}"`;
    case 'CATEGORIE_ADD': case 'CATEGORIE_DEL': return `Catégorie "${d.categorie}"`;
    case 'ZONE_ADD': case 'ZONE_DEL': return `Zone "${d.zone}"`;
    case 'BL_VILLA_ADD': case 'BL_DECO_ADD': return `${d.nom}${d.raison ? ' — ' + d.raison : ''}`;
    case 'BL_VILLA_DEL': case 'BL_DECO_DEL': return d.nom;
    case 'DECO_ADD': case 'DECO_EDIT': case 'DECO_DEL': return d.deco || `#${d.decoId}`;
    case 'DECO_PROFIL_MAJ': return d.nom_rp;
    case 'DECO_OFFICIEL': return `${d.deco} → ${d.officiel ? 'Officiel' : 'Indépendant'}`;
    case 'DECO_REVOQUE': return d.deco;
    case 'DECO_VALIDATION': return `Déco #${d.decoId} — ${d.valide ? 'validée' : 'refusée'}`;
    case 'STYLE_DECO_ADD': case 'STYLE_DECO_DEL': return d.style;
    case 'DECO_PAGE_MAJ': return `${d.deco} — section "${d.section}"`;
    case 'COMMISSION_DECO': return `Taux fixé à ${d.taux}%`;
    case 'EXPORT_VENTES': case 'EXPORT_MEMBRES': return `${d.count} ligne(s) exportée(s)`;
    case 'ZONES_SHAPES_MAJ': return `${d.count} zone(s) publiée(s) sur la carte`;
    case 'CMD_STATSGLOBAL': case 'CMD_UPTIME': case 'CMD_PING': case 'CMD_ENCHERES': case 'CMD_SERVICE_LISTE':
      return d.message || 'Commande exécutée sur Discord';
    case 'CMD_AGENT': return `Agent recherché : ${d.agent || '?'}`;
    case 'CMD_DERNIERE_VENTE': return d.message || 'Dernière vente consultée';
    case 'CMD_BLACKLIST_CHECK': return `ID vérifié : ${d.id || '?'}`;
    case 'ACCESS_INDIV_ADD': return `${d.nom}${d.raison ? ' — ' + d.raison : ''}`;
    case 'ACCESS_INDIV_DEL': return d.nom;
    case 'DISCORD_BANS_SYNC': return `${d.count} ban(s) synchronisé(s)`;
    default: return d.message || Object.entries(d).map(([k, v]) => `${k}: ${v}`).join(', ');
  }
}

async function chargerLogsSite() {
  try {
    const res = await fetch(`${SERVER_URL}/api/logs`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      LOGS_SITE_DATA = data.map(l => ({
        heure: l.heure, date: l.date, type: l.type,
        details: formatLogDetails(l.type, l.details), agent: l.agent_nom
      }));
    }
  } catch (e) { console.error('Erreur chargement logs:', e); }
}

const LOGS_BOT_TYPES_EXTRA = {
  CMD_STATSGLOBAL: { label: 'Commande /statsglobal', icon: '📊', color: '#5865F2' },
  CMD_AGENT:       { label: 'Commande /agent',       icon: '👤', color: '#5865F2' },
  CMD_DERNIERE_VENTE: { label: 'Commande /derniere-vente', icon: '🧾', color: '#5865F2' },
  CMD_SERVICE_LISTE: { label: 'Commande /service-liste', icon: '🟢', color: '#5865F2' },
  CMD_ENCHERES:    { label: 'Commande /encheres',    icon: '🔨', color: '#5865F2' },
  CMD_UPTIME:      { label: 'Commande /uptime',      icon: '⏱️', color: '#5865F2' },
  CMD_PING:        { label: 'Commande /ping',        icon: '🏓', color: '#5865F2' },
  CMD_BLACKLIST_CHECK: { label: 'Commande /blacklist-check', icon: '🚫', color: '#5865F2' },
};
Object.assign(LOGS_BOT_TYPES, LOGS_BOT_TYPES_EXTRA);

let LOGS_BOT_DATA = [];

async function chargerLogsBot() {
  try {
    const res = await fetch(`${SERVER_URL}/api/logs/bot`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      LOGS_BOT_DATA = data.map(l => ({
        heure: l.heure, date: l.date, type: l.type,
        details: formatLogDetails(l.type, l.details), agent: l.agent_nom
      }));
    }
  } catch (e) { console.error('Erreur chargement logs bot:', e); }
}

let _logsActiveTab = 'site';

async function switchLogsTab(tab) {
  _logsActiveTab = tab;
  _logsPagination.page = 1;
  document.querySelectorAll('.logs-tab').forEach(b => b.classList.toggle('active', b.dataset.logtab === tab));
  const note = document.getElementById('logsMockNote');
  if (note) note.textContent = '';

  if (tab === 'site') await chargerLogsSite();
  else await chargerLogsBot();

  genererLogsFiltres();
  genererLogs();
}

function getLogsData() { return _logsActiveTab === 'site' ? LOGS_SITE_DATA : LOGS_BOT_DATA; }
function getLogsTypes() { return _logsActiveTab === 'site' ? LOGS_SITE_TYPES : LOGS_BOT_TYPES; }

function genererLogsFiltres() {
  const typeSelect = document.getElementById('logsFilterType');
  const agentSelect = document.getElementById('logsFilterAgent');
  if (!typeSelect || !agentSelect) return;

  const types = getLogsTypes();
  const valType = typeSelect.value, valAgent = agentSelect.value;

  typeSelect.innerHTML = `<option value="tous">Tous les types</option>` +
    Object.entries(types).map(([key, t]) => `<option value="${key}">${t.icon} ${t.label}</option>`).join('');

  const agents = [...new Set(getLogsData().map(l => l.agent))].sort();
  agentSelect.innerHTML = `<option value="tous">Tous les agents</option>` +
    agents.map(a => `<option value="${a}">${a}</option>`).join('');

  if (types[valType]) typeSelect.value = valType;
  if (agents.includes(valAgent)) agentSelect.value = valAgent;

  const reset = () => { _logsPagination.page = 1; filtrerLogsTable(); };
  typeSelect.onchange = reset;
  agentSelect.onchange = reset;
  document.getElementById('logsDateDebut').onchange = reset;
  document.getElementById('logsDateFin').onchange = reset;
}

async function genererLogs() {
  if (_logsActiveTab === 'site') await chargerLogsSite();
  else await chargerLogsBot();
  genererLogsKpis();
  filtrerLogsTable();
}

function genererLogsKpis() {
  const kpisEl = document.getElementById('logsKpis');
  if (!kpisEl) return;
  const data = getLogsData();
  const types = getLogsTypes();

  const countByType = {};
  data.forEach(l => { countByType[l.type] = (countByType[l.type] || 0) + 1; });
  const topTypes = Object.entries(countByType).sort((a, b) => b[1] - a[1]).slice(0, 4);

  kpisEl.innerHTML = `
    <div class="logs-kpi-card" style="border-left-color:var(--gold);">
      <div class="lbl">Total actions</div>
      <div class="val">${data.length}</div>
    </div>
    ${topTypes.map(([type, count]) => `
      <div class="logs-kpi-card" style="border-left-color:${types[type]?.color || '#999'};">
        <div class="lbl">${types[type]?.icon || ''} ${types[type]?.label || type}</div>
        <div class="val">${count}</div>
      </div>
    `).join('')}
  `;
}

function filtrerLogsTable() {
  const typeFiltre = document.getElementById('logsFilterType')?.value || 'tous';
  const agentFiltre = document.getElementById('logsFilterAgent')?.value || 'tous';
  const dateDebut = document.getElementById('logsDateDebut')?.value || '';
  const dateFin = document.getElementById('logsDateFin')?.value || '';

  const toISO = (dmy) => { const [d,m,y] = dmy.split('/'); return `${y}-${m}-${d}`; };

  const liste = getLogsData().filter(l => {
    const typeOk = typeFiltre === 'tous' || l.type === typeFiltre;
    const agentOk = agentFiltre === 'tous' || l.agent === agentFiltre;
    const iso = toISO(l.date);
    const dateOk = (!dateDebut || iso >= dateDebut) && (!dateFin || iso <= dateFin);
    return typeOk && agentOk && dateOk;
  });

  genererLogsTableRows(liste);
}
let _logsPagination = { page: 1, parPage: 50 };

function genererLogsTableRows(liste) {
  const tbody = document.getElementById('logsTableBody');
  if (!tbody) return;
  const types = getLogsTypes();
  const { pageListe, totalPages } = paginerListe(liste, _logsPagination);
  assurerConteneurPagination('paginationLogs', 'logsTableBody');

  if (liste.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="logs-empty">Aucun log ne correspond aux filtres sélectionnés.</td></tr>`;
    renderBoutonsPagination('paginationLogs', _logsPagination, 1, 'allerPageLogs');
    return;
  }

  tbody.innerHTML = pageListe.map(l => {
    const t = types[l.type] || { label: l.type, icon: '•', color: '#999' };
    return `
      <tr style="border-left-color:${t.color};">
        <td style="color:var(--ink-faint);font-family:monospace;">${l.heure}</td>
        <td style="color:var(--ink-faint);">${l.date}</td>
        <td><span class="logs-type-badge" style="background:${t.color}22;color:${t.color};border:1px solid ${t.color}55;">${t.icon} ${t.label}</span></td>
        <td>${l.details}</td>
        <td><span class="logs-agent-chip">${l.agent}</span></td>
      </tr>`;
  }).join('');
  renderBoutonsPagination('paginationLogs', _logsPagination, totalPages, 'allerPageLogs');
}

function allerPageLogs(page) { _logsPagination.page = page; filtrerLogsTable(); }
function changerParPageLogs(val) { _logsPagination.parPage = val; _logsPagination.page = 1; filtrerLogsTable(); }

async function viderLogs() {
  if (_logsActiveTab === 'bot') { alert("🗑️ Pas encore de flux dédié au bot — rien à vider côté site."); return; }
  if (!confirm('Vider tous les logs ? Une archive PDF sera envoyée sur Discord avant suppression.')) return;

  try {
    await chargerJsPDF();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const dateStr = new Date().toLocaleDateString('fr-FR');

    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(30, 30, 30);
    let y = 15;
    LOGS_SITE_DATA.forEach(l => {
      if (y > 200) { doc.addPage(); y = 15; }
      doc.text(`[${l.date} ${l.heure}] ${l.type} — ${l.agent} — ${l.details}`, 10, y);
      y += 5;
    });

    const pdfBase64 = await blobToBase64(doc.output('blob'));

    const res = await fetch(`${SERVER_URL}/api/logs-webhook`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🗑️ **Archive des logs** — ${dateStr}\n> Vidé par **${window.currentUser?.nom_rp}** — ${LOGS_SITE_DATA.length} entrée(s)`,
        pdfBase64,
        filename: `logs_archive_dynasty8_${dateStr.replace(/\//g, '-')}.pdf`,
      }),
    });
    if (!res.ok) { alert('❌ Échec de l\'archive, logs non vidés.'); return; }

    const delRes = await fetch(`${SERVER_URL}/api/logs`, { method: 'DELETE', credentials: 'include' });
    if (!delRes.ok) throw new Error('Échec de la suppression');
    await genererLogs();
    alert('✅ Logs archivés et vidés.');
  } catch (e) {
    console.error(e);
    alert('❌ Impossible de vider les logs.');
  }
}

// ================================================================
//  PAGE CONFIG — KPIs, cartes de gestion, membres, blacklist, webhooks
// ================================================================
let BIENS_DYNAMIQUES = [];
let CATEGORIES_BIENS_BASE = [];
let CATEGORIES_BIENS_CUSTOM = [];
let ZONES_COHERENCE = [];
let CFG_TAXES = { achat: 20, location: 10 };
let CFG_BLACKLIST_DATA = [];
let CFG_ACCESS_INDIV = [];
let CFG_DISCORD_BANS = [];
let CFG_DISCORD_BANS_SYNC = null;

let _cfgMaintenanceActive = false;

function cfgGoTo(pageKey) {
  const item = document.querySelector(`.side-item[data-page="${pageKey}"]`);
  if (item) showSection(item, pageKey);
}

async function genererConfig() {
  try {
    const res = await fetch(`${SERVER_URL}/api/maintenance`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      _cfgMaintenanceActive = data.active;
      document.getElementById('cfgMaintenanceMsg').value = data.message || '';
      document.getElementById('cfgMaintenanceBadge').textContent = _cfgMaintenanceActive ? 'Maintenance' : 'Site en ligne';
      document.getElementById('cfgMaintenanceBadge').className = `cfg-badge ${_cfgMaintenanceActive ? 'on' : 'off'}`;
      document.getElementById('cfgBtnToggleMaintenance').textContent = _cfgMaintenanceActive ? '✅ Remettre en ligne' : '🔧 Mettre en maintenance';
    }
  } catch (e) { console.error('Erreur chargement maintenance:', e); }

  try {
    const res = await fetch(`${SERVER_URL}/api/config/taxes`, { credentials: 'include' });
    if (res.ok) {
      CFG_TAXES = await res.json();
      document.getElementById('cfgTaxeAchat').value = CFG_TAXES.achat;
      document.getElementById('cfgTaxeLoc').value = CFG_TAXES.location;
    }
  } catch (e) { console.error('Erreur chargement taxes:', e); }

  try {
    const res = await fetch(`${SERVER_URL}/api/config/categories`, { credentials: 'include' });
    if (res.ok) { const d = await res.json(); CATEGORIES_BIENS_BASE = d.base; CATEGORIES_BIENS_CUSTOM = d.custom; }
  } catch (e) { console.error('Erreur chargement catégories:', e); }

  try {
    const res = await fetch(`${SERVER_URL}/api/config/zones`, { credentials: 'include' });
    if (res.ok) { const d = await res.json(); ZONES_COHERENCE = d.liste; }
  } catch (e) { console.error('Erreur chargement zones:', e); }

  try {
    const res = await fetch(`${SERVER_URL}/api/blacklist-villa`, { credentials: 'include' });
    if (res.ok) CFG_BLACKLIST_DATA = await res.json();
  } catch (e) { console.error('Erreur chargement blacklist villa:', e); }

  try {
    const res = await fetch(`${SERVER_URL}/api/config/webhooks`, { credentials: 'include' });
    if (res.ok) {
      const w = await res.json();
      document.getElementById('cfgWebhookVentes').value = w.ventes || '';
      document.getElementById('cfgWebhookCompta').value = w.compta || '';
      document.getElementById('cfgWebhookLogs').value = w.logs || '';
      document.getElementById('cfgBotToken').value = w.botTokenDefini ? '••••••••••••••••••••••••••••' : '';
    }
  } catch (e) { console.error('Erreur chargement webhooks:', e); }

  await chargerBiens();
  await chargerAccessClientsConfig();
  await chargerAccessIndividuel();
  await chargerDiscordBans();
  genererCfgAccessIndividuelTable();
  genererCfgDiscordBansTable();
  chargerErreursConfig();
  genererCfgKpis();
  genererConfigMembresTable();
  genererCfgBlacklistTable();
  await chargerCloture();
  document.getElementById('cfgComptaDesc').textContent = `${VENTES_DATA.filter(estDepuisClotureVente).length} vente(s) dans la période en cours.`;
  document.getElementById('cfgBiensDesc').textContent = `${BIENS_DYNAMIQUES.length} bien(s) dynamique(s) enregistré(s).`;
}  

function genererCfgKpis() {
  const el = document.getElementById('cfgKpis');
  if (!el) return;
  const totalMembres = MEMBRES_DATA.length;
  const totalDecorateurs = MEMBRES_DATA.filter(m => m.isDecorateur).length;
  const totalDecos = DECORATEURS_DATA.reduce((s, d) => s + (d.decos?.length || 0), 0);

  el.innerHTML = `
    <div class="logs-kpi-card"><div class="lbl">Membres</div><div class="val">${totalMembres}</div></div>
    <div class="logs-kpi-card" style="border-left-color:var(--deco);"><div class="lbl">Décorateurs</div><div class="val">${totalDecorateurs}</div></div>
    <div class="logs-kpi-card" style="border-left-color:var(--green);"><div class="lbl">Biens dynamiques</div><div class="val">${BIENS_DYNAMIQUES.length}</div></div>
    <div class="logs-kpi-card" style="border-left-color:#4fc3f7;"><div class="lbl">Décorations</div><div class="val">${totalDecos}</div></div>
    <div class="logs-kpi-card"><div class="lbl">Ventes (période)</div><div class="val">${VENTES_DATA.filter(estDepuisClotureVente).length}</div></div>
    <div class="logs-kpi-card" style="border-left-color:var(--red);"><div class="lbl">Blacklist Villa</div><div class="val">${CFG_BLACKLIST_DATA.length}</div></div>
  `;
}

// ---------- Maintenance ----------
async function toggleMaintenancePreview() {
  const nouvelEtat = !_cfgMaintenanceActive;
  const message = document.getElementById('cfgMaintenanceMsg')?.value || '';
  try {
    const res = await fetch(`${SERVER_URL}/api/maintenance`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: nouvelEtat, message })
    });
    if (!res.ok) throw new Error('Échec de la mise à jour');
    const data = await res.json();
    _cfgMaintenanceActive = data.active;
    const badge = document.getElementById('cfgMaintenanceBadge');
    const btn = document.getElementById('cfgBtnToggleMaintenance');
    badge.textContent = _cfgMaintenanceActive ? 'Maintenance' : 'Site en ligne';
    badge.className = `cfg-badge ${_cfgMaintenanceActive ? 'on' : 'off'}`;
    btn.textContent = _cfgMaintenanceActive ? '✅ Remettre en ligne' : '🔧 Mettre en maintenance';
  } catch (e) { console.error(e); alert('❌ Impossible de mettre à jour le statut de maintenance.'); }
}

async function saveMaintenanceMsgPreview() {
  const message = document.getElementById('cfgMaintenanceMsg')?.value || '';
  try {
    const res = await fetch(`${SERVER_URL}/api/maintenance`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: _cfgMaintenanceActive, message })
    });
    if (!res.ok) throw new Error("Échec de l'enregistrement");
    alert('✅ Message de maintenance enregistré.');
  } catch (e) { console.error(e); alert("❌ Impossible d'enregistrer le message."); }
}

// ---------- Taxes ----------
async function saveTaxesPreview() {
  const achat = Number(document.getElementById('cfgTaxeAchat').value);
  const location = Number(document.getElementById('cfgTaxeLoc').value);
  try {
    const res = await fetch(`${SERVER_URL}/api/config/taxes`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ achat, location })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    CFG_TAXES = data;
    alert(`✅ Taxes enregistrées — Achat ${achat}% / Location ${location}%`);
  } catch (e) { alert(`❌ ${e.message}`); }
}

// ---------- Statut système ----------
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('cfgSocketStatus');
  if (el) { el.textContent = 'Connecté'; el.style.color = 'var(--green)'; }
});

async function testerConnexionPreview(event) {
  const btn = event?.target;
  const original = btn ? btn.textContent : null;
  if (btn) { btn.textContent = 'Test en cours...'; btn.disabled = true; }
  const debut = Date.now();
  try {
    const res = await fetch(`${SERVER_URL}/ping`, { credentials: 'include' });
    const ms = Date.now() - debut;
    if (res.ok) alert(`🔌 Connexion OK (${ms}ms)`);
    else throw new Error('Réponse non OK');
  } catch (e) {
    alert('❌ Impossible de joindre le serveur.');
  } finally {
    if (btn) { btn.textContent = original; btn.disabled = false; }
  }
}

// ---------- Blocage clients ----------
let _cfgAccessClientsBloque = false;

async function chargerAccessClientsConfig() {
  try {
    const res = await fetch(`${SERVER_URL}/api/config/access-clients`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      _cfgAccessClientsBloque = data.bloque;
      document.getElementById('cfgAccessClientsMsg').value = data.message || "L'accès au site est temporairement réservé au personnel Dynasty 8.";
      majBadgeAccessClients();
    }
  } catch (e) { console.error('Erreur chargement blocage clients:', e); }
}

function majBadgeAccessClients() {
  const badge = document.getElementById('cfgAccessClientsBadge');
  const btn = document.getElementById('cfgBtnToggleAccessClients');
  if (!badge || !btn) return;
  badge.textContent = _cfgAccessClientsBloque ? 'Clients bloqués' : 'Accès ouvert';
  badge.className = `cfg-badge ${_cfgAccessClientsBloque ? 'on' : 'off'}`;
  btn.textContent = _cfgAccessClientsBloque ? '✅ Débloquer les clients' : '🚫 Bloquer les clients';
}

async function toggleAccessClientsPreview() {
  const nouvelEtat = !_cfgAccessClientsBloque;
  const message = document.getElementById('cfgAccessClientsMsg')?.value || '';
  try {
    const res = await fetch(`${SERVER_URL}/api/config/access-clients`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bloque: nouvelEtat, message })
    });
    if (!res.ok) throw new Error('Échec');
    const data = await res.json();
    _cfgAccessClientsBloque = data.bloque;
    majBadgeAccessClients();
  } catch (e) { alert('❌ Impossible de mettre à jour le blocage clients.'); }
}

async function saveAccessClientsMsgPreview() {
  const message = document.getElementById('cfgAccessClientsMsg')?.value || '';
  try {
    const res = await fetch(`${SERVER_URL}/api/config/access-clients`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bloque: _cfgAccessClientsBloque, message })
    });
    if (!res.ok) throw new Error('Échec');
    alert('✅ Message enregistré.');
  } catch (e) { alert("❌ Impossible d'enregistrer le message."); }
}

// ---------- Webhooks ----------
function toggleWebhookVisibility(id) {
  const input = document.getElementById(id);
  input.type = input.type === 'password' ? 'text' : 'password';
}

async function testerWebhook(nom) {
  const cibleMap = { 'Ventes': 'ventes', 'Comptabilité': 'compta', 'Logs': 'logs' };
  const cible = cibleMap[nom];
  if (!cible) { alert(`ℹ️ Le token bot ne se teste pas ici — vérifie qu'il est bien renseigné.`); return; }
  try {
    const res = await fetch(`${SERVER_URL}/api/config/webhooks/test`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cible })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    alert(`🔌 Test "${nom}" envoyé — vérifie ton salon Discord.`);
  } catch (e) { alert(`❌ ${e.message}`); }
}

async function enregistrerWebhooksPreview() {
  const ventes = document.getElementById('cfgWebhookVentes').value;
  const compta = document.getElementById('cfgWebhookCompta').value;
  const logs = document.getElementById('cfgWebhookLogs').value;
  const botTokenInput = document.getElementById('cfgBotToken').value;
  const botToken = botTokenInput.startsWith('•') ? undefined : botTokenInput;

  try {
    const res = await fetch(`${SERVER_URL}/api/config/webhooks`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ventes, compta, logs, botToken })
    });
    if (!res.ok) throw new Error('Échec');
    alert('💾 Webhooks enregistrés.');
  } catch (e) { alert('❌ Impossible d\'enregistrer les webhooks.'); }
}

function changerParPageDiscordBans(v) { _discordBansPagination.parPage = v; _discordBansPagination.page = 1; filtrerAccessRestreints(); }

// ---------- Membres & Rôles ----------
let _cfgMembresPagination = { page: 1, parPage: 30 };

function genererConfigMembresTable() {
  const tbody = document.getElementById('cfgMembresTableBody');
  if (!tbody) return;
    const peutModifier = hasPermission('hg');
  const terme = (document.getElementById('cfgMembreSearch')?.value || '').toLowerCase();
  const liste = MEMBRES_DATA.filter(m =>
    m.nom_rp.toLowerCase().includes(terme) || m.nom_hrp.toLowerCase().includes(terme) || m.discord_id.includes(terme)
  );
  const { pageListe, totalPages } = paginerListe(liste, _cfgMembresPagination);
  assurerConteneurPagination('paginationCfgMembres', 'cfgMembresTableBody');

  tbody.innerHTML = pageListe.map(m => {
    const roleCell = (peutModifier && m.role !== 'owner')
      ? `<select class="role-select-inline role-${m.role}" onchange="changerRolePreview('${m.discord_id}', this.value)">
          ${Object.entries(ROLE_CONFIG).map(([key, r]) =>
            `<option value="${key}" ${key === m.role ? 'selected' : ''}>${r.label}</option>`
          ).join('')}
        </select>`
      : `<span class="role-badge ${m.role}">${ROLE_CONFIG[m.role].label}</span>`;

    const decoCell = `<button class="decorateur-toggle-pill ${m.isDecorateur ? 'oui' : 'non'}" onclick="cfgToggleDecorateur('${m.discord_id}')">${m.isDecorateur ? '✅ Oui' : '— Non'}</button>`;

    const actionCell = (peutModifier && m.role !== 'owner')
      ? `<button class="btn-supprimer" onclick="revoquerMembrePreview('${m.discord_id}'); genererConfigMembresTable();">Révoquer</button>`
      : `<span style="color:var(--ink-faint);">—</span>`;

    return `
      <tr>
        <td>${m.nom_rp}</td>
        <td style="color:var(--ink-faint);">${m.nom_hrp}</td>
        <td><code style="font-size:11px;color:var(--ink-faint);">${m.discord_id}</code></td>
        <td>${roleCell}</td>
        <td>${decoCell}</td>
        <td>${actionCell}</td>
      </tr>
    `;
  }).join('');
  renderBoutonsPagination('paginationCfgMembres', _cfgMembresPagination, totalPages, 'allerPageCfgMembres');
}

function allerPageCfgMembres(page) { _cfgMembresPagination.page = page; genererConfigMembresTable(); }
function changerParPageCfgMembres(val) { _cfgMembresPagination.parPage = val; _cfgMembresPagination.page = 1; genererConfigMembresTable(); }

// ---------- Bypass maintenance par ID Discord ----------
async function ouvrirGestionBypassPreview() {
  let idsActuels = [];
  try {
    const res = await fetch(`${SERVER_URL}/api/maintenance/bypass`, { credentials: 'include' });
    if (res.ok) idsActuels = (await res.json()).bypassIds || [];
  } catch (e) { console.error('Erreur chargement bypass maintenance:', e); }

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,10,5,.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:999999;padding:20px;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:16px;padding:26px;width:440px;max-width:92vw;max-height:86vh;overflow-y:auto;color:#222;';
  box.innerHTML = `
    <h3 style="font-family:var(--font-display);font-size:19px;margin-bottom:6px;color:#173a24;">🔑 Bypass maintenance</h3>
    <p style="font-size:12px;color:#888;margin-bottom:14px;">IDs Discord autorisés à accéder au site même en maintenance.</p>
    <div style="display:flex;gap:8px;margin-bottom:14px;">
      <input type="text" id="byp-nouveau" placeholder="ID Discord" style="flex:1;margin:0;">
      <button id="byp-add" class="btn-submit-vente" style="width:auto;margin:0;padding:11px 16px;">+ Ajouter</button>
    </div>
    <div id="byp-liste" style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow-y:auto;"></div>
    <button id="byp-close" style="margin-top:16px;width:100%;padding:10px;border:1px solid #ddd;background:#fff;border-radius:8px;cursor:pointer;">Fermer</button>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => document.body.removeChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  box.querySelector('#byp-close').onclick = close;

  async function sauvegarder() {
    try {
      const res = await fetch(`${SERVER_URL}/api/maintenance`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: _cfgMaintenanceActive, message: document.getElementById('cfgMaintenanceMsg')?.value || '', bypassIds: idsActuels })
      });
      if (!res.ok) throw new Error('Échec');
    } catch (e) { alert("❌ Impossible d'enregistrer la liste de bypass."); }
  }

  function render() {
    box.querySelector('#byp-liste').innerHTML = idsActuels.length === 0
      ? `<p style="color:#aaa;font-size:12px;">Aucun ID autorisé pour le moment.</p>`
      : idsActuels.map(id => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#f7f7f5;border-radius:6px;">
          <code style="font-size:12px;">${id}</code>
          <button data-id="${id}" style="color:#e0685f;font-size:12px;background:none;border:none;cursor:pointer;">Retirer</button>
        </div>`).join('');
    box.querySelectorAll('[data-id]').forEach(btn => {
      btn.onclick = async () => {
        idsActuels = idsActuels.filter(x => x !== btn.dataset.id);
        await sauvegarder();
        render();
      };
    });
  }

  box.querySelector('#byp-add').onclick = async () => {
    const val = box.querySelector('#byp-nouveau').value.trim();
    if (!val || idsActuels.includes(val)) { box.querySelector('#byp-nouveau').value = ''; return; }
    idsActuels.push(val);
    await sauvegarder();
    box.querySelector('#byp-nouveau').value = '';
    render();
  };

  render();
}

async function cfgToggleDecorateur(discordId) {
  const m = MEMBRES_DATA.find(x => x.discord_id === discordId);
  if (!m) return;
  const nouveauStatut = !m.isDecorateur;
  try {
    const res = await fetch(`${SERVER_URL}/api/membres/${discordId}/decorateur`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDecorateur: nouveauStatut })
    });
    if (!res.ok) throw new Error('Échec');
    m.isDecorateur = nouveauStatut;
    genererConfigMembresTable();
    genererCfgKpis();
  } catch (e) { alert('❌ Impossible de changer le statut décorateur.'); }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('cfgMembreSearch')?.addEventListener('input', genererConfigMembresTable);
});

async function chargerAccessIndividuel() {
  try {
    const res = await fetch(`${SERVER_URL}/api/config/access-individuel`, { credentials: 'include' });
    if (res.ok) CFG_ACCESS_INDIV = (await res.json()).liste;
  } catch (e) { console.error('Erreur chargement accès individuel:', e); }
}

async function chargerDiscordBans() {
  try {
    const res = await fetch(`${SERVER_URL}/api/config/discord-bans`, { credentials: 'include' });
    if (res.ok) {
      const d = await res.json();
      CFG_DISCORD_BANS = d.liste;
      CFG_DISCORD_BANS_SYNC = d.derniere_sync;
    }
  } catch (e) { console.error('Erreur chargement bans Discord:', e); }
}

let _accessIndivPagination = { page: 1, parPage: 30 };

function genererCfgAccessIndividuelTable(liste = CFG_ACCESS_INDIV, recherche = false) {
  const tbody = document.getElementById('cfgAccessIndivTableBody');
  if (!tbody) return;
  assurerConteneurPagination('paginationAccessIndiv', 'cfgAccessIndivTableBody');
  const { pageListe, totalPages } = paginerListe(liste, _accessIndivPagination);

  const msgVide = recherche ? 'Aucune restriction ne correspond à la recherche' : 'Aucune restriction individuelle active';
  tbody.innerHTML = liste.length === 0
    ? `<tr><td colspan="5" class="logs-empty">${msgVide}</td></tr>`
    : pageListe.map(e => `
      <tr>
        <td>${e.nom || '—'}</td>
        <td><code style="font-size:11px;color:var(--ink-faint);">${e.discord_id}</code></td>
        <td style="color:var(--ink-faint);">${e.raison || '-'}</td>
        <td style="color:var(--ink-faint);">${e.ajoute_le || '-'}</td>
        <td><button class="btn-supprimer" onclick="retirerAccessIndividuelPreview('${e.discord_id}')">Retirer</button></td>
      </tr>`).join('');
  renderBoutonsPagination('paginationAccessIndiv', _accessIndivPagination, totalPages, 'allerPageAccessIndiv');
}
function allerPageAccessIndiv(p) { _accessIndivPagination.page = p; filtrerAccessRestreints(); }
function changerParPageAccessIndiv(v) { _accessIndivPagination.parPage = v; _accessIndivPagination.page = 1; filtrerAccessRestreints(); }

let _discordBansPagination = { page: 1, parPage: 30 };
let _bansDernierTerme = '';

function allerPageDiscordBans(page) {
  _discordBansPagination.page = page;
  filtrerAccessRestreints();
}

function genererCfgDiscordBansTable(liste = CFG_DISCORD_BANS, recherche = false) {
  const note = document.getElementById('cfgDiscordBansSyncNote');
  if (note) note.textContent = CFG_DISCORD_BANS_SYNC
    ? `Dernière synchro : ${new Date(CFG_DISCORD_BANS_SYNC).toLocaleString('fr-FR')}`
    : 'Jamais synchronisé.';
  const tbody = document.getElementById('cfgDiscordBansTableBody');
  if (!tbody) return;

  const { pageListe, totalPages } = paginerListe(liste, _discordBansPagination);
  assurerConteneurPagination('paginationCfgDiscordBans', 'cfgDiscordBansTableBody');

  const msgVide = recherche ? 'Aucun ban ne correspond à la recherche' : 'Aucun ban connu — clique sur Actualiser.';
  tbody.innerHTML = liste.length === 0
    ? `<tr><td colspan="3" class="logs-empty">${msgVide}</td></tr>`
    : pageListe.map(b => `
      <tr>
        <td>${b.pseudo_discord || '—'}</td>
        <td><code style="font-size:11px;color:var(--ink-faint);">${b.discord_id}</code></td>
        <td style="color:var(--ink-faint);">${b.raison || '-'}</td>
      </tr>`).join('');

  renderBoutonsPagination('paginationCfgDiscordBans', _discordBansPagination, totalPages, 'allerPageDiscordBans');
}

function filtrerAccessRestreints() {
  const terme = (document.getElementById('cfgAccessSearch')?.value || '').trim().toLowerCase();
  
  if (terme !== _bansDernierTerme) {
    _discordBansPagination.page = 1;
    _accessIndivPagination.page = 1;
    _bansDernierTerme = terme;
  }

  if (!terme) {
    genererCfgAccessIndividuelTable();
    genererCfgDiscordBansTable();
    return;
  }

  const indivFiltres = CFG_ACCESS_INDIV.filter(e =>
    (e.nom || '').toLowerCase().includes(terme) ||
    (e.raison || '').toLowerCase().includes(terme) ||
    (e.discord_id || '').toLowerCase().includes(terme)
  );
  const bansFiltres = CFG_DISCORD_BANS.filter(b =>
    (b.pseudo_discord || '').toLowerCase().includes(terme) ||
    (b.raison || '').toLowerCase().includes(terme) ||
    (b.discord_id || '').toLowerCase().includes(terme)
  );

  genererCfgAccessIndividuelTable(indivFiltres, true);
  genererCfgDiscordBansTable(bansFiltres, true);
}

function openAccessIndivModal() { document.getElementById('accessIndivModalOverlay').classList.add('open'); }
function closeAccessIndivModal() { document.getElementById('accessIndivModalOverlay').classList.remove('open'); }
function closeAccessIndivModalOutside(event) { if (event.target.id === 'accessIndivModalOverlay') closeAccessIndivModal(); }

async function submitAccessIndivForm(event) {
  event.preventDefault();
  const discord_id = document.getElementById('ai_discord').value.trim();
  const nom = document.getElementById('ai_nom').value.trim();
  const raison = document.getElementById('ai_raison').value.trim();
  try {
    const res = await fetch(`${SERVER_URL}/api/config/access-individuel`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discord_id, nom, raison })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Échec');
    CFG_ACCESS_INDIV = data.liste;
    genererCfgAccessIndividuelTable();
    closeAccessIndivModal();
    event.target.reset();
  } catch (e) { alert(`❌ ${e.message}`); }
  return false;
}

async function retirerAccessIndividuelPreview(discordId) {
  if (!confirm('Retirer cette restriction individuelle ?')) return;
  try {
    const res = await fetch(`${SERVER_URL}/api/config/access-individuel/${discordId}`, { method: 'DELETE', credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    CFG_ACCESS_INDIV = data.liste;
    genererCfgAccessIndividuelTable();
  } catch (e) { alert('❌ Impossible de retirer cette restriction.'); }
}

async function synchroniserBansDiscord() {
  if (!confirm('Synchroniser la liste des bans depuis le serveur Discord ?')) return;
  try {
    const res = await fetch(`${SERVER_URL}/api/config/discord-bans/sync`, { method: 'POST', credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Échec');
    CFG_DISCORD_BANS = data.liste;
    CFG_DISCORD_BANS_SYNC = new Date().toISOString();
    genererCfgDiscordBansTable();
    alert(`✅ Sync terminée — ${data.count} ban(s) importé(s).`);
  } catch (e) { alert(`❌ ${e.message}`); }
}

// ---------- Blacklist Villa ----------
function genererCfgBlacklistTable() {
  const tbody = document.getElementById('cfgBlacklistTableBody');
  const desc = document.getElementById('cfgBlacklistDesc');
  if (desc) desc.textContent = `${CFG_BLACKLIST_DATA.length} membre(s) actuellement blacklisté(s).`;
  if (!tbody) return;

  if (CFG_BLACKLIST_DATA.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="logs-empty">Aucune blacklist active</td></tr>`;
    return;
  }

  tbody.innerHTML = CFG_BLACKLIST_DATA.map(b => `
    <tr>
      <td>${b.nom}</td>
      <td><code style="font-size:11px;color:var(--ink-faint);">${b.discord_id}</code></td>
      <td style="color:var(--ink-faint);">${b.raison || '-'}</td>
      <td style="color:var(--ink-faint);">${b.fin}</td>
      <td><button class="btn-supprimer" onclick="retirerBlacklistPreview(${b.id})">Retirer</button></td>
    </tr>
  `).join('');
}

function openBlacklistModal() { document.getElementById('blacklistModalOverlay').classList.add('open'); }
function closeBlacklistModal() { document.getElementById('blacklistModalOverlay').classList.remove('open'); }
function closeBlacklistModalOutside(event) { if (event.target.id === 'blacklistModalOverlay') closeBlacklistModal(); }

async function submitBlacklistForm(event) {
  event.preventDefault();
  const nom = document.getElementById('bl_nom').value.trim();
  const discord_id = document.getElementById('bl_discord').value.trim();
  const semaines = Number(document.getElementById('bl_semaines').value) || 2;
  const raison = document.getElementById('bl_raison').value.trim();

  try {
    const res = await fetch(`${SERVER_URL}/api/blacklist-villa`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom, discord_id, semaines, raison })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Échec');
    CFG_BLACKLIST_DATA.push(data);
    genererCfgBlacklistTable();
    genererCfgKpis();
    closeBlacklistModal();
    event.target.reset();
  } catch (e) { alert(`❌ ${e.message}`); }
  return false;
}

async function retirerBlacklistPreview(id) {
  if (!confirm('Retirer cette blacklist ?')) return;
  try {
    const res = await fetch(`${SERVER_URL}/api/blacklist-villa/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) throw new Error('Échec');
    CFG_BLACKLIST_DATA = CFG_BLACKLIST_DATA.filter(b => b.id !== id);
    genererCfgBlacklistTable();
    genererCfgKpis();
  } catch (e) { alert('❌ Impossible de retirer cette blacklist.'); }
}

async function synchroniserMembresDiscord() {
  if (!confirm("Synchroniser tous les membres avec leurs rôles Discord actuels ? Les membres sans rôle Dynasty 8 seront retirés de la base.")) return;
  try {
    const res = await fetch(`${SERVER_URL}/api/membres/sync`, { method: 'POST', credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Échec');
    await chargerMembres();
    genererConfigMembresTable();
    genererTableauMembres();
    genererCfgKpis();
    alert(`✅ Sync terminée — ${data.supprimes} retiré(s), ${data.misAJour} mis à jour.`);
  } catch (e) { alert(`❌ ${e.message}`); }
}

// ================================================================
//  CONFIG AGENCE — GESTION DES BIENS DYNAMIQUES
// ================================================================
async function chargerBiens() {
  try {
    const res = await fetch(`${SERVER_URL}/api/biens`, { credentials: 'include' });
    if (res.ok) {
      BIENS_DYNAMIQUES = await res.json();
      BIENS_DYNAMIQUES.sort((a, b) => a.id - b.id); // du plus ancien au plus récent
    }
  } catch (e) { console.error('Erreur chargement biens:', e); }
}

let _bienMediaType = 'photo';
function switchBienMediaType(type) {
  _bienMediaType = type;
  document.querySelectorAll('#bienMediaTabs button').forEach(b => b.classList.toggle('active', b.dataset.media === type));
  document.getElementById('bienMediaPhotoFields').style.display = type === 'photo' ? 'block' : 'none';
  document.getElementById('bienMediaVideoFields').style.display = type === 'video' ? 'block' : 'none';
}

function ouvrirFormBien(id = null) {
  _bienMediaType = 'photo';
  const bien = id ? BIENS_DYNAMIQUES.find(b => b.id === id) : null;
  let imagesExistantes = bien ? [...bien.images] : [];
  let nouveauxFichiers = [];

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,10,5,.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:999999;padding:20px;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:16px;padding:28px;width:440px;max-width:92vw;max-height:90vh;overflow-y:auto;position:relative;color:#222;';
  const toutesCategories = [...CATEGORIES_BIENS_BASE, ...CATEGORIES_BIENS_CUSTOM];
  box.innerHTML = `
    <button id="bien-close" style="position:absolute;top:14px;right:16px;background:none;border:none;font-size:20px;cursor:pointer;color:#888;">✕</button>
    <h3 style="font-family:var(--font-display);font-size:20px;margin-bottom:18px;color:#173a24;">${bien ? '✏️ Modifier le bien' : '🏠 Ajouter un bien'}</h3>
    <div class="form-group"><label>Catégorie</label>
      <select id="bien_categorie">${toutesCategories.map(c => `<option value="${c}" ${bien?.categorie===c?'selected':''}>${c}</option>`).join('')}</select>
    </div>
    <div class="form-group"><label>Nom du bien</label><input type="text" id="bien_nom" value="${bien ? bien.nom.replace(/"/g,'&quot;') : ''}" placeholder="Ex: Villa Eclipse"></div>
    <div class="form-group"><label>Prix Achat ($)</label><input type="number" id="bien_prix_achat" min="0" value="${bien?.prixAchat ?? ''}"></div>
    <div class="form-group"><label>Prix Location / semaine ($)</label><input type="number" id="bien_prix_loc" min="0" value="${bien?.prixLoc ?? ''}"></div>
    <div class="form-group"><label>Coffre (kg)</label><input type="number" id="bien_coffre" min="0" value="${bien?.coffre ?? ''}"></div>
    <div class="form-group"><label>Zone(s) de cohérence</label>
      <div id="bien_zones" style="max-height:160px;overflow-y:auto;border:1px solid #ddd;border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:6px;">
        ${ZONES_COHERENCE.length ? ZONES_COHERENCE.map(z => `
          <label style="display:flex;align-items:center;gap:8px;font-weight:400;font-size:13px;margin:0;padding:0;">
            <input type="checkbox" value="${z}" style="width:auto;margin:0;" ${bien?.zones?.includes(z) ? 'checked' : ''}>
            ${z}
          </label>`).join('') : '<p style="color:#aaa;font-size:12px;margin:0;">Aucune zone créée pour l\'instant — crée-en une via "🗺️ Gérer les zones" dans Config.</p>'}
      </div>
    </div>
        <div class="form-group"><label>Média</label>
      <div class="tabs-toggle" id="bienMediaTabs">
        <button type="button" class="active" data-media="photo" onclick="switchBienMediaType('photo')">📸 Photo</button>
        <button type="button" data-media="video" onclick="switchBienMediaType('video')">🎬 Vidéo</button>
      </div>
      <div id="bienMediaPhotoFields">
        <input type="file" id="bien_photos" accept="image/*" multiple>
        <div id="bienPhotosPreview" class="photo-upload-preview"></div>
      </div>
      <div id="bienMediaVideoFields" style="display:none;">
        <input type="url" id="bien_video_url" placeholder="https://youtube.com/...">
      </div>
    </div>
    <button id="bien-save" class="btn-submit-vente">💾 Enregistrer</button>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const close = () => document.body.removeChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  box.querySelector('#bien-close').onclick = close;

  function renderPreview() {
    const wrap = box.querySelector('#bienPhotosPreview');
    const apercus = [...imagesExistantes.map(url => vignette(url, 120, 120)), ...nouveauxFichiers.map(f => URL.createObjectURL(f))];
    wrap.innerHTML = apercus.length === 0
      ? `<p class="photo-upload-empty">Aucune photo sélectionnée</p>`
      : apercus.map((src, i) => `
        <div class="photo-thumb ${i===0?'principale':''}">
          <img src="${src}" loading="lazy">
          <button type="button" class="remove-photo" data-i="${i}">✕</button>
        </div>`).join('');
    wrap.querySelectorAll('.remove-photo').forEach(btn => {
      btn.onclick = () => {
        const i = Number(btn.dataset.i);
        if (i < imagesExistantes.length) imagesExistantes.splice(i, 1);
        else nouveauxFichiers.splice(i - imagesExistantes.length, 1);
        renderPreview();
      };
    });
  }
  box.querySelector('#bien_photos').addEventListener('change', e => {
    nouveauxFichiers.push(...Array.from(e.target.files));
    renderPreview();
    e.target.value = '';
  });
  box.querySelector('#bien_prix_achat').addEventListener('input', () => {
    const prixAchat = Number(box.querySelector('#bien_prix_achat').value) || 0;
    box.querySelector('#bien_prix_loc').value = Math.round(prixAchat * 0.05);
  });
  renderPreview();

    box.querySelector('#bien-save').onclick = async () => {
    const nom = box.querySelector('#bien_nom').value.trim();
    const categorie = box.querySelector('#bien_categorie').value;
    const prixAchat = Number(box.querySelector('#bien_prix_achat').value) || 0;
    const prixLoc = Number(box.querySelector('#bien_prix_loc').value) || 0;
    const coffre = Number(box.querySelector('#bien_coffre').value) || 0;
    const zones = [...box.querySelectorAll('#bien_zones input:checked')].map(cb => cb.value);

    if (!nom) { alert('Le nom est requis.'); return; }
    if (imagesExistantes.length + nouveauxFichiers.length === 0) { alert('Ajoute au moins une photo.'); return; }

    const saveBtn = box.querySelector('#bien-save');
    saveBtn.disabled = true; saveBtn.textContent = 'Envoi...';

    try {
      let nouvellesUrls = [];
      if (nouveauxFichiers.length > 0) nouvellesUrls = await uploaderPhotos(nouveauxFichiers);
      const images = [...imagesExistantes, ...nouvellesUrls];

      if (bien) {
        const res = await fetch(`${SERVER_URL}/api/biens/${bien.id}`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nom, categorie, prixAchat, prixLoc, coffre, images, zones })
        });
        if (!res.ok) throw new Error('Échec de la modification');
        Object.assign(bien, { nom, categorie, prixAchat, prixLoc, coffre, images, zones });
      } else {
        const res = await fetch(`${SERVER_URL}/api/biens`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nom, categorie, prixAchat, prixLoc, coffre, images, zones })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Échec de l\'ajout');
        BIENS_DYNAMIQUES.push(data);
      }
      document.getElementById('cfgBiensDesc').textContent = `${BIENS_DYNAMIQUES.length} bien(s) dynamique(s) enregistré(s).`;
      genererCfgKpis();
      const videoUrl = box.querySelector('#bien_video_url').value.trim();
      if (videoUrl) {
        try {
          await fetch(`${SERVER_URL}/api/biens-videos`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bien: nom, nom: 'Vidéo de présentation', url: videoUrl, type: 'video' })
          });
        } catch (e) { console.error('Erreur ajout vidéo bien:', e); }
      }
      close();
      alert(`✅ Bien "${nom}" ${bien ? 'modifié' : 'ajouté'}.`);
    } catch (e) {
      alert(`❌ ${e.message}`);
      saveBtn.disabled = false; saveBtn.textContent = '💾 Enregistrer';
    }
  };
}

function ouvrirGestionBiens(mode) {
  if (BIENS_DYNAMIQUES.length === 0) { alert("Aucun bien dynamique enregistré. Ajoute-en un d'abord."); return; }
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,10,5,.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:999999;padding:20px;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:16px;padding:26px;width:640px;max-width:94vw;max-height:88vh;overflow-y:auto;position:relative;color:#222;';
  box.innerHTML = `
    <button id="gb-close" style="position:absolute;top:14px;right:16px;background:none;border:none;font-size:20px;cursor:pointer;color:#888;">✕</button>
    <h3 style="font-family:var(--font-display);font-size:19px;margin-bottom:6px;color:#173a24;">${mode === 'modifier' ? '✏️ Modifier un bien' : '🗑️ Supprimer des biens'}</h3>
    <p style="font-size:12px;color:#888;margin-bottom:16px;">${mode === 'modifier' ? 'Clique sur un bien pour le modifier.' : 'Clique sur la croix pour supprimer définitivement.'}</p>
    <div id="gb-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;"></div>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => document.body.removeChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  box.querySelector('#gb-close').onclick = close;

  function render() {
    box.querySelector('#gb-grid').innerHTML = BIENS_DYNAMIQUES.map(b => `
      <div style="position:relative;border:1px solid #eee;border-radius:10px;overflow:hidden;cursor:pointer;" data-id="${b.id}">
        ${mode === 'supprimer' ? `<button data-del="${b.id}" style="position:absolute;top:6px;right:6px;z-index:2;width:24px;height:24px;border-radius:50%;border:none;background:rgba(0,0,0,.6);color:#fff;font-size:12px;cursor:pointer;">✕</button>` : ''}
        <img src="${vignette(b.images[0], 300, 180)}" loading="lazy" style="width:100%;height:90px;object-fit:cover;display:block;background:#f0f0ec;" onerror="this.src='assets/placeholder.png'">
        <div style="padding:8px;"><div style="font-size:12px;font-weight:600;">${b.nom}</div><div style="font-size:10px;color:#888;">${b.categorie}</div></div>
      </div>`).join('');

    if (mode === 'modifier') {
      box.querySelectorAll('[data-id]').forEach(card => {
        card.onclick = () => { close(); ouvrirFormBien(Number(card.dataset.id)); };
      });
    } else {
      box.querySelectorAll('[data-del]').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const id = Number(btn.dataset.del);
          const b = BIENS_DYNAMIQUES.find(x => x.id === id);
          if (!confirm(`Supprimer "${b.nom}" ?`)) return;
          try {
            const res = await fetch(`${SERVER_URL}/api/biens/${id}`, { method: 'DELETE', credentials: 'include' });
            if (!res.ok) throw new Error('Échec');
            BIENS_DYNAMIQUES = BIENS_DYNAMIQUES.filter(x => x.id !== id);
            document.getElementById('cfgBiensDesc').textContent = `${BIENS_DYNAMIQUES.length} bien(s) dynamique(s) enregistré(s).`;
            genererCfgKpis();
            if (BIENS_DYNAMIQUES.length === 0) { close(); return; }
            render();
          } catch (err) { alert('❌ Impossible de supprimer ce bien.'); }
        };
      });
    }
  }
  render();
}

// ================================================================
//  CONFIG AGENCE — CATÉGORIES ET ZONES
// ================================================================
function ouvrirGestionCategoriesPreview() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,10,5,.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:999999;padding:20px;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:16px;padding:26px;width:400px;max-width:92vw;color:#222;';
  box.innerHTML = `
    <h3 style="font-family:var(--font-display);font-size:19px;margin-bottom:6px;color:#173a24;">🗂️ Catégories de biens</h3>
    <p style="font-size:12px;color:#888;margin-bottom:14px;">Les catégories de base ne peuvent pas être supprimées.</p>
    <div style="display:flex;gap:8px;margin-bottom:14px;">
      <input type="text" id="cat-nouveau" placeholder="Nouvelle catégorie" style="flex:1;margin:0;">
      <button id="cat-add" class="btn-submit-vente" style="width:auto;margin:0;padding:11px 16px;">+ Ajouter</button>
    </div>
    <div id="cat-liste" style="display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto;"></div>
    <button id="cat-close" style="margin-top:16px;width:100%;padding:10px;border:1px solid #ddd;background:#fff;border-radius:8px;cursor:pointer;">Fermer</button>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => document.body.removeChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  box.querySelector('#cat-close').onclick = close;

  function render() {
    box.querySelector('#cat-liste').innerHTML = [
      ...CATEGORIES_BIENS_BASE.map(c => `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:#f7f7f5;border-radius:6px;"><span style="font-size:13px;font-weight:600;">${c}</span><span style="font-size:10px;color:#aaa;">base</span></div>`),
      ...CATEGORIES_BIENS_CUSTOM.map(c => `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:#f7f7f5;border-radius:6px;"><span style="font-size:13px;font-weight:600;">${c}</span><button data-cat="${c}" style="color:#e0685f;font-size:12px;background:none;border:none;cursor:pointer;">Supprimer</button></div>`)
    ].join('');
    box.querySelectorAll('[data-cat]').forEach(btn => {
      btn.onclick = async () => {
        try {
          const res = await fetch(`${SERVER_URL}/api/config/categories/${encodeURIComponent(btn.dataset.cat)}`, { method: 'DELETE', credentials: 'include' });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          CATEGORIES_BIENS_CUSTOM = data.custom;
          render();
        } catch (e) { alert(`❌ ${e.message}`); }
      };
    });
  }
  box.querySelector('#cat-add').onclick = async () => {
    const nom = box.querySelector('#cat-nouveau').value.trim();
    if (!nom) return;
    try {
      const res = await fetch(`${SERVER_URL}/api/config/categories`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nom })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      CATEGORIES_BIENS_CUSTOM = data.custom;
      box.querySelector('#cat-nouveau').value = '';
      render();
    } catch (e) { alert(`❌ ${e.message}`); }
  };
  render();
}

function ouvrirGestionZonesPreview() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,10,5,.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:999999;padding:20px;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:16px;padding:26px;width:460px;max-width:92vw;max-height:86vh;overflow-y:auto;color:#222;';
  box.innerHTML = `
    <h3 style="font-family:var(--font-display);font-size:19px;margin-bottom:6px;color:#173a24;">🗺️ Zones de cohérence</h3>
    <div style="display:flex;gap:8px;margin-bottom:12px;">
      <input type="text" id="gz-nouvelle-zone" placeholder="Nouvelle zone" style="flex:1;margin:0;">
      <button id="gz-add-zone" class="btn-submit-vente" style="width:auto;margin:0;padding:11px 16px;">+ Créer</button>
    </div>
    <div class="form-group"><label>Zone à modifier</label>
      <select id="gz-zone">${ZONES_COHERENCE.map(z => `<option>${z}</option>`).join('')}</select>
    </div>
    <p style="font-size:12px;color:#888;margin:6px 0 12px;">Coche les biens dynamiques appartenant à cette zone.</p>
    <div id="gz-liste" style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto;border:1px solid #eee;border-radius:8px;padding:10px;"></div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">
      <button id="gz-close" style="padding:10px 18px;border:1px solid #ddd;background:#fff;border-radius:8px;cursor:pointer;">Fermer</button>
      <button id="gz-save" class="btn-submit-vente" style="width:auto;margin:0;">💾 Enregistrer</button>
    </div>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => document.body.removeChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  box.querySelector('#gz-close').onclick = close;

  function render() {
    const zone = box.querySelector('#gz-zone').value;
    box.querySelector('#gz-liste').innerHTML = BIENS_DYNAMIQUES.length === 0
      ? `<p style="color:#aaa;font-size:12px;">Aucun bien dynamique enregistré.</p>`
      : BIENS_DYNAMIQUES.map(b => `
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;">
          <input type="checkbox" value="${b.id}" ${(b.zones||[]).includes(zone) ? 'checked' : ''}> ${b.nom}
        </label>`).join('');
  }

  box.querySelector('#gz-add-zone').onclick = async () => {
    const nom = box.querySelector('#gz-nouvelle-zone').value.trim();
    if (!nom) return;
    try {
      const res = await fetch(`${SERVER_URL}/api/config/zones`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nom })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      ZONES_COHERENCE = data.liste;
      box.querySelector('#gz-zone').innerHTML = ZONES_COHERENCE.map(z => `<option>${z}</option>`).join('');
      box.querySelector('#gz-nouvelle-zone').value = '';
      render();
    } catch (e) { alert(`❌ ${e.message}`); }
  };

  box.querySelector('#gz-zone').onchange = render;
  if (ZONES_COHERENCE.length > 0) render();

  box.querySelector('#gz-save').onclick = async () => {
    const zone = box.querySelector('#gz-zone').value;
    if (!zone) { alert('Crée d\'abord une zone.'); return; }
    const checks = Array.from(box.querySelectorAll('#gz-liste input[type=checkbox]'));

    try {
      await Promise.all(checks.map(cb => {
        const bien = BIENS_DYNAMIQUES.find(b => b.id === Number(cb.value));
        if (!bien) return Promise.resolve();
        bien.zones = bien.zones || [];
        const avait = bien.zones.includes(zone);
        if (cb.checked && !avait) bien.zones.push(zone);
        if (!cb.checked) bien.zones = bien.zones.filter(z => z !== zone);
        if (cb.checked === avait) return Promise.resolve();
        return fetch(`${SERVER_URL}/api/biens/${bien.id}`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ zones: bien.zones })
        });
      }));
      alert(`✅ Zone "${zone}" mise à jour.`);
      close();
    } catch (e) { alert('❌ Erreur lors de la mise à jour des zones.'); }
  };
}

function ouvrirEditeurVisuelInfo() {
  window.open('svg.html', 'dynasty8-editeur-zones');
}

// ================================================================
//  CONFIG AGENCE — BACKUP, EXPORTS, CLÔTURE
// ================================================================
async function declencherBackupPreview() {
  try {
    const res = await fetch(`${SERVER_URL}/api/config/backup`, { method: 'POST', credentials: 'include' });
    if (!res.ok) throw new Error('Échec du backup');
    const snapshot = await res.json();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_dynasty8_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    alert('💾 Backup généré et téléchargé.');
  } catch (e) { alert('❌ Impossible de générer le backup.'); }
}

function exporterVentesCSVPreview() {
  window.open(`${SERVER_URL}/api/export/ventes`, '_blank');
}
function exporterMembresCSVPreview() {
  window.open(`${SERVER_URL}/api/export/membres`, '_blank');
}

async function cloturerSemainePreview() {
  if (!confirm('Clôturer la semaine ? Un bilan PDF sera envoyé sur Discord avant la remise à zéro.')) return;

  try {
    await chargerJsPDF();
    await Promise.all([chargerVentes(), chargerCloture(), chargerMembres()]);
    await chargerHeuresService(); // heures de la période en cours (depuis la dernière clôture)
    const ventes = getVentesPeriodeCourante();

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setCharSpace(0);
    const W = doc.internal.pageSize.getWidth();
    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR');
    const moi = window.currentUser?.nom_rp || '?';

    const fmt = (n) => (Math.round(Number(n) || 0)).toLocaleString('fr-FR')
      .replace(/[\u202F\u00A0\u2009]/g, ' ') + ' $';
    const txt = (s) => String(s ?? '-').replace(/[^\x20-\xFF]/g, '-');
    const typeDe = (v) => v.type || v.type_transaction || '?';

    function header(titre) {
      doc.setFillColor(4, 68, 25);
      doc.rect(0, 0, W, 18, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(255, 255, 255);
      doc.text('DYNASTY 8 - BILAN DES STATISTIQUES', W / 2, 10, { align: 'center' });
      doc.setFontSize(8); doc.setTextColor(200, 220, 200);
      doc.text(`${titre} - Genere le ${dateStr} a ${now.toLocaleTimeString('fr-FR')} par ${txt(moi)}`, W / 2, 16, { align: 'center' });
    }

    function kpiBox(x, y, w, h, label, value, color) {
      doc.setFillColor(248, 249, 250); doc.roundedRect(x, y, w, h, 3, 3, 'F');
      doc.setDrawColor(220, 220, 220); doc.roundedRect(x, y, w, h, 3, 3, 'S');
      doc.setFontSize(7); doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal');
      doc.text(label, x + w / 2, y + 8, { align: 'center' });
      doc.setFontSize(14); doc.setFont('helvetica', 'bold');
      const [r, g, b] = color || [46, 125, 50];
      doc.setTextColor(r, g, b);
      doc.text(String(value), x + w / 2, y + 18, { align: 'center' });
    }

    // ---------- Calculs ----------
    const volumeTotal = ventes.reduce((a, v) => a + parseMontant(v.prix), 0);
    const commTotal   = ventes.reduce((a, v) => a + parseMontant(v.commission), 0);
    const nbAchats    = ventes.filter(v => typeDe(v) === 'Achat').length;
    const nbLocs      = ventes.filter(v => typeDe(v) === 'Location').length;

    const agentStats = {};
    ventes.forEach(v => {
      const nom = v.agent_nom || '?';
      const s = agentStats[nom] || (agentStats[nom] = { ventes: 0, achats: 0, locs: 0, volume: 0, commission: 0, meilleure: 0 });
      s.ventes++;
      if (typeDe(v) === 'Achat') s.achats++;
      if (typeDe(v) === 'Location') s.locs++;
      s.volume += parseMontant(v.prix);
      s.commission += parseMontant(v.commission);
      s.meilleure = Math.max(s.meilleure, parseMontant(v.prix));
    });
    // Agents avec heures de service mais sans vente
    Object.keys(HEURES_PAR_AGENT).forEach(nom => {
      if (!agentStats[nom]) agentStats[nom] = { ventes: 0, achats: 0, locs: 0, volume: 0, commission: 0, meilleure: 0 };
    });
    const agentsListe = Object.entries(agentStats).sort((a, b) => b[1].commission - a[1].commission || b[1].ventes - a[1].ventes);
    const topAgents = agentsListe.slice(0, 8);

    const countBiens = {};
    ventes.forEach(v => { const b = v.bien || v.bien_nom || '?'; countBiens[b] = (countBiens[b] || 0) + 1; });
    const topBiens = Object.entries(countBiens).sort((a, b) => b[1] - a[1]).slice(0, 8);

    // ---------- PAGE 1 : KPI ----------
    header('Recapitulatif de la periode');
    const kpiW = (W - 30) / 4, kpiH = 26;
    kpiBox(10,                  24, kpiW, kpiH, 'VENTES TOTALES', ventes.length, [46, 125, 50]);
    kpiBox(10 + kpiW + 5,       24, kpiW, kpiH, 'ACHATS',         nbAchats,      [13, 71, 161]);
    kpiBox(10 + (kpiW + 5) * 2, 24, kpiW, kpiH, 'LOCATIONS',      nbLocs,        [230, 81, 0]);
    kpiBox(10 + (kpiW + 5) * 3, 24, kpiW, kpiH, 'COMMISSIONS',    fmt(commTotal), [106, 27, 154]);
    kpiBox(10, 56, kpiW * 2 + 5, kpiH, 'VOLUME TOTAL', fmt(volumeTotal), [183, 28, 28]);
    const periodeDebut = VENTES_CLOTURE_DATE ? new Date(VENTES_CLOTURE_DATE).toLocaleDateString('fr-FR') : 'Debut';
    kpiBox(10 + kpiW * 2 + 10, 56, kpiW * 2 - 5, kpiH, 'PERIODE', `${periodeDebut} -> ${dateStr}`, [69, 90, 100]);

    // Classement agents (top 8)
    let y = 92;
    doc.setFillColor(4, 68, 25); doc.rect(10, y, W / 2 - 15, 8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
    doc.text('CLASSEMENT DES AGENTS', 12, y + 5.5);
    y += 10;
    doc.setFillColor(240, 240, 240); doc.rect(10, y, W / 2 - 15, 7, 'F');
    doc.setFontSize(7); doc.setTextColor(80, 80, 80);
    const colAgents = [12, 30, 70, 90];
    ['#', 'AGENT', 'VENTES', 'COMMISSION'].forEach((h, i) => doc.text(h, colAgents[i], y + 5));
    y += 8;
    topAgents.forEach(([nom, s], i) => {
      if (i % 2 === 0) { doc.setFillColor(250, 250, 250); doc.rect(10, y - 1, W / 2 - 15, 7, 'F'); }
      doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
      doc.setTextColor(60, 60, 60);
      doc.text(String(i + 1), colAgents[0], y + 4.5);
      doc.setTextColor(40, 40, 40);
      doc.text(txt(nom).substring(0, 22), colAgents[1], y + 4.5);
      doc.text(String(s.ventes), colAgents[2], y + 4.5);
      doc.setTextColor(46, 125, 50);
      doc.text(fmt(s.commission), colAgents[3], y + 4.5);
      y += 7;
    });

    // Top biens
    let y2 = 92;
    const x2 = W / 2 + 5;
    doc.setFillColor(4, 68, 25); doc.rect(x2, y2, W / 2 - 15, 8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
    doc.text('BIENS LES PLUS VENDUS', x2 + 2, y2 + 5.5);
    y2 += 10;
    doc.setFillColor(240, 240, 240); doc.rect(x2, y2, W / 2 - 15, 7, 'F');
    doc.setFontSize(7); doc.setTextColor(80, 80, 80);
    doc.text('#', x2 + 2, y2 + 5); doc.text('BIEN', x2 + 12, y2 + 5); doc.text('NB', x2 + 95, y2 + 5);
    y2 += 8;
    topBiens.forEach(([bien, count], i) => {
      if (i % 2 === 0) { doc.setFillColor(250, 250, 250); doc.rect(x2, y2 - 1, W / 2 - 15, 7, 'F'); }
      doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
      doc.setTextColor(40, 40, 40);
      doc.text(String(i + 1), x2 + 2, y2 + 4.5);
      doc.text(txt(bien).substring(0, 38), x2 + 12, y2 + 4.5);
      doc.setTextColor(46, 125, 50);
      doc.text(String(count), x2 + 95, y2 + 4.5);
      y2 += 7;
    });

    // ---------- PAGES : STATS PAR AGENT ----------
    const AG_PAR_PAGE = 22;
    const totalPagesAg = Math.max(1, Math.ceil(agentsListe.length / AG_PAR_PAGE));
    const colAg = [12, 22, 78, 98, 118, 143, 183, 223, 255];
    const entetesAg = ['#', 'AGENT', 'VENTES', 'ACHATS', 'LOC.', 'VOLUME', 'COMMISSION', 'MEILLEURE VENTE', 'SERVICE'];

    for (let p = 0; p < totalPagesAg; p++) {
      doc.addPage();
      header(`Stats par agent - Page ${p + 1} / ${totalPagesAg}`);
      let ya = 24;
      doc.setFillColor(4, 68, 25); doc.rect(10, ya, W - 20, 7, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255);
      entetesAg.forEach((h, i) => doc.text(h, colAg[i], ya + 5));
      ya += 8;

      agentsListe.slice(p * AG_PAR_PAGE, (p + 1) * AG_PAR_PAGE).forEach(([nom, s], i) => {
        const rang = p * AG_PAR_PAGE + i + 1;
        if (i % 2 === 0) { doc.setFillColor(248, 248, 248); doc.rect(10, ya - 1, W - 20, 7, 'F'); }
        doc.setFont('helvetica', rang === 1 ? 'bold' : 'normal'); doc.setFontSize(7);
        doc.setTextColor(60, 60, 60);
        doc.text(String(rang), colAg[0], ya + 4.5);
        doc.setTextColor(40, 40, 40);
        doc.text(txt(nom).substring(0, 26), colAg[1], ya + 4.5);
        doc.text(String(s.ventes), colAg[2], ya + 4.5);
        doc.setTextColor(13, 71, 161);  doc.text(String(s.achats), colAg[3], ya + 4.5);
        doc.setTextColor(230, 81, 0);   doc.text(String(s.locs),   colAg[4], ya + 4.5);
        doc.setTextColor(60, 60, 60);   doc.text(fmt(s.volume),    colAg[5], ya + 4.5);
        doc.setTextColor(46, 125, 50);  doc.text(fmt(s.commission), colAg[6], ya + 4.5);
        doc.setTextColor(60, 60, 60);   doc.text(fmt(s.meilleure), colAg[7], ya + 4.5);
        doc.setTextColor(106, 27, 154); doc.text(formatHeures(HEURES_PAR_AGENT[nom] || 0), colAg[8], ya + 4.5);
        ya += 7;
      });
    }

    // ---------- PAGES : DETAIL DES VENTES (20 / page) ----------
    const ventesTriees = [...ventes].sort((a, b) => (a.id || 0) - (b.id || 0));
    const PAR_PAGE = 20;
    const totalPages = Math.ceil(ventesTriees.length / PAR_PAGE);
    for (let p = 0; p < totalPages; p++) {
      doc.addPage();
      header(`Ventes - Page ${p + 1} / ${totalPages}`);
      const colV = [10, 30, 90, 130, 165, 200, 230];
      let yv = 24;
      doc.setFillColor(4, 68, 25); doc.rect(10, yv, W - 20, 7, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255);
      ['DATE', 'BIEN', 'TYPE', 'PRIX', 'COMMISSION', 'CLIENT', 'AGENT'].forEach((h, i) => doc.text(h, colV[i], yv + 5));
      yv += 8;
      ventesTriees.slice(p * PAR_PAGE, (p + 1) * PAR_PAGE).forEach((v, i) => {
        if (i % 2 === 0) { doc.setFillColor(248, 248, 248); doc.rect(10, yv - 1, W - 20, 7, 'F'); }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
        const type = typeDe(v);
        doc.setTextColor(60, 60, 60);
        doc.text(txt(v.date || v.dateISO), colV[0], yv + 4.5);
        doc.text(txt(v.bien || v.bien_nom).substring(0, 22), colV[1], yv + 4.5);
        doc.setTextColor(type === 'Achat' ? 13 : 230, type === 'Achat' ? 71 : 81, type === 'Achat' ? 161 : 0);
        doc.text(txt(type), colV[2], yv + 4.5);
        doc.setTextColor(60, 60, 60);
        doc.text(fmt(parseMontant(v.prix)), colV[3], yv + 4.5);
        doc.setTextColor(46, 125, 50);
        doc.text(fmt(parseMontant(v.commission)), colV[4], yv + 4.5);
        doc.setTextColor(60, 60, 60);
        doc.text(txt(v.client || v.client_nom).substring(0, 16), colV[5], yv + 4.5);
        doc.text(txt(v.agent_nom).substring(0, 14), colV[6], yv + 4.5);
        yv += 7;
      });
    }

    // ---------- Envoi Discord puis reset ----------
    const pdfBase64 = await blobToBase64(doc.output('blob'));

    const res = await fetch(`${SERVER_URL}/api/compta-webhook`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `**Close Compta - Bilan Statistiques** - ${dateStr}\n> Genere par **${txt(moi)}**`,
        pdfBase64,
        filename: `bilan_stats_dynasty8_${dateStr.replace(/\//g, '-')}.pdf`,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`❌ Envoi Discord échoué (${res.status}) : ${err.error || 'erreur inconnue'}\nClôture annulée.`);
      return;
    }

    const resetRes = await fetch(`${SERVER_URL}/api/ventes/reset`, { method: 'DELETE', credentials: 'include' });
    if (!resetRes.ok) {
      const err = await resetRes.json().catch(() => ({}));
      throw new Error(`Reset échoué (${resetRes.status}) : ${err.error || 'erreur inconnue'}`);
    }

    const inputDu = document.getElementById('statDu');
    const inputAu = document.getElementById('statAu');
    if (inputDu) { inputDu.value = ''; delete inputDu.dataset.userSet; }
    if (inputAu) { inputAu.value = ''; delete inputAu.dataset.userSet; }

    await Promise.all([chargerCloture(), chargerClotures()]);
    await genererStatistiques();
    const d = document.getElementById('cfgComptaDesc');
    if (d) d.textContent = `${VENTES_DATA.filter(estDepuisClotureVente).length} vente(s) dans la période en cours.`;
    genererCfgKpis();
    alert('🔒 Bilan envoyé et semaine clôturée.');
  } catch (e) {
    console.error(e);
    alert(`❌ Impossible de clôturer la semaine : ${e.message}`);
  }
}

// ================================================================
//  CONFIG DÉCO — STYLES, VALIDATIONS, STATS, COMMISSIONS
// ================================================================
function scrollToDecorateursTable() {
  document.getElementById('cfgDecoTableBody')?.closest('.ventes-table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let STYLES_DECO_BASE = [];
let STYLES_DECO_CUSTOM = [];

async function chargerStylesDeco() {
  try {
    const res = await fetch(`${SERVER_URL}/api/config/styles-deco`, { credentials: 'include' });
    if (res.ok) { const d = await res.json(); STYLES_DECO_BASE = d.base; STYLES_DECO_CUSTOM = d.custom; }
  } catch (e) { console.error('Erreur chargement styles déco:', e); }
}

function toutesStylesDeco() {
  return [...STYLES_DECO_BASE, ...STYLES_DECO_CUSTOM];
}

function genererStylesDecoSelects() {
  const styles = toutesStylesDeco();

  const filtreStyle = document.getElementById('decoFilterStyle');
  if (filtreStyle) {
    const val = filtreStyle.value;
    filtreStyle.innerHTML = `<option value="tous">Tous les styles</option>` +
      styles.map(s => `<option value="${s}">${s}</option>`).join('');
    if (styles.includes(val)) filtreStyle.value = val;
  }

  const decoStyleSelect = document.getElementById('deco_style');
  if (decoStyleSelect) {
    const val = decoStyleSelect.value;
    decoStyleSelect.innerHTML = `<option value="">-- Sélectionner --</option>` +
      styles.map(s => `<option value="${s}">${s}</option>`).join('');
    if (styles.includes(val)) decoStyleSelect.value = val;
  }

  const checkboxesWrap = document.querySelector('.deco-styles-checkboxes');
  if (checkboxesWrap) {
    checkboxesWrap.innerHTML = styles.map(s => `
      <label class="checkbox-item">
        <input type="checkbox" value="${s}" class="meDecoStyle"> ${s}
      </label>
    `).join('');
  }
}

function ouvrirGestionStylesDeco() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,10,5,.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:999999;padding:20px;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:16px;padding:26px;width:400px;max-width:92vw;color:#222;';
  box.innerHTML = `
    <h3 style="font-family:var(--font-display);font-size:19px;margin-bottom:14px;color:#173a24;">🎨 Styles de décoration</h3>
    <div style="display:flex;gap:8px;margin-bottom:14px;">
      <input type="text" id="style-nouveau" placeholder="Nouveau style" style="flex:1;margin:0;">
      <button id="style-add" class="btn-submit-vente" style="width:auto;margin:0;padding:11px 16px;">+ Ajouter</button>
    </div>
    <div id="style-liste" style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto;"></div>
    <button id="style-close" style="margin-top:16px;width:100%;padding:10px;border:1px solid #ddd;background:#fff;border-radius:8px;cursor:pointer;">Fermer</button>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => {
    document.body.removeChild(overlay);
    document.getElementById('cfgDecoStylesDesc').textContent = `${STYLES_DECO_BASE.length + STYLES_DECO_CUSTOM.length} style(s) disponible(s).`;
    genererStylesDecoSelects();
  };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  box.querySelector('#style-close').onclick = close;

  function render() {
    box.querySelector('#style-liste').innerHTML = [
      ...STYLES_DECO_BASE.map(s => `<div style="padding:7px 10px;background:#f7f7f5;border-radius:6px;font-size:13px;font-weight:600;">${s} <span style="font-size:10px;color:#aaa;float:right;">base</span></div>`),
      ...STYLES_DECO_CUSTOM.map(s => `<div style="display:flex;justify-content:space-between;padding:7px 10px;background:#f7f7f5;border-radius:6px;font-size:13px;font-weight:600;">${s}<button data-style="${s}" style="color:#e0685f;font-size:12px;background:none;border:none;cursor:pointer;">Supprimer</button></div>`)
    ].join('');
    box.querySelectorAll('[data-style]').forEach(btn => {
      btn.onclick = async () => {
        try {
          const res = await fetch(`${SERVER_URL}/api/config/styles-deco/${encodeURIComponent(btn.dataset.style)}`, { method: 'DELETE', credentials: 'include' });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          STYLES_DECO_CUSTOM = data.custom;
          render();
        } catch (e) { alert(`❌ ${e.message}`); }
      };
    });
  }
  box.querySelector('#style-add').onclick = async () => {
    const nom = box.querySelector('#style-nouveau').value.trim();
    if (!nom) return;
    try {
      const res = await fetch(`${SERVER_URL}/api/config/styles-deco`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nom })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      STYLES_DECO_CUSTOM = data.custom;
      box.querySelector('#style-nouveau').value = '';
      render();
    } catch (e) { alert(`❌ ${e.message}`); }
  };
  render();
}

async function afficherValidationsDeco() {
  try {
    const res = await fetch(`${SERVER_URL}/api/config/validations-deco`, { credentials: 'include' });
    if (!res.ok) throw new Error('Échec');
    const enAttente = await res.json();
    if (enAttente.length === 0) { alert('✅ Aucune décoration en attente de validation.'); return; }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,10,5,.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:999999;padding:20px;';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:16px;padding:26px;width:500px;max-width:94vw;max-height:88vh;overflow-y:auto;color:#222;';
    box.innerHTML = `<h3 style="font-family:var(--font-display);font-size:19px;margin-bottom:14px;color:#173a24;">📋 Décorations en attente (${enAttente.length})</h3>
      <div id="val-liste" style="display:flex;flex-direction:column;gap:10px;"></div>
      <button id="val-close" style="margin-top:16px;width:100%;padding:10px;border:1px solid #ddd;background:#fff;border-radius:8px;cursor:pointer;">Fermer</button>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const close = () => document.body.removeChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    box.querySelector('#val-close').onclick = close;

    function render(liste) {
      box.querySelector('#val-liste').innerHTML = liste.map(d => `
        <div style="display:flex;gap:10px;align-items:center;border:1px solid #eee;border-radius:8px;padding:8px;">
          <img src="${vignette(d.photos[0], 80, 80)}" loading="lazy" style="width:50px;height:50px;object-fit:cover;border-radius:6px;">
          <div style="flex:1;">
            <div style="font-weight:600;font-size:13px;">${d.nom}</div>
            <div style="font-size:11px;color:#888;">${d.decorateurNom}</div>
          </div>
          <button data-valider="${d.decorateurId}:${d.id}" style="background:#2ecc71;color:#fff;border:none;border-radius:6px;padding:6px 10px;font-size:11px;cursor:pointer;">✅ Valider</button>
        </div>`).join('');
      box.querySelectorAll('[data-valider]').forEach(btn => {
        btn.onclick = async () => {
          const [decorateurId, decoId] = btn.dataset.valider.split(':');
          try {
            const res = await fetch(`${SERVER_URL}/api/config/validations-deco/${decorateurId}/${decoId}`, {
              method: 'PATCH', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ valide: true })
            });
            if (!res.ok) throw new Error('Échec');
            const nouvelleListe = liste.filter(d => !(String(d.decorateurId) === decorateurId && String(d.id) === decoId));
            liste = nouvelleListe;
            if (liste.length === 0) close(); else render(liste);
          } catch (e) { alert('❌ Impossible de valider cette décoration.'); }
        };
      });
    }
    render(enAttente);
  } catch (e) { alert('❌ Impossible de charger les validations.'); }
}

async function afficherStatsDeco() {
  try {
    const res = await fetch(`${SERVER_URL}/api/config/stats-deco`, { credentials: 'include' });
    if (!res.ok) throw new Error('Échec');
    const s = await res.json();
    alert(`📊 Statistiques décoration\n\nDécorateurs : ${s.totalDecorateurs}\nDécorations totales : ${s.totalDecorations}\nDécorateur le plus actif : ${s.decorateurTopActif ? s.decorateurTopActif.nom_rp + ' (' + s.decorateurTopActif.nbDecos + ')' : '—'}\nStyle le plus utilisé : ${s.styleTop ? s.styleTop.style : '—'}\nEn attente de validation : ${s.enAttenteValidation}`);
  } catch (e) { alert('❌ Impossible de charger les statistiques.'); }
}

async function ouvrirGestionCommissionsDeco() {
  let tauxActuel = 15;
  try {
    const res = await fetch(`${SERVER_URL}/api/config/commission-deco`, { credentials: 'include' });
    if (res.ok) tauxActuel = (await res.json()).taux;
  } catch (e) {}

  const valeur = prompt('Taux de commission décorateur (%) :', tauxActuel);
  if (valeur === null) return;
  const n = Number(valeur);
  if (isNaN(n) || n < 0 || n > 100) { alert('Valeur invalide.'); return; }

  try {
    const res = await fetch(`${SERVER_URL}/api/config/commission-deco`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taux: n })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    alert(`✅ Taux de commission décorateur fixé à ${n}%.`);
  } catch (e) { alert(`❌ ${e.message}`); }
}

let CFG_DECO_BLACKLIST = [];

async function chargerBlacklistDeco() {
  try {
    const res = await fetch(`${SERVER_URL}/api/blacklist-deco`, { credentials: 'include' });
    if (res.ok) CFG_DECO_BLACKLIST = await res.json();
  } catch (e) { console.error('Erreur chargement blacklist déco:', e); }
}

function openDecoBlacklistModal() { document.getElementById('decoBlacklistModalOverlay').classList.add('open'); }
function closeDecoBlacklistModal() { document.getElementById('decoBlacklistModalOverlay').classList.remove('open'); }
function closeDecoBlacklistModalOutside(event) { if (event.target.id === 'decoBlacklistModalOverlay') closeDecoBlacklistModal(); }

async function submitDecoBlacklistForm(event) {
  event.preventDefault();
  const nom = document.getElementById('bl_deco_nom').value.trim();
  const semaines = Number(document.getElementById('bl_deco_semaines').value) || 4;
  const raison = document.getElementById('bl_deco_raison').value.trim();

  try {
    const res = await fetch(`${SERVER_URL}/api/blacklist-deco`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom, semaines, raison })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    CFG_DECO_BLACKLIST.push(data);
    document.getElementById('cfgDecoBlacklistDesc').textContent = `${CFG_DECO_BLACKLIST.length} décorateur(s) blacklisté(s).`;
    genererCfgDecoBlacklistTable();
    closeDecoBlacklistModal();
    event.target.reset();
    alert('✅ Décorateur blacklisté !');
  } catch (e) { alert(`❌ ${e.message}`); }
  return false;
}

function genererCfgDecoBlacklistTable() {
  const tbody = document.getElementById('cfgDecoBlacklistTableBody');
  if (!tbody) return;
  tbody.innerHTML = CFG_DECO_BLACKLIST.length === 0
    ? `<tr><td colspan="4" class="ventes-empty">Aucune blacklist active</td></tr>`
    : CFG_DECO_BLACKLIST.map(b => `
      <tr>
        <td>${b.nom}</td>
        <td style="color:var(--ink-faint);">${b.raison || '-'}</td>
        <td style="color:var(--ink-faint);">${b.fin}</td>
        <td><button class="btn-supprimer" onclick="retirerBlacklistDecoPreview(${b.id})">Retirer</button></td>
      </tr>`).join('');
}
async function retirerBlacklistDecoPreview(id) {
  if (!confirm('Retirer cette blacklist ?')) return;
  try {
    const res = await fetch(`${SERVER_URL}/api/blacklist-deco/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) throw new Error('Échec');
    CFG_DECO_BLACKLIST = CFG_DECO_BLACKLIST.filter(b => b.id !== id);
    document.getElementById('cfgDecoBlacklistDesc').textContent = `${CFG_DECO_BLACKLIST.length} décorateur(s) blacklisté(s).`;
    genererCfgDecoBlacklistTable();
  } catch (e) { alert('❌ Impossible de retirer cette blacklist.'); }
}

// ================================================================
//  DONNÉES DÉCORATEURS
// ================================================================
let DECORATEURS_DATA = [];
let _currentDecoLoggedIn = null;
let _decoMediaType = 'photo';
function switchDecoMediaType(type) {
  _decoMediaType = type;
  document.querySelectorAll('#decoMediaTabs button').forEach(b => b.classList.toggle('active', b.dataset.media === type));
  document.getElementById('decoMediaPhotoFields').style.display = type === 'photo' ? 'block' : 'none';
  document.getElementById('decoMediaVideoFields').style.display = type === 'video' ? 'block' : 'none';
}
let _decoAddEditId = null;
let _decoNouvellesPhotos = [];
let _decoPhotosExistantes = [];

// ================================================================
//  PAGE DÉCORATEURS — liste complète
// ================================================================
let _decoListPagination = { page: 1, parPage: 12, options: [12, 24, 48] };


function genererPageDecorateurs() {
  const grid = document.getElementById('decoListGrid');
  if (!grid) return;

  const filtre = (document.getElementById('decoFilterOfficial')?.value || 'tous');
  const styleFiltre = (document.getElementById('decoFilterStyle')?.value || 'tous');
  const recherche = (document.getElementById('decoSearch')?.value || '').toLowerCase();

  let liste = DECORATEURS_DATA;

  if (filtre !== 'tous') {
    liste = liste.filter(d =>
      (filtre === 'officiel' && d.officiel) ||
      (filtre === 'independant' && !d.officiel)
    );
  }

  if (styleFiltre !== 'tous') liste = liste.filter(d => (d.styles || []).includes(styleFiltre));

  if (recherche) {
    liste = liste.filter(d =>
      d.nom_rp.toLowerCase().includes(recherche) ||
      (d.description || '').toLowerCase().includes(recherche)
    );
  }

  assurerConteneurPagination('paginationDecoList', 'decoListGrid');
  const { pageListe, totalPages } = paginerListe(liste, _decoListPagination);

  if (liste.length === 0) {
    grid.innerHTML = `<p class="deco-list-empty">Aucun décorateur ne correspond à votre recherche.</p>`;
    renderBoutonsPagination('paginationDecoList', _decoListPagination, 1, 'allerPageDecoList');
    return;
  }

  grid.innerHTML = pageListe.map(d => `
    <div class="deco-list-card" style="cursor:pointer;" onclick="ouvrirFicheDecorateur(${d.id})">
      <div class="deco-list-pp" style="background-image:url('${vignette(d.photo, 320, 320)}');width:90px;height:90px;border-radius:50%;background-size:cover;background-position:center;margin:0 auto 12px;"></div>
      <h4 style="text-align:center;">${escapeHtml(d.nom_rp)}</h4>
      <div style="text-align:center;margin-bottom:8px;">
        ${d.officiel
          ? '<span class="deco-official-badge">✅ Officiel</span>'
          : '<span style="color:var(--ink-faint);font-size:12px;">Indépendant</span>'}
      </div>
      <p style="font-size:12px;opacity:.8;text-align:center;">${escapeHtml((d.description || '').substring(0, 100))}${(d.description || '').length > 100 ? '…' : ''}</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin:10px 0;">
        ${(d.styles || []).map(s => `<span class="zone-chip">${escapeHtml(s)}</span>`).join('')}
      </div>
      <div style="font-size:11px;text-align:center;opacity:.7;">🎬 ${d.decos?.length || 0} décoration(s)</div>
    </div>
  `).join('');

  renderBoutonsPagination('paginationDecoList', _decoListPagination, totalPages, 'allerPageDecoList');
}

function allerPageDecoList(p) { _decoListPagination.page = p; genererPageDecorateurs(); }
function changerParPageDecoList(v) { _decoListPagination.parPage = v; _decoListPagination.page = 1; genererPageDecorateurs(); }
function filtrerPageDecorateurs() { _decoListPagination.page = 1; genererPageDecorateurs(); }

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('decoFilterOfficial')?.addEventListener('change', filtrerPageDecorateurs);
  document.getElementById('decoFilterStyle')?.addEventListener('change', filtrerPageDecorateurs);
  document.getElementById('decoSearch')?.addEventListener('input', filtrerPageDecorateurs);
});

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('decoFilterOfficial')?.addEventListener('change', genererPageDecorateurs);
  document.getElementById('decoFilterStyle')?.addEventListener('change', genererPageDecorateurs);
  document.getElementById('decoSearch')?.addEventListener('input', genererPageDecorateurs);
});

// ================================================================
//  ACCUEIL DÉCO — dernières décorations ajoutées
// ================================================================
function genererDerniereDecos() {
  const grid = document.getElementById('derniereDecosGrid');
  if (!grid) return;

  const toISO = (dmy) => { const [d, m, y] = dmy.split('/'); return `${y}-${m}-${d}`; };
  const toutes = DECORATEURS_DATA.flatMap(d =>
    (d.decos || []).map(deco => ({ ...deco, decorateur: d.nom_rp, officiel: d.officiel, decorateurId: d.id }))
  ).sort((a, b) => toISO(b.date).localeCompare(toISO(a.date)));

  const dernieres = toutes.slice(0, 4);

  if (dernieres.length === 0) {
    grid.innerHTML = `<p class="deco-list-empty">Aucune décoration ajoutée pour le moment.</p>`;
    return;
  }

  grid.innerHTML = dernieres.map((d, i) => `
    <div class="deco-mes-decos-card" id="derniere-deco-${i}" style="cursor:pointer;" onclick="ouvrirZoomDeco(${d.decorateurId}, ${d.id})">
      <div class="deco-mes-decos-media">
        <img src="${vignette(vignetteDeco(d), 400, 260) || 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=400&q=60'}" loading="lazy" alt="${d.nom}">
        <div class="deco-mes-decos-badge">${(d.type || 'photo').toUpperCase()}</div>
      </div>
      <div class="deco-mes-decos-body">
        <h4>${d.nom}</h4>
        <div class="deco-mes-decos-meta">
          <span>${d.officiel ? '✅' : '🎨'} ${d.decorateur}</span>
          <span>📅 ${d.date}</span>
        </div>
      </div>
    </div>
  `).join('');

  dernieres.forEach(async (d, i) => {
    if (d.type !== 'video' || !d.video_url) return;
    const thumb = await fetchYoutubeThumb(d.video_url);
    if (!thumb) return;
    const img = document.querySelector(`#derniere-deco-${i} .deco-mes-decos-media img`);
    if (img) img.src = thumb;
  });
}

async function ouvrirZoomDeco(decorateurId, decoId, depuisFiche = false) {
  const decorateur = DECORATEURS_DATA.find(x => x.id === decorateurId);
  const d = decorateur?.decos?.find(x => x.id === decoId);
  if (!decorateur || !d) return;

  const estVideo = d.type === 'video';
  const photos = estVideo ? [] : (d.photos || []);
  const bien = BIENS_DYNAMIQUES.find(b => b.nom === d.bien);
  const cle = `${decorateurId}-${decoId}`;
  _bienZoomState = { images: photos, index: 0 };

  const imgInitiale = estVideo ? 'assets/placeholder.png' : (vignette(photos[0], 900, 600) || 'assets/placeholder.png');

  const nav = photos.length > 1 ? `
    <button class="enchere-zoom-nav prev" onclick="event.stopPropagation(); naviguerZoomPhotoBien(-1)">‹</button>
    <button class="enchere-zoom-nav next" onclick="event.stopPropagation(); naviguerZoomPhotoBien(1)">›</button>
    <div class="enchere-zoom-dots" id="bienZoomDots">${photos.map((_, i) => `<span class="dot ${i === 0 ? 'active' : ''}"></span>`).join('')}</div>` : '';

  const lecteurVideo = (estVideo && d.video_url) ? `
    <a href="${escapeHtml(d.video_url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()"
       style="position:absolute;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;font-size:54px;color:#fff;text-decoration:none;background:rgba(0,0,0,.25);">▶</a>` : '';

  // Fiche complète pour staff / le décorateur lui-même, sinon profil public
  const actionDecorateur = `if(!document.body.classList.contains('mode-deco')) setMode('deco'); ouvrirFicheDecorateur(${decorateur.id})`;

  const overlay = document.getElementById('bienZoomOverlay');
  overlay.innerHTML = `
    <div class="enchere-zoom-card" onclick="event.stopPropagation()">
      <button class="modal-close enchere-zoom-close" onclick="fermerZoomBien()">✕</button>
      <div class="enchere-zoom-media" style="position:relative;">
        <img id="bienZoomImg" data-cle="${cle}" src="${imgInitiale}" style="background:#0c2416;" onerror="this.src='assets/placeholder.png'">
        ${nav}
        ${lecteurVideo}
        <div class="enchere-zoom-title">${escapeHtml(d.nom)}</div>
      </div>
      <div class="enchere-zoom-body">
        <div class="enchere-zoom-price-row">
          <div class="enchere-zoom-pill"><span class="lbl">Décorateur</span><span class="val">${decorateur.officiel ? '✅ ' : ''}${escapeHtml(decorateur.nom_rp)}</span></div>
          <div class="enchere-zoom-pill"><span class="lbl">Ajoutée le</span><span class="val">${escapeHtml(d.date || '—')}</span></div>
          <div class="enchere-zoom-pill"><span class="lbl">Type</span><span class="val">${estVideo ? '🎬 Vidéo' : `📸 ${photos.length} photo(s)`}</span></div>
        </div>
        ${d.desc ? `<p style="margin:12px 0;font-size:13px;line-height:1.5;opacity:.85;">${escapeHtml(d.desc)}</p>` : ''}
        ${d.bien ? `<div style="font-size:12px;opacity:.7;margin-bottom:10px;">🏠 Bien décoré : <strong>${escapeHtml(d.bien)}</strong></div>` : ''}
        ${bien ? `<button class="btn-vendre-zoom" onclick="ouvrirZoomBien(${bien.id})">🏠 Voir ce bien au catalogue</button>` : ''}
        ${depuisFiche
          ? ((decorateur.decos || []).length > 1 ? `
            <div style="display:flex;gap:8px;margin-top:8px;">
              <button class="btn-vendre-zoom" style="background:transparent;border:1px solid var(--hairline);color:inherit;" onclick="naviguerDecoFiche(${decorateurId}, ${decoId}, -1)">← Précédente</button>
              <button class="btn-vendre-zoom" style="background:transparent;border:1px solid var(--hairline);color:inherit;" onclick="naviguerDecoFiche(${decorateurId}, ${decoId}, 1)">Suivante →</button>
            </div>` : '')
          : `<button class="btn-vendre-zoom" style="background:transparent;border:1px solid rgba(255,255,255,.2);color:inherit;margin-top:8px;" onclick="fermerZoomBien(); ${actionDecorateur}">🎨 Voir le décorateur</button>`}
      </div>
    </div>`;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  if (estVideo && d.video_url) {
    const thumb = await fetchYoutubeThumb(d.video_url);
    const img = document.getElementById('bienZoomImg');
    if (thumb && img && img.dataset.cle === cle) img.src = thumb;
  }
}

function naviguerDecoFiche(decorateurId, decoId, direction) {
  const decos = DECORATEURS_DATA.find(x => x.id === decorateurId)?.decos || [];
  const idx = decos.findIndex(x => x.id === decoId);
  if (idx === -1 || decos.length < 2) return;
  const suivante = decos[(idx + direction + decos.length) % decos.length];
  ouvrirZoomDeco(decorateurId, suivante.id, true);
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

let _ficheDecorateurId = null;

function allerVersPage(key) {
  ALL_PAGE_KEYS.forEach(k => {
    const pageId = (k === 'home-agence') ? 'page-agence' : (k === 'home-deco') ? 'page-deco' : `page-${k}`;
    const page = document.getElementById(pageId);
    if (page) page.style.display = 'none';
  });
  const page = document.getElementById(`page-${key}`);
  if (page) page.style.display = 'block';
  _currentPageKey = key;
  if (key === 'fiche-decorateur') genererFicheDecorateur();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function ouvrirFicheDecorateur(id) {
  if (!DECORATEURS_DATA.find(d => d.id === id)) return;
  _ficheDecorateurId = id;
  allerVersPage('fiche-decorateur');
}

function ouvrirMaPage() {
  const moi = DECORATEURS_DATA.find(d => d.discord_id === window.currentUser?.id);
  if (!moi) { alert('Enregistre d\'abord ton profil décorateur dans "Mon profil".'); return; }
  _ficheDecorateurId = moi.id;
  allerVersPage('fiche-decorateur');
}

function naviguerFicheDecorateur(direction) {
  if (!hasPermission('staff')) return;
  const liste = [...DECORATEURS_DATA].sort((a, b) => a.nom_rp.localeCompare(b.nom_rp));
  const idx = liste.findIndex(d => d.id === _ficheDecorateurId);
  if (idx === -1) return;
  _ficheDecorateurId = liste[(idx + direction + liste.length) % liste.length].id;
  genererFicheDecorateur();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function genererFicheDecorateur() {
  const container = document.getElementById('ficheDecorateurContainer');
  if (!container || !_ficheDecorateurId) return;

  const deco = DECORATEURS_DATA.find(d => d.id === _ficheDecorateurId);
  if (!deco) { container.innerHTML = '<p class="ventes-empty">Décorateur introuvable.</p>'; return; }

  const page = await recupererPageDecorateur(deco.id);
  const estMoi = deco.discord_id === window.currentUser?.id;
  const peutEditer = estMoi || hasPermission('staff');

  const p = page.presentation || {};
  const contact = page.contact || {};
  const prestations = page.prestations || [];
  const tarifs = page.tarifs || [];
  const promotions = page.promotions || [];
  const galerie = page.galerie || [];
  const categories = page.categories || [];
  const projets = page.projets || [];
  const libre = page.libre || '';

  container.innerHTML = `
    ${hasPermission('staff') ? `
    <div class="fiche-staff-nav">
      <button onclick="naviguerFicheDecorateur(-1)">← Décorateur précédent</button>
      <span>Navigation staff</span>
      <button onclick="naviguerFicheDecorateur(1)">Décorateur suivant →</button>
    </div>` : ''}

    <div class="fiche-hero">
      <div class="fiche-hero-pp" style="background-image:url('${deco.photo}')"></div>
      <div class="fiche-hero-infos">
        <h1>${p.nomEntreprise || deco.nom_rp} ${deco.officiel ? '<span class="deco-official-badge">✅ Officiel</span>' : ''}</h1>
        <p class="fiche-hero-desc">${p.description || deco.description || ''}</p>
        <div class="fiche-hero-meta">
          ${p.horaires ? `<span>🕐 ${p.horaires}</span>` : ''}
          ${p.zone ? `<span>📍 ${p.zone}</span>` : ''}
        </div>
      </div>
      ${peutEditer ? `<button class="fiche-edit-btn" onclick="editerPresentationFiche(${deco.id})">✏️ Modifier</button>` : ''}
    </div>

    <div class="fiche-section">
      <div class="fiche-section-head"><h2>🎁 Promotions</h2>${peutEditer ? `<button class="fiche-add-btn" onclick="editerItemFiche(${deco.id},'promotions')">+ Ajouter</button>` : ''}</div>
      ${promotions.length === 0 ? `<p class="ventes-empty">Aucune promotion en cours.</p>` : `
      <div class="fiche-promos-grid">
        ${promotions.map(pr => `
          <div class="fiche-promo-card">
            <h4>${pr.titre}</h4>
            <p>${pr.description || ''}</p>
            ${pr.fin ? `<span class="fiche-promo-fin">Jusqu'au ${pr.fin}</span>` : ''}
            ${peutEditer ? `<div class="fiche-item-actions"><button onclick="editerItemFiche(${deco.id},'promotions',${pr.id})">✏️</button><button onclick="supprimerItemFiche(${deco.id},'promotions',${pr.id})">🗑️</button></div>` : ''}
          </div>`).join('')}
      </div>`}
    </div>

    <div class="fiche-section">
      <div class="fiche-section-head"><h2>🧰 Prestations</h2>${peutEditer ? `<button class="fiche-add-btn" onclick="editerItemFiche(${deco.id},'prestations')">+ Ajouter</button>` : ''}</div>
      ${prestations.length === 0 ? `<p class="ventes-empty">Aucune prestation renseignée.</p>` : `
      <div class="fiche-prestations-grid">
        ${prestations.map(pr => `
          <div class="fiche-prestation-card">
            <h4>${pr.nom}</h4>
            <p>${pr.description || ''}</p>
            ${peutEditer ? `<div class="fiche-item-actions"><button onclick="editerItemFiche(${deco.id},'prestations',${pr.id})">✏️</button><button onclick="supprimerItemFiche(${deco.id},'prestations',${pr.id})">🗑️</button></div>` : ''}
          </div>`).join('')}
      </div>`}
    </div>

    <div class="fiche-section">
      <div class="fiche-section-head"><h2>💰 Tarifs</h2>${peutEditer ? `<button class="fiche-add-btn" onclick="editerItemFiche(${deco.id},'tarifs')">+ Ajouter</button>` : ''}</div>
      ${tarifs.length === 0 ? `<p class="ventes-empty">Aucun tarif renseigné.</p>` : `
      <div class="ventes-table-wrap"><table class="ventes-table"><thead><tr><th>Prestation</th><th>Prix</th><th></th></tr></thead>
      <tbody>${tarifs.map(t => `<tr><td>${t.prestation}</td><td class="prix">${t.prix}</td><td>${peutEditer ? `<div class="fiche-item-actions"><button onclick="editerItemFiche(${deco.id},'tarifs',${t.id})">✏️</button><button onclick="supprimerItemFiche(${deco.id},'tarifs',${t.id})">🗑️</button></div>` : ''}</td></tr>`).join('')}</tbody></table></div>`}
    </div>

    <div class="fiche-section">
      <div class="fiche-section-head"><h2>📋 Catalogue (par catégorie de bien)</h2></div>
      ${genererCatalogueFicheHTML(deco)}
    </div>

    <div class="fiche-section">
      <div class="fiche-section-head"><h2>🗂️ Mes catégories</h2>${peutEditer ? `<button class="fiche-add-btn" onclick="editerItemFiche(${deco.id},'categories')">+ Catégorie</button>` : ''}</div>
      ${genererMesCategoriesFicheHTML(deco, categories, peutEditer)}
    </div>

    <div class="fiche-section">
      <div class="fiche-section-head"><h2>🖼️ Galerie</h2>${peutEditer ? `<button class="fiche-add-btn" onclick="editerItemFiche(${deco.id},'galerie')">+ Ajouter une photo</button>` : ''}</div>
      ${galerie.length === 0 ? `<p class="ventes-empty">Aucune photo dans la galerie.</p>` : `
      <div class="fiche-galerie-grid">
        ${galerie.map(g => `
          <div class="fiche-galerie-item">
            <img src="${g.url}" alt="${g.legende || ''}">
            ${g.legende ? `<div class="fiche-galerie-legende">${g.legende}</div>` : ''}
            ${peutEditer ? `<div class="fiche-item-actions fiche-item-actions-overlay"><button onclick="editerItemFiche(${deco.id},'galerie',${g.id})">✏️</button><button onclick="supprimerItemFiche(${deco.id},'galerie',${g.id})">🗑️</button></div>` : ''}
          </div>`).join('')}
      </div>`}
    </div>

    <div class="fiche-section">
      <div class="fiche-section-head"><h2>🧭 Suivi de projet</h2>${peutEditer ? `<button class="fiche-add-btn" onclick="editerItemFiche(${deco.id},'projets')">+ Ajouter</button>` : ''}</div>
      ${projets.length === 0 ? `<p class="ventes-empty">Aucun projet en cours.</p>` : `
      <div class="fiche-projets-grid">
        ${projets.map(pj => `
          <div class="fiche-projet-card">
            <div class="fiche-projet-statut ${pj.statut === 'termine' ? 'termine' : 'en-cours'}">${pj.statut === 'termine' ? '✅ Terminé' : '⏳ En cours'}</div>
            <h4>${pj.nom}</h4>
            <p>${pj.desc || ''}</p>
            ${peutEditer ? `<div class="fiche-item-actions"><button onclick="editerItemFiche(${deco.id},'projets',${pj.id})">✏️</button><button onclick="supprimerItemFiche(${deco.id},'projets',${pj.id})">🗑️</button></div>` : ''}
          </div>`).join('')}
      </div>`}
    </div>

    <div class="fiche-section">
      <div class="fiche-section-head"><h2>📞 Contact</h2>${peutEditer ? `<button class="fiche-add-btn" onclick="editerContactFiche(${deco.id})">✏️ Modifier</button>` : ''}</div>
      <div class="fiche-contact-box">
        ${contact.tel ? `<p>📞 ${contact.tel}</p>` : ''}
        ${contact.adresse ? `<p>📍 ${contact.adresse}</p>` : ''}
        ${(contact.reseaux || []).map(r => `<p>🔗 <a href="${r.lien}" target="_blank" rel="noopener">${r.label}</a></p>`).join('')}
        ${!contact.tel && !contact.adresse && !(contact.reseaux || []).length ? `<p class="ventes-empty">Aucune information de contact.</p>` : ''}
      </div>
    </div>

    <div class="fiche-section">
      <div class="fiche-section-head"><h2>✨ Section libre</h2>${peutEditer ? `<button class="fiche-add-btn" onclick="editerLibreFiche(${deco.id})">✏️ Modifier</button>` : ''}</div>
      <div class="fiche-libre-box">${libre ? escapeHtml(libre).replace(/\n/g, '<br>') : '<p class="ventes-empty">Le décorateur peut écrire ce qu\'il souhaite ici.</p>'}</div>
    </div>
  `;
}

function genererCatalogueFicheHTML(deco) {
  const decos = deco.decos || [];
  if (decos.length === 0) return `<p class="ventes-empty">Aucune décoration réalisée pour le moment.</p>`;

  const categoriesBiens = [...new Set(decos.map(d => {
    const bien = BIENS_DYNAMIQUES.find(b => b.nom === d.bien);
    return bien?.categorie || 'Autres';
  }))];

  return `
    <div class="fiche-catalogue-filtre">
      <select id="ficheCatalogueFiltre" onchange="filtrerCatalogueFiche()">
        <option value="all">Toutes catégories</option>
        ${categoriesBiens.map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>
    <div id="ficheCatalogueGrid" class="fiche-cat-grid">
      ${decos.map(d => renderFicheDecoCard(d)).join('')}
    </div>`;
}

function renderFicheDecoCard(d) {
  const bien = BIENS_DYNAMIQUES.find(b => b.nom === d.bien);
  return `
    <div class="fiche-cat-card" style="cursor:pointer;" data-categorie="${bien?.categorie || 'Autres'}" onclick="ouvrirZoomDeco(${_ficheDecorateurId}, ${d.id}, true)">
      <img src="${vignetteDeco(d) || 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=400&q=60'}">
      <div class="fiche-cat-card-body">
        <h5>${d.nom}</h5>
        <p>${d.bien || ''} ${bien ? `<span class="fiche-cat-tag">${bien.categorie}</span>` : ''}</p>
      </div>
    </div>`;
}

function filtrerCatalogueFiche() {
  const val = document.getElementById('ficheCatalogueFiltre').value;
  document.querySelectorAll('#ficheCatalogueGrid .fiche-cat-card').forEach(card => {
    card.style.display = (val === 'all' || card.dataset.categorie === val) ? '' : 'none';
  });
}

function genererMesCategoriesFicheHTML(deco, categories, peutEditer) {
  if (categories.length === 0) return `<p class="ventes-empty">Aucune catégorie perso créée.</p>`;
  const decos = deco.decos || [];

  return categories.map(c => {
    const liste = decos.filter(d => d.categorie === c.nom);
    return `
      <div class="fiche-cat-group">
        <h3 class="fiche-cat-title">${c.nom} <span class="fiche-cat-count">(${liste.length})</span>
          ${peutEditer ? `<button class="fiche-item-actions-inline" onclick="supprimerItemFiche(${deco.id},'categories',${c.id})">🗑️</button>` : ''}
        </h3>
        <div class="fiche-cat-grid">
          ${liste.length === 0 ? `<p class="ventes-empty">Aucune déco dans cette catégorie.</p>` : liste.map(d => `
            <div class="fiche-cat-card">
              <img src="${vignetteDeco(d) || 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=400&q=60'}">
              <div class="fiche-cat-card-body">
                <h5>${d.nom}</h5>
                ${peutEditer ? `<select class="fiche-cat-assign" onchange="assignerCategorieDeco(${deco.id},${d.id},this.value)">
                  <option value="">Non classé</option>
                  ${categories.map(cc => `<option value="${cc.nom}" ${d.categorie === cc.nom ? 'selected' : ''}>${cc.nom}</option>`).join('')}
                </select>` : ''}
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  }).join('');
}

async function assignerCategorieDeco(decoratorId, decoId, categorie) {
  try {
    const res = await fetch(`${SERVER_URL}/api/decorateurs/${decoratorId}/decos/${decoId}/categorie`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categorie })
    });
    if (!res.ok) throw new Error('Échec');
    await chargerDecorateurs();
    genererFicheDecorateur();
  } catch (e) { alert('❌ Impossible de mettre à jour la catégorie.'); }
}

async function editerPresentationFiche(decoratorId) {
  const p = (await recupererPageDecorateur(decoratorId)).presentation || {};

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,10,5,.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:999999;padding:20px;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:16px;padding:28px;width:460px;max-width:92vw;color:#222;';
  box.innerHTML = `
    <h3 style="font-family:var(--font-display);font-size:19px;margin-bottom:16px;color:#173a24;">✏️ Présentation</h3>
    <div class="form-group"><label>Nom de l'entreprise</label><input type="text" id="pf-nom" value="${p.nomEntreprise || ''}"></div>
    <div class="form-group"><label>Description</label><textarea id="pf-desc" rows="3">${p.description || ''}</textarea></div>
    <div class="form-group"><label>Horaires</label><input type="text" id="pf-horaires" value="${p.horaires || ''}" placeholder="Ex: Lun-Ven 18h-23h"></div>
    <div class="form-group"><label>Zone d'intervention</label><input type="text" id="pf-zone" value="${p.zone || ''}" placeholder="Ex: Los Santos & Blaine County"></div>
    <button id="pf-save" class="btn-submit-vente">💾 Enregistrer</button>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => document.body.removeChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  box.querySelector('#pf-save').onclick = async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/decorateurs/${decoratorId}/page/presentation`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nomEntreprise: box.querySelector('#pf-nom').value.trim(),
          description: box.querySelector('#pf-desc').value.trim(),
          horaires: box.querySelector('#pf-horaires').value.trim(),
          zone: box.querySelector('#pf-zone').value.trim(),
        })
      });
      if (!res.ok) throw new Error('Échec');
      close();
      genererFicheDecorateur();
    } catch (e) { alert('❌ Impossible d\'enregistrer.'); }
  };
}

async function editerContactFiche(decoratorId) {
  const c = (await recupererPageDecorateur(decoratorId)).contact || {};
  const reseauxStr = (c.reseaux || []).map(r => `${r.label}|${r.lien}`).join('\n');

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,10,5,.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:999999;padding:20px;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:16px;padding:28px;width:460px;max-width:92vw;color:#222;';
  box.innerHTML = `
    <h3 style="font-family:var(--font-display);font-size:19px;margin-bottom:16px;color:#173a24;">📞 Contact</h3>
    <div class="form-group"><label>Téléphone</label><input type="text" id="cf-tel" value="${c.tel || ''}"></div>
    <div class="form-group"><label>Adresse showroom/boutique</label><input type="text" id="cf-adresse" value="${c.adresse || ''}"></div>
    <div class="form-group"><label>Réseaux (un par ligne, format "Nom|lien")</label><textarea id="cf-reseaux" rows="3" placeholder="Discord|https://discord.gg/...">${reseauxStr}</textarea></div>
    <button id="cf-save" class="btn-submit-vente">💾 Enregistrer</button>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => document.body.removeChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  box.querySelector('#cf-save').onclick = async () => {
    const reseaux = box.querySelector('#cf-reseaux').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const [label, lien] = l.split('|').map(x => x?.trim());
      return { label: label || lien, lien: lien || label };
    });
    try {
      const res = await fetch(`${SERVER_URL}/api/decorateurs/${decoratorId}/page/contact`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tel: box.querySelector('#cf-tel').value.trim(), adresse: box.querySelector('#cf-adresse').value.trim(), reseaux })
      });
      if (!res.ok) throw new Error('Échec');
      close();
      genererFicheDecorateur();
    } catch (e) { alert('❌ Impossible d\'enregistrer.'); }
  };
}

async function editerLibreFiche(decoratorId) {
  const page = await recupererPageDecorateur(decoratorId);
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,10,5,.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:999999;padding:20px;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:16px;padding:28px;width:500px;max-width:92vw;color:#222;';
  box.innerHTML = `
    <h3 style="font-family:var(--font-display);font-size:19px;margin-bottom:6px;color:#173a24;">✨ Section libre</h3>
    <p style="font-size:12px;color:#888;margin-bottom:14px;">Écris ce que tu veux ici — bio, mentions spéciales, remerciements, etc.</p>
    <div class="form-group"><textarea id="lf-texte" rows="8">${page.libre || ''}</textarea></div>
    <button id="lf-save" class="btn-submit-vente">💾 Enregistrer</button>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => document.body.removeChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  box.querySelector('#lf-save').onclick = async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/decorateurs/${decoratorId}/page/libre`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ libre: box.querySelector('#lf-texte').value })
      });
      if (!res.ok) throw new Error('Échec');
      close();
      genererFicheDecorateur();
    } catch (e) { alert('❌ Impossible d\'enregistrer.'); }
  };
}

const FICHE_LISTE_CHAMPS = {
  prestations: [ { key: 'nom', label: 'Nom de la prestation', type: 'text' }, { key: 'description', label: 'Description', type: 'textarea' } ],
  tarifs: [ { key: 'prestation', label: 'Prestation', type: 'text' }, { key: 'prix', label: 'Prix (ex: 500$ - 1500$)', type: 'text' } ],
  promotions: [ { key: 'titre', label: 'Titre', type: 'text' }, { key: 'description', label: 'Description', type: 'textarea' }, { key: 'fin', label: 'Valable jusqu\'au (optionnel)', type: 'text' } ],
  categories: [ { key: 'nom', label: 'Nom de la catégorie', type: 'text' } ],
  projets: [ { key: 'nom', label: 'Nom du projet', type: 'text' }, { key: 'statut', label: 'Statut', type: 'select', options: [['en_cours','En cours'],['termine','Terminé']] }, { key: 'desc', label: 'Description', type: 'textarea' } ],
  galerie: [ { key: 'url', label: 'Photo', type: 'photo' }, { key: 'legende', label: 'Légende (optionnel)', type: 'text' } ],
};

async function editerItemFiche(decoratorId, liste, itemId = null) {
  const champs = FICHE_LISTE_CHAMPS[liste];
  let item = {};
  if (itemId) {
    const page = await recupererPageDecorateur(decoratorId);
    item = (page[liste] || []).find(x => x.id === itemId) || {};
  }

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,10,5,.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:999999;padding:20px;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:16px;padding:28px;width:440px;max-width:92vw;max-height:88vh;overflow-y:auto;color:#222;';

  const champsHTML = champs.map(c => {
    if (c.type === 'textarea') return `<div class="form-group"><label>${c.label}</label><textarea id="if-${c.key}" rows="3">${item[c.key] || ''}</textarea></div>`;
    if (c.type === 'select') return `<div class="form-group"><label>${c.label}</label><select id="if-${c.key}">${c.options.map(([v,l]) => `<option value="${v}" ${item[c.key]===v?'selected':''}>${l}</option>`).join('')}</select></div>`;
    if (c.type === 'photo') return `<div class="form-group"><label>${c.label}</label><input type="file" id="if-${c.key}-file" accept="image/*"><div id="if-${c.key}-preview" style="margin-top:8px;">${item[c.key] ? `<img src="${item[c.key]}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;">` : ''}</div><input type="hidden" id="if-${c.key}" value="${item[c.key] || ''}"></div>`;
    return `<div class="form-group"><label>${c.label}</label><input type="text" id="if-${c.key}" value="${item[c.key] || ''}"></div>`;
  }).join('');

  box.innerHTML = `
    <h3 style="font-family:var(--font-display);font-size:19px;margin-bottom:16px;color:#173a24;">${itemId ? '✏️ Modifier' : '➕ Ajouter'}</h3>
    ${champsHTML}
    <button id="if-save" class="btn-submit-vente">💾 Enregistrer</button>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => document.body.removeChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const photoChamp = champs.find(c => c.type === 'photo');
  if (photoChamp) {
    box.querySelector(`#if-${photoChamp.key}-file`).addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const [url] = await uploaderPhotos([f]);
        box.querySelector(`#if-${photoChamp.key}`).value = url;
        box.querySelector(`#if-${photoChamp.key}-preview`).innerHTML = `<img src="${url}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;">`;
      } catch (err) { alert("❌ Erreur lors de l'upload."); }
    });
  }

  box.querySelector('#if-save').onclick = async () => {
    const payload = {};
    champs.forEach(c => {
      const el = box.querySelector(`#if-${c.key}`);
      payload[c.key] = typeof el.value === 'string' ? el.value.trim() : el.value;
    });
    if (photoChamp && !payload[photoChamp.key]) { alert('Ajoute une photo.'); return; }

    try {
      const url = itemId
        ? `${SERVER_URL}/api/decorateurs/${decoratorId}/page/${liste}/${itemId}`
        : `${SERVER_URL}/api/decorateurs/${decoratorId}/page/${liste}`;
      const res = await fetch(url, {
        method: itemId ? 'PATCH' : 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Échec');
      close();
      genererFicheDecorateur();
    } catch (e) { alert('❌ Impossible d\'enregistrer.'); }
  };
}

async function supprimerItemFiche(decoratorId, liste, itemId) {
  if (!confirm('Supprimer cet élément ?')) return;
  try {
    const res = await fetch(`${SERVER_URL}/api/decorateurs/${decoratorId}/page/${liste}/${itemId}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) throw new Error('Échec');
    genererFicheDecorateur();
  } catch (e) { alert('❌ Impossible de supprimer.'); }
}

async function recupererPageDecorateur(decoratorId) {
  try {
    const res = await fetch(`${SERVER_URL}/api/decorateurs/${decoratorId}/page`, { credentials: 'include' });
    if (res.ok) return await res.json();
  } catch (e) {}
  return {};
}

// ================================================================
//  MODAL DÉCORATEUR ZOOM
// ================================================================
function ouvrirProfilDeco(decoId) {
  const deco = DECORATEURS_DATA.find(d => d.id === decoId);
  if (!deco) return;

  const overlay = document.getElementById('decoProfilOverlay');
  const elNom = document.getElementById('decoProfilNom');
  const elDesc = document.getElementById('decoProfilDesc');
  const elContact = document.getElementById('decoProfilContact');
  const elPP = document.getElementById('decoProfilPP');

  if (!overlay || !elNom || !elDesc || !elContact || !elPP) {
    console.error('Modale decoProfilOverlay incomplète — rechargement nécessaire.');
    alert('⚠️ Une mise à jour du site a eu lieu. Merci de recharger la page (Ctrl+F5) puis réessayer.');
    return;
  }

  elNom.textContent = deco.nom_rp;
  elDesc.textContent = deco.description || '';
  elContact.textContent = deco.contact || '';
  elPP.style.backgroundImage = `url('${vignette(deco.photo, 320, 320)}')`;

  const discordWrap = document.getElementById('decoProfilDiscordWrap');
  if (discordWrap) {
    if (deco.discordLink) {
      discordWrap.style.display = 'block';
      const link = document.getElementById('decoProfilDiscordLink');
      if (link) {
        link.href = deco.discordLink;
        link.textContent = 'Rejoindre le serveur';
      }
    } else {
      discordWrap.style.display = 'none';
    }
  }

  const badgeEl = document.getElementById('decoProfilBadge');
  if (badgeEl) {
    badgeEl.innerHTML = deco.officiel
      ? '<span class="deco-official-badge">✅ Décorateur Officiel</span>'
      : '<span style="color:var(--ink-faint);font-size:12px;">Indépendant</span>';
  }

  const decosList = document.getElementById('decoProfilDecosList');
  if (decosList) {
    if (!deco.decos || deco.decos.length === 0) {
      decosList.innerHTML = '<p style="color:var(--ink-faint);font-size:12px;">Aucune décoration à afficher.</p>';
    } else {
      decosList.innerHTML = deco.decos.map((d, i) => `
        <div class="deco-profil-deco-item" id="profildeco-${i}">
          <img src="${vignette(vignetteDeco(d), 120, 120) || 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=200&q=60'}" loading="lazy" alt="${d.nom}">
          <div class="deco-profil-deco-info">
            <h5>${d.nom} ${d.type === 'video' ? '🎬' : ''}</h5>
            <p style="font-size:11px;color:var(--ink-faint);">${d.desc}</p>
            <div style="margin-top:6px;font-size:10px;color:var(--gold);">📅 ${d.date}</div>
          </div>
        </div>
      `).join('');

      deco.decos.forEach(async (d, i) => {
        if (d.type !== 'video' || !d.video_url) return;
        const thumb = await fetchYoutubeThumb(d.video_url);
        if (!thumb) return;
        const img = document.querySelector(`#profildeco-${i} img`);
        if (img) img.src = thumb;
      });
    }
  }

  overlay.classList.add('open');
}

function fermerProfilDeco() {
  document.getElementById('decoProfilOverlay').classList.remove('open');
}
function fermerProfilDecoOutside(event) {
  if (event.target.id === 'decoProfilOverlay') fermerProfilDeco();
}

// ================================================================
//  PAGE MON PROFIL (DÉCORATEUR) — connecté à l'API
// ================================================================
function genererMonProfilDeco() {
  _currentDecoLoggedIn = window.currentUser?.id;
  const deco = DECORATEURS_DATA.find(d => d.discord_id === _currentDecoLoggedIn);

  document.getElementById('meDecoProfilImg').src = vignette(deco?.photo, 280, 280) || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=80';
  document.getElementById('meDecoNomRP').value = deco?.nom_rp || '';
  document.getElementById('meDecoContact').value = deco?.contact || '';
  document.getElementById('meDecoDiscord').value = deco?.discordLink || '';
  document.getElementById('meDecoDesc').value = deco?.description || '';

  document.querySelectorAll('.meDecoStyle').forEach(cb => {
    cb.checked = deco ? (deco.styles || []).includes(cb.value) : false;
  });

  genererMessDecos();
}

let _meDecoNouvellePhotoProfil = null;

function ouvrirUploadPhotoProfil() {
  document.getElementById('meDecoProfilUpload').click();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('meDecoProfilUpload')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    _meDecoNouvellePhotoProfil = file;
    document.getElementById('meDecoProfilImg').src = URL.createObjectURL(file);
  });
});

async function enregistrerProfilDeco() {
  const nom_rp = document.getElementById('meDecoNomRP').value.trim();
  const contact = document.getElementById('meDecoContact').value.trim();
  const discordLink = document.getElementById('meDecoDiscord').value.trim();
  const description = document.getElementById('meDecoDesc').value.trim();
  const styles = Array.from(document.querySelectorAll('.meDecoStyle:checked')).map(cb => cb.value); // ← ajouté

  if (!nom_rp || !contact) { alert('⚠️ Le nom RP et le contact sont obligatoires.'); return; }
  if (discordLink && !discordLink.startsWith('https://discord.gg/') && !discordLink.startsWith('https://discord.com/invite/')) {
    if (!confirm("Ce lien ne ressemble pas à une invitation Discord classique (discord.gg/...). L'enregistrer quand même ?")) return;
  }

  try {
    let photo = document.getElementById('meDecoProfilImg').src;
    if (_meDecoNouvellePhotoProfil) {
      const urls = await uploaderPhotos([_meDecoNouvellePhotoProfil]);
      photo = urls[0];
    }

    const res = await fetch(`${SERVER_URL}/api/decorateurs/moi`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom_rp, contact, discordLink, description, styles, photo }) // ← styles ajouté ici
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Échec'); }

    await chargerDecorateurs();
    _currentDecoLoggedIn = window.currentUser.id;
    _meDecoNouvellePhotoProfil = null;
    alert('✅ Profil enregistré avec succès !');
  } catch (e) { alert(`❌ ${e.message}`); }
}

let _oembedCacheDecoProfil = {};
async function fetchYoutubeThumb(url) {
  if (!url) return null;
  if (_oembedCacheDecoProfil[url] !== undefined) return _oembedCacheDecoProfil[url];
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    const data = res.ok ? await res.json() : null;
    _oembedCacheDecoProfil[url] = data?.thumbnail_url || null;
    return _oembedCacheDecoProfil[url];
  } catch (e) { return null; }
}

function vignetteDeco(d) {
  return d.type === 'video' ? '' : (d.photos?.[0] || '');
}

function genererMessDecos() {
  const grid = document.getElementById('meDezosGrid');
  if (!grid) return;

  const deco = DECORATEURS_DATA.find(d => d.discord_id === window.currentUser?.id);
  if (!deco || !deco.decos || deco.decos.length === 0) {
    grid.innerHTML = `<p class="deco-list-empty">Vous n'avez pas encore proposé de décoration.<br><button class="link-btn" onclick="ouvrirModalAjouterDeco()">En ajouter une maintenant</button></p>`;
    return;
  }

  grid.innerHTML = deco.decos.map(d => `
    <div class="deco-mes-decos-card" id="mesdeco-${d.id}">
      <div class="deco-mes-decos-media">
        <img src="${vignette(vignetteDeco(d), 400, 260) || 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=400&q=60'}" loading="lazy" alt="${d.nom}">
        <div class="deco-mes-decos-badge">${(d.type || 'photo').toUpperCase()}</div>
      </div>
      <div class="deco-mes-decos-body">
        <h4>${d.nom}</h4>
        <p class="deco-mes-decos-desc">${d.desc.substring(0, 60)}...</p>
        <div class="deco-mes-decos-meta">
          <span>📅 ${d.date}</span>
          <span>${d.valide ? '✅ Validée' : '⏳ En attente'}</span>
        </div>
      </div>
      <div class="deco-mes-decos-actions">
        <button class="btn-icon-deco" onclick="ouvrirModalAjouterDeco(${d.id})" title="Modifier">✏️</button>
        <button class="btn-icon-deco red" onclick="supprimerMaDeco(${d.id})" title="Supprimer">🗑️</button>
      </div>
    </div>
  `).join('');

  deco.decos.filter(d => d.type === 'video' && d.video_url).forEach(async d => {
    const thumb = await fetchYoutubeThumb(d.video_url);
    if (!thumb) return;
    const img = document.querySelector(`#mesdeco-${d.id} .deco-mes-decos-media img`);
    if (img) img.src = thumb;
  });
}

// ================================================================
//  MODAL AJOUTER/MODIFIER DÉCORATION — connecté à l'API
// ================================================================
function ouvrirModalAjouterDeco(decoId = null) {
  _decoAddEditId = decoId ?? null;
  _decoNouvellesPhotos = [];

  const deco = _decoAddEditId
    ? DECORATEURS_DATA.find(d => d.discord_id === window.currentUser?.id)?.decos.find(x => x.id === _decoAddEditId)
    : null;
  _decoPhotosExistantes = (deco && deco.type !== 'video') ? [...(deco.photos || [])] : [];

  _decoAjoutSelectedBien = deco ? BIENS_DYNAMIQUES.find(b => b.nom === deco.bien) || null : null;
  document.getElementById('deco_bien_preview').innerHTML = _decoAjoutSelectedBien
    ? `<img src="${vignette(_decoAjoutSelectedBien.images[0], 80, 80)}" loading="lazy" style="width:40px;height:40px;object-fit:cover;border-radius:6px;background:#f0f0ec;" onerror="this.src='assets/placeholder.png'"><span style="font-size:13px;font-weight:600;color:#222;">${_decoAjoutSelectedBien.nom}</span>`
    : `<span style="color:#9a9a94;font-size:13px;">📋 Cliquer pour choisir un bien</span>`;

  document.getElementById('decoAddModalTitle').textContent = deco ? '✏️ Modifier la décoration' : '➕ Ajouter une décoration';
  document.getElementById('deco_nom').value = deco ? deco.nom : '';
  document.getElementById('deco_desc').value = deco ? deco.desc : '';
  document.getElementById('deco_photos').value = '';
  document.getElementById('deco_video_url').value = deco?.video_url || '';

  renderDecoPhotosPreview();
  switchDecoMediaType(deco?.type === 'video' ? 'video' : 'photo');
  document.getElementById('decoAddModalOverlay').classList.add('open');
}

function fermerModalAjouterDeco() {
  document.getElementById('decoAddModalOverlay').classList.remove('open');
}
function fermerModalAjouterDecoOutside(event) {
  if (event.target.id === 'decoAddModalOverlay') fermerModalAjouterDeco();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('deco_photos')?.addEventListener('change', (e) => {
    const fichiers = Array.from(e.target.files);
    if (_decoPhotosExistantes.length + _decoNouvellesPhotos.length + fichiers.length > 10) {
      alert('Maximum 10 photos.');
    }
    fichiers.forEach(file => {
      if (_decoPhotosExistantes.length + _decoNouvellesPhotos.length < 10) {
        _decoNouvellesPhotos.push(file);
      }
    });
    renderDecoPhotosPreview();
    e.target.value = '';
  });
});

function renderDecoPhotosPreview() {
  const wrap = document.getElementById('decoPhotosPreview');
  if (!wrap) return;

  const apercus = [..._decoPhotosExistantes.map(url => vignette(url, 120, 120)), ..._decoNouvellesPhotos.map(f => URL.createObjectURL(f))];
  wrap.innerHTML = apercus.length === 0
    ? `<p class="photo-upload-empty">Aucune photo sélectionnée (min: 1, max: 10)</p>`
    : apercus.map((src, i) => `
      <div class="photo-thumb ${i === 0 ? 'principale' : ''}">
        <img src="${src}" loading="lazy">
        <button type="button" class="remove-photo" onclick="retirerPhotoDeco(${i})">✕</button>
      </div>
    `).join('');
}

function retirerPhotoDeco(indexGlobal) {
  if (indexGlobal < _decoPhotosExistantes.length) {
    _decoPhotosExistantes.splice(indexGlobal, 1);
  } else {
    _decoNouvellesPhotos.splice(indexGlobal - _decoPhotosExistantes.length, 1);
  }
  renderDecoPhotosPreview();
}

async function soumettreAjouterDeco(event) {
  event.preventDefault();

  const nom = document.getElementById('deco_nom').value.trim();
  const desc = document.getElementById('deco_desc').value.trim();

  if (!_decoAjoutSelectedBien) { alert('Sélectionne un bien de l\'agence.'); return false; }
  if (!nom || !desc) { alert('Tous les champs sont requis.'); return false; }

  let videoUrl = '';
  if (_decoMediaType === 'video') {
    videoUrl = document.getElementById('deco_video_url').value.trim();
    if (!videoUrl) { alert('Renseigne un lien vidéo.'); return false; }
  } else if (_decoPhotosExistantes.length + _decoNouvellesPhotos.length === 0) {
    alert('Ajoute au moins une photo.'); return false;
  }

  const submitBtn = event.target.querySelector('button[type=submit]');
  submitBtn.disabled = true; submitBtn.textContent = 'Envoi...';

  try {
    const payload = { nom, bien: _decoAjoutSelectedBien.nom, desc, type: _decoMediaType };

    if (_decoMediaType === 'video') {
      payload.video_url = videoUrl;
    } else {
      let nouvellesUrls = [];
      if (_decoNouvellesPhotos.length > 0) nouvellesUrls = await uploaderPhotos(_decoNouvellesPhotos);
      payload.photos = [..._decoPhotosExistantes, ...nouvellesUrls];
    }

    if (_decoAddEditId) {
      const res = await fetch(`${SERVER_URL}/api/decorateurs/moi/decos/${_decoAddEditId}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Échec de la modification');
    } else {
      const res = await fetch(`${SERVER_URL}/api/decorateurs/moi/decos`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Échec de l\'ajout');
    }

    await chargerDecorateurs();
    fermerModalAjouterDeco();
    genererMessDecos();
    alert('✅ Décoration enregistrée !');
  } catch (e) {
    alert(`❌ ${e.message}`);
  } finally {
    submitBtn.disabled = false; submitBtn.textContent = 'Enregistrer la décoration';
  }
  return false;
}

async function supprimerMaDeco(decoId) {
  if (!confirm('Supprimer cette décoration ?')) return;
  try {
    const res = await fetch(`${SERVER_URL}/api/decorateurs/moi/decos/${decoId}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) throw new Error('Échec');
    await chargerDecorateurs();
    genererMessDecos();
  } catch (e) { alert('❌ Impossible de supprimer cette décoration.'); }
}

let _decoAjoutSelectedBien = null;

function ouvrirSelecteurBienDeco() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999999;display:flex;align-items:center;justify-content:center;padding:20px;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:14px;width:900px;max-width:95vw;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;color:#222;';
  const toutesCategories = [...CATEGORIES_BIENS_BASE, ...CATEGORIES_BIENS_CUSTOM];
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #eee;">
      <h3 style="margin:0;font-family:var(--font-display);font-size:20px;">Choisir un bien</h3>
      <button id="selbien-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:#666;">✕</button>
    </div>
    <div style="padding:12px 20px;border-bottom:1px solid #eee;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <input type="text" id="selbien-recherche" placeholder="🔎 Rechercher un bien..." style="flex:1;min-width:180px;margin:0;padding:9px 12px;border:1px solid #ddd;border-radius:8px;">
      <select id="selbien-cat" style="margin:0;padding:9px 12px;border:1px solid #ddd;border-radius:8px;">
        <option value="all">Toutes catégories</option>
        ${toutesCategories.map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>
    <div id="selbien-grid" style="flex:1;overflow-y:auto;padding:18px 20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;"></div>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => document.body.removeChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  box.querySelector('#selbien-close').onclick = close;

  function render() {
    const recherche = box.querySelector('#selbien-recherche').value.trim().toLowerCase();
    const cat = box.querySelector('#selbien-cat').value;
    let liste = BIENS_DYNAMIQUES;
    if (cat !== 'all') liste = liste.filter(b => b.categorie === cat);
    if (recherche) liste = liste.filter(b => b.nom.toLowerCase().includes(recherche));

    const grid = box.querySelector('#selbien-grid');
    if (liste.length === 0) { grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:#aaa;">Aucun bien trouvé.</p>`; return; }

    grid.innerHTML = liste.map(b => `
      <div data-id="${b.id}" style="border:1px solid #eee;border-radius:10px;overflow:hidden;cursor:pointer;transition:border-color .15s;">
        <div style="width:100%;height:90px;background:#f0f0ec;">
          <img src="${vignette(b.images[0], 300, 180)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.src='assets/placeholder.png'">
        </div>
        <div style="padding:8px 10px;">
          <div style="font-size:12px;font-weight:600;">${b.nom}</div>
          <div style="font-size:10px;color:#888;">${b.categorie}</div>
          <div style="font-size:10px;color:#888;margin-top:2px;">Achat: ${b.prixAchat.toLocaleString('fr-FR')}$ · Coffre: ${b.coffre.toLocaleString('fr-FR')} kg</div>
        </div>
      </div>`).join('');
    grid.querySelectorAll('[data-id]').forEach(card => {
      card.onclick = () => {
        const bien = BIENS_DYNAMIQUES.find(b => b.id === Number(card.dataset.id));
        _decoAjoutSelectedBien = bien;
        document.getElementById('deco_bien_preview').innerHTML = `
          <img src="${vignette(bien.images[0], 80, 80)}" loading="lazy" style="width:40px;height:40px;object-fit:cover;border-radius:6px;background:#f0f0ec;" onerror="this.src='assets/placeholder.png'">
          <span style="font-size:13px;font-weight:600;color:#222;">${bien.nom}</span>`;
        close();
      };
    });
  }
  box.querySelector('#selbien-recherche').addEventListener('input', render);
  box.querySelector('#selbien-cat').addEventListener('change', render);
  render();
}

// ================================================================
//  PAGE CONFIG DÉCORATION — connectée à l'API
// ================================================================
async function genererConfigDeco() {
  await chargerDecorateurs();
  await chargerStylesDeco();
  await chargerBlacklistDeco();
  genererCfgDecoKpis();
  genererCfgDecoTable();
  genererCfgDecoBlacklistTable();
}

function genererCfgDecoKpis() {
  const el = document.getElementById('cfgDecoKpis');
  if (!el) return;

  const totalDecos = DECORATEURS_DATA.reduce((sum, d) => sum + (d.decos?.length || 0), 0);
  const totalDecorateurs = DECORATEURS_DATA.length;
  const officiels = DECORATEURS_DATA.filter(d => d.officiel).length;
  const elStyles = document.getElementById('cfgDecoStylesDesc');
  if (elStyles) elStyles.textContent = `${STYLES_DECO_BASE.length + STYLES_DECO_CUSTOM.length} style(s) disponible(s).`;

  el.innerHTML = `
    <div class="logs-kpi-card"><div class="lbl">Décorateurs</div><div class="val">${totalDecorateurs}</div></div>
    <div class="logs-kpi-card" style="border-left-color:#4fa8d8;"><div class="lbl">Officiels</div><div class="val">${officiels}</div></div>
    <div class="logs-kpi-card" style="border-left-color:var(--deco);"><div class="lbl">Décorations</div><div class="val">${totalDecos}</div></div>
  `;

  document.getElementById('cfgDecoStylesDesc').textContent = `${STYLES_DECO_BASE.length + STYLES_DECO_CUSTOM.length} style(s) disponible(s).`;
}

function genererCfgDecoTable() {
  const tbody = document.getElementById('cfgDecoTableBody');
  if (!tbody) return;

  if (DECORATEURS_DATA.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="ventes-empty">Aucun décorateur enregistré pour le moment.</td></tr>`;
    return;
  }

  tbody.innerHTML = DECORATEURS_DATA.map(d => `
    <tr>
      <td>${d.nom_rp}</td>
      <td>${d.decos?.length || 0}</td>
      <td>-</td>
      <td>
        <button class="decorateur-toggle-pill ${d.officiel ? 'oui' : 'non'}" onclick="cfgToggleOfficiel(${d.id})">
          ${d.officiel ? '✅ Officiel' : '— Indépendant'}
        </button>
      </td>
      <td>
        <button class="btn-supprimer" onclick="revoquerDecoPreview(${d.id})">Révoquer</button>
      </td>
    </tr>
  `).join('');
}

async function cfgToggleOfficiel(decoId) {
  const d = DECORATEURS_DATA.find(x => x.id === decoId);
  if (!d) return;
  const nouveauStatut = !d.officiel;
  try {
    const res = await fetch(`${SERVER_URL}/api/decorateurs/${decoId}/officiel`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ officiel: nouveauStatut })
    });
    if (!res.ok) throw new Error('Échec');
    d.officiel = nouveauStatut;
    genererCfgDecoTable();
    genererCfgDecoKpis();
  } catch (e) { alert('❌ Impossible de changer le statut officiel.'); }
}

async function revoquerDecoPreview(decoId) {
  const d = DECORATEURS_DATA.find(x => x.id === decoId);
  if (!d) return;
  if (!confirm(`Révoquer le décorateur "${d.nom_rp}" ?`)) return;
  try {
    const res = await fetch(`${SERVER_URL}/api/decorateurs/${decoId}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) throw new Error('Échec');
    DECORATEURS_DATA = DECORATEURS_DATA.filter(x => x.id !== decoId);
    genererCfgDecoTable();
    genererCfgDecoKpis();
  } catch (e) { alert('❌ Impossible de révoquer ce décorateur.'); }
}

// Ajoute 'config-deco' à la liste des pages connues par showSection()
if (!ALL_PAGE_KEYS.includes('config-deco')) {
  ALL_PAGE_KEYS.push('config-deco');
}
