/* ================================================================
   DYNASTY 8 — NAVIGATION MOBILE (v2)
   Charge ce fichier APRÈS main.js.

   1) TAB BAR : construite à partir des .side-item marqués
      data-mobiletab="N" (N = priorité, 1 = le plus important).
      - ne montre que les pages visibles pour le rôle de l'utilisateur
        (appliquerVisibiliteSidebar cache déjà les autres)
      - garde les 4 plus prioritaires, dans l'ordre de la sidebar,
        puis un bouton "Menu" qui ouvre le tiroir complet
      - suit le mode Agence / Déco et la page active
      - reste cachée sur les écrans login / maintenance
   2) TIROIR : se ferme au clic sur un item, sur le voile, par glissement
      vers la gauche ou avec Échap.
   3) TABLEAUX : ajoute data-label sur chaque <td> (depuis les <th>)
      pour que le CSS les affiche en cartes sur téléphone.
   ================================================================ */
(function () {
  'use strict';

  const MAX_TABS = 4; // + le bouton Menu

  // Libellés courts pour que rien ne soit coupé dans la barre
  const SHORT = {
    'catalogue': 'Catalogue',
    'ventes': 'Ventes',
    'mon-espace': 'Espace',
    'statistiques': 'Stats',
    'config': 'Config',
    'home-deco': 'Accueil',
    'decorateurs': 'Déco',
    'profil': 'Profil',
    'config-deco': 'Config',
  };

  let appRoot = null;
  let bar = null;
  let raf = 0;
  let swipeStartX = null;

  const isDeco = () => document.body.classList.contains('mode-deco');
  const activeSidebar = () => document.getElementById(isDeco() ? 'sidebar-deco' : 'sidebar-agence');
  const shown = el => !!el && getComputedStyle(el).display !== 'none';
  const drawerIsOpen = () => !!document.querySelector('.sidebar.open');

  // Ne touche à la classe que si elle change (évite de relancer l'observer)
  function setBodyClass(name, on) {
    if (document.body.classList.contains(name) !== on) document.body.classList.toggle(name, on);
  }

  /* ---------------- TIROIR ---------------- */
  function closeDrawer() {
    document.querySelectorAll('.sidebar.open').forEach(s => s.classList.remove('open'));
  }
  function toggleDrawer() {
    const sb = activeSidebar();
    if (!sb) return;
    const willOpen = !sb.classList.contains('open');
    closeDrawer();
    if (willOpen) sb.classList.add('open');
  }

  /* ---------------- TAB BAR ---------------- */
  function pickItems(sidebar) {
    return Array.from(sidebar.querySelectorAll('.side-item[data-mobiletab]'))
      .filter(shown)
      .map((el, i) => ({ el, i, p: parseFloat(el.dataset.mobiletab) || 9 }))
      .sort((a, b) => a.p - b.p || a.i - b.i)   // les plus importantes d'abord
      .slice(0, MAX_TABS)
      .sort((a, b) => a.i - b.i)                // puis ordre de la sidebar
      .map(o => o.el);
  }

  function labelOf(el) {
    if (SHORT[el.dataset.page]) return SHORT[el.dataset.page];
    if (el.id === 'sideItemMaPage') return 'Ma page';
    const ico = el.querySelector('.ico')?.textContent || '';
    return el.textContent.replace(ico, '').trim();
  }

  function makeTab(icon, label, active, onClick, extraClass) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mobile-tabbar-item' + (extraClass ? ' ' + extraClass : '') + (active ? ' active' : '');
    const i = document.createElement('span');
    i.className = 'ico';
    i.textContent = icon;
    const l = document.createElement('span');
    l.className = 'lbl';
    l.textContent = label;
    b.append(i, l);
    b.addEventListener('click', onClick);
    return b;
  }

  function build() {
    raf = 0;
    setBodyClass('drawer-open', drawerIsOpen());

    const sidebar = activeSidebar();
    const items = shown(appRoot) && sidebar ? pickItems(sidebar) : [];

    if (!items.length) {
      if (bar) { bar.remove(); bar = null; }
      setBodyClass('has-tabbar', false);
      return;
    }

    if (!bar) {
      bar = document.createElement('nav');
      bar.className = 'mobile-tabbar';
      bar.setAttribute('aria-label', 'Navigation principale');
      document.body.appendChild(bar);
    }
    bar.replaceChildren();

    items.forEach(src => {
      const icon = src.querySelector('.ico')?.textContent || src.dataset.icon || '•';
      bar.appendChild(makeTab(icon, labelOf(src), src.classList.contains('active'), () => {
        closeDrawer();
        src.click(); // réutilise tel quel le onclick de la sidebar (showSection…)
      }));
    });
    bar.appendChild(makeTab('☰', 'Menu', drawerIsOpen(), toggleDrawer, 'is-menu'));

    setBodyClass('has-tabbar', true);
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(build);
  }

  /* ---------------- TABLEAUX → CARTES ---------------- */
  const WIDE = /^(bien|détails?|actions?|raison|message|route|description)/i;

  function prepareTable(table) {
    if (table.classList.contains('matrix-table')) return;
    if (!table.closest('.ventes-table-wrap')) return; // les petits tableaux restent des tableaux
    const tbody = table.tBodies[0];
    if (!tbody) return;

    table.classList.add('m-cards');
    const heads = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());

    const label = () => {
      tbody.querySelectorAll('tr').forEach(tr => {
        Array.from(tr.cells).forEach((td, i) => {
          if (td.colSpan > 1) return;           // lignes "Aucune donnée"
          const name = heads[i] || '';
          td.dataset.label = name;
          td.classList.toggle('m-wide', !name || WIDE.test(name));
        });
      });
    };
    label();
    // main.js réécrit le tbody à chaque rendu : on relabellise
    new MutationObserver(label).observe(tbody, { childList: true });
  }

  /* ---------------- INIT ---------------- */
  function init() {
    appRoot = document.getElementById('appRoot');
    if (!appRoot) return;

    const scrim = document.createElement('div');
    scrim.className = 'drawer-scrim';
    scrim.addEventListener('click', closeDrawer);
    document.body.appendChild(scrim);

    // Tout ce qui change la barre : connexion (appRoot), rôle (style des items),
    // page active (class), mode agence/déco (style des sidebars), tiroir (class)
    const obs = new MutationObserver(schedule);
    obs.observe(appRoot, { attributes: true, attributeFilter: ['style'] });
    document.querySelectorAll('.sidebar').forEach(sb =>
      obs.observe(sb, { attributes: true, subtree: true, attributeFilter: ['class', 'style'] })
    );

    document.querySelectorAll('table.ventes-table').forEach(prepareTable);

    document.addEventListener('click', e => {
      if (e.target.closest('.sidebar .side-item')) closeDrawer();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

    document.addEventListener('touchstart', e => {
      swipeStartX = e.target.closest('.sidebar.open') ? e.touches[0].clientX : null;
    }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (swipeStartX !== null && e.touches[0].clientX - swipeStartX < -70) {
        closeDrawer();
        swipeStartX = null;
      }
    }, { passive: true });

    window.matchMedia('(max-width: 900px)').addEventListener('change', () => {
      closeDrawer();
      schedule();
    });

    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();