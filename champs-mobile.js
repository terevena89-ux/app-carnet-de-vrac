/* =====================================================================
   champs-mobile.js — module commun à toutes les applis (à COPIER dans
   le dossier de chaque appli, comme excel-style.js).

   Il fait deux choses, tout seul, sans rien toucher au reste du code :

   1. Coupe le remplissage automatique (la barre clé / carte / adresse
      que le téléphone colle au-dessus du clavier) sur toutes les cases
      de saisie, y compris celles créées plus tard par l'appli.

   2. Sur téléphone (écran tactile) : remplace la grosse fenêtre de
      choix des listes déroulantes par un petit panneau maison qui monte
      du bas, avec une coche fine sur le choix actuel, et une case
      « Chercher… » quand il y a plus de 10 choix.
      Sur PC (souris), rien ne change : liste normale de Windows.

   Le vrai <select> reste dans la page : l'appli continue de lire sa
   valeur et d'écouter « change » exactement comme avant.

   Couleurs : chaque appli les donne dans son style.css avec un bloc
   .pm-voile { --pm-fond: …; --pm-texte: …; … } (sinon couleurs de base).
   Pour garder la liste du téléphone sur une case précise :
   <select data-menu-natif>.
   ===================================================================== */
(function () {
  "use strict";

  /* ---------- 1. Couper le remplissage automatique ---------- */

  // Types de cases où le remplissage auto n'a rien à faire de toute façon.
  const SANS_SAISIE = ["checkbox", "radio", "range", "color", "file", "hidden", "button", "submit", "reset", "image"];

  function couperRemplissage(el) {
    if (el.hasAttribute("data-garder-autocomplete")) return;
    if (el.tagName === "INPUT" && SANS_SAISIE.includes((el.type || "").toLowerCase())) return;
    // « off » = consigne officielle « ne propose rien ici ».
    el.setAttribute("autocomplete", "off");
    // Consignes équivalentes pour les gestionnaires de mots de passe connus.
    el.setAttribute("data-lpignore", "true");
    el.setAttribute("data-1p-ignore", "true");
    el.setAttribute("data-bwignore", "true");
    el.setAttribute("data-form-type", "other");
  }

  function couperDans(racine) {
    if (racine.nodeType !== 1) return;
    if (racine.matches("input, textarea, form")) couperRemplissage(racine);
    racine.querySelectorAll("input, textarea, form").forEach(couperRemplissage);
  }

  // Surveille la page : chaque case ajoutée plus tard est traitée aussi
  // (comme un garde qui contrôle chaque nouveau venu à l'entrée).
  function demarrerSurveillance() {
    couperDans(document.documentElement);
    new MutationObserver(changements => {
      for (const c of changements) c.addedNodes.forEach(couperDans);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  /* ---------- 2. Petit panneau pour les listes déroulantes ---------- */

  const tactile = window.matchMedia("(pointer: coarse)");
  const SEUIL_RECHERCHE = 10; // au-delà de 10 choix : case « Chercher… »
  let ouvert = null;          // panneau affiché en ce moment (ou null)

  // Styles du panneau, ajoutés une seule fois dans la page.
  const CSS = `
@media (pointer: coarse) {
  /* Le doigt « traverse » la liste : le téléphone n'ouvre plus sa fenêtre,
     c'est notre code qui attrape le toucher. */
  select:not([multiple]):not([data-menu-natif]) { pointer-events: none; }
}
.pm-voile { position: fixed; inset: 0; z-index: 2147483000; background: rgba(0,0,0,.32);
  display: flex; align-items: flex-end; justify-content: center; touch-action: none;
  -webkit-tap-highlight-color: transparent; }
.pm-panneau { width: calc(100% - 16px); max-width: 480px; margin: 0 8px 8px; max-height: 62vh;
  display: flex; flex-direction: column; overflow: hidden; border-radius: 14px;
  background: var(--pm-fond, Canvas); color: var(--pm-texte, CanvasText);
  font-family: var(--pm-police, inherit); font-size: 15px;
  box-shadow: 0 8px 28px rgba(0,0,0,.28); touch-action: auto; }
.pm-poignee { width: 36px; height: 4px; border-radius: 2px; margin: 6px auto 2px; flex: none;
  background: var(--pm-trait, rgba(128,128,128,.35)); }
.pm-cherche { flex: none; padding: 4px 10px 6px; }
.pm-cherche input { width: 100%; box-sizing: border-box; height: 34px; padding: 0 10px; margin: 0;
  border: 1px solid var(--pm-trait, rgba(128,128,128,.35)); border-radius: 9px; outline: none;
  background: var(--pm-champ, transparent); color: inherit; font: inherit; font-size: 15px; }
.pm-liste { overflow-y: auto; overscroll-behavior: contain; padding-bottom: 4px; }
.pm-choix { display: flex; align-items: center; justify-content: space-between; gap: 10px;
  width: 100%; min-height: 40px; padding: 0 14px; margin: 0; box-sizing: border-box;
  border: 0; border-top: 1px solid var(--pm-trait, rgba(128,128,128,.2)); background: none;
  color: inherit; font: inherit; text-align: left; cursor: pointer; }
.pm-liste > .pm-choix:first-child, .pm-groupe + .pm-choix { border-top: 0; }
.pm-choix:active { background: var(--pm-appui, rgba(128,128,128,.12)); }
.pm-choix[disabled] { opacity: .45; }
.pm-choix span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pm-choix svg { flex: none; width: 18px; height: 18px; color: var(--pm-accent, currentColor); }
.pm-groupe { padding: 8px 14px 2px; font-size: 12px; color: var(--pm-discret, GrayText); }
.pm-vide { padding: 12px 14px; color: var(--pm-discret, GrayText); }
.pm-anime { animation: pm-voile-in .16s ease-out; }
.pm-anime .pm-panneau { animation: pm-monte .2s cubic-bezier(.2,.8,.2,1); }
@keyframes pm-voile-in { from { background: rgba(0,0,0,0); } }
@keyframes pm-monte { from { transform: translateY(40px); opacity: 0; } }
`;

  // Petite coche fine (même style de trait que les icônes des applis).
  const COCHE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  // Animations coupées si le téléphone demande « moins d'animations »
  // ou si l'appli est réglée sur « Animations : Simples ».
  function animationsSimples() {
    const html = document.documentElement;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
      || html.classList.contains("anim-simples")
      || /simple/i.test(html.dataset.anim || "");
  }

  // Pour la recherche : minuscules, sans accents ni lettres collées
  // (« Crème » = « creme », « Bœuf » = « boeuf »).
  const simplifier = t => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/œ/g, "oe").replace(/æ/g, "ae");

  // Retrouve la liste déroulante sous le doigt. Comme elles laissent passer
  // le toucher, on les rend « touchables » une fraction de seconde pour
  // demander au navigateur laquelle est vraiment au-dessus (et pas cachée
  // sous une fiche ouverte, par exemple).
  function selectSousLeDoigt(x, y) {
    const candidats = [...document.querySelectorAll("select:not([multiple]):not([data-menu-natif])")]
      .filter(s => {
        if (s.disabled) return false;
        const r = s.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      });
    if (!candidats.length) return null;
    candidats.forEach(s => s.style.setProperty("pointer-events", "auto", "important"));
    const dessus = document.elementFromPoint(x, y);
    candidats.forEach(s => s.style.removeProperty("pointer-events"));
    return candidats.includes(dessus) ? dessus : null;
  }

  function fermer() {
    if (!ouvert) return;
    ouvert.remove();
    ouvert = null;
  }

  // Valide un choix : met la valeur dans le vrai <select> et prévient l'appli.
  function choisir(select, valeur) {
    fermer();
    if (select.value === valeur) return;
    select.value = valeur;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function ouvrir(select) {
    fermer();
    const options = [...select.options].filter(o => !o.hidden);

    const voile = document.createElement("div");
    voile.className = "pm-voile" + (animationsSimples() ? "" : " pm-anime");
    const panneau = document.createElement("div");
    panneau.className = "pm-panneau";
    panneau.setAttribute("role", "listbox");
    const nom = select.getAttribute("aria-label") || (select.labels && select.labels[0] && select.labels[0].textContent.trim());
    if (nom) panneau.setAttribute("aria-label", nom);
    panneau.innerHTML = '<div class="pm-poignee"></div>';

    // Case de recherche, seulement pour les longues listes.
    let cherche = null;
    if (options.length > SEUIL_RECHERCHE) {
      const zone = document.createElement("div");
      zone.className = "pm-cherche";
      cherche = document.createElement("input");
      cherche.type = "search";
      cherche.placeholder = "Chercher…";
      cherche.setAttribute("enterkeyhint", "search");
      zone.appendChild(cherche);
      panneau.appendChild(zone);
    }

    const liste = document.createElement("div");
    liste.className = "pm-liste";
    panneau.appendChild(liste);

    // Fabrique les lignes (avec les titres de groupes s'il y en a).
    let groupe = null, choixActuel = null;
    for (const o of options) {
      const g = o.parentElement.tagName === "OPTGROUP" ? o.parentElement : null;
      if (g && g !== groupe) {
        const titre = document.createElement("div");
        titre.className = "pm-groupe";
        titre.textContent = g.label;
        liste.appendChild(titre);
      }
      groupe = g;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pm-choix";
      b.setAttribute("role", "option");
      b.disabled = o.disabled || (g && g.disabled);
      const texte = document.createElement("span");
      texte.textContent = o.textContent.trim() || " "; // option vide = ligne vide
      b.appendChild(texte);
      if (o.selected) {
        b.insertAdjacentHTML("beforeend", COCHE);
        b.setAttribute("aria-selected", "true");
        choixActuel = b;
      }
      b._pmTexte = simplifier(o.textContent);
      b.addEventListener("click", () => choisir(select, o.value));
      liste.appendChild(b);
    }

    // Recherche : on cache les lignes (et les titres de groupe) sans résultat.
    if (cherche) {
      const vide = document.createElement("div");
      vide.className = "pm-vide";
      vide.textContent = "Aucun résultat";
      vide.hidden = true;
      liste.appendChild(vide);
      cherche.addEventListener("input", () => {
        const q = simplifier(cherche.value.trim());
        let nb = 0;
        liste.querySelectorAll(".pm-choix").forEach(b => {
          const ok = !q || b._pmTexte.includes(q);
          b.hidden = !ok;
          if (ok) nb++;
        });
        liste.querySelectorAll(".pm-groupe").forEach(t => {
          let s = t.nextElementSibling, visible = false;
          while (s && s.classList.contains("pm-choix")) { if (!s.hidden) visible = true; s = s.nextElementSibling; }
          t.hidden = !visible;
        });
        vide.hidden = nb > 0;
      });
    }

    voile.appendChild(panneau);

    // Toucher à côté du panneau = fermer sans rien changer.
    voile.addEventListener("click", e => { if (e.target === voile) fermer(); });
    // Les touchers dans le panneau ne doivent pas « traverser » vers l'appli
    // (sinon une fiche ouverte derrière pourrait croire qu'on a touché à côté).
    ["pointerdown", "mousedown", "touchstart", "click"].forEach(t =>
      voile.addEventListener(t, e => e.stopPropagation()));

    document.body.appendChild(voile);
    ouvert = voile;

    // Le choix actuel est visible tout de suite, au milieu si la liste est longue.
    if (choixActuel) liste.scrollTop = choixActuel.offsetTop - liste.clientHeight / 2 + choixActuel.offsetHeight / 2;
  }

  // Attrape le toucher avant tout le monde (phase « capture ») : si c'est sur
  // une liste déroulante, on ouvre notre panneau et l'appli ne voit rien.
  window.addEventListener("click", e => {
    if (!tactile.matches || ouvert) return;
    const select = selectSousLeDoigt(e.clientX, e.clientY);
    if (!select) return;
    e.preventDefault();
    e.stopPropagation();
    ouvrir(select);
  }, true);

  // Touche Échap (clavier branché) ou retour à l'appli après l'avoir quittée : on ferme.
  document.addEventListener("keydown", e => { if (e.key === "Escape") fermer(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) fermer(); });

  /* ---------- Démarrage ---------- */

  function demarrer() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    demarrerSurveillance();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer);
  else demarrer();
})();
