/* =====================================================================
   notes-idees.js — module commun à toutes les applis (à COPIER dans le
   dossier de chaque appli, comme champs-mobile.js).

   Écran « Notes » ouvert depuis Réglages : un bloc-notes libre pour
   noter des idées d'amélioration de l'appli.
   - En-tête : flèche retour, titre « Notes », icône Copier (tout le texte).
   - Enregistrement automatique pendant qu'on tape (petite pause de 0,7 s),
     et à la fermeture de l'écran.
   - L'appli s'occupe de la synchro : elle donne le texte de départ et une
     fonction qui l'enregistre (Firebase), et prévient le module quand un
     nouveau texte arrive d'un autre appareil (NotesIdees.maj).

   Utilisation dans app.js :
     NotesIdees.ouvrir(texteActuel, texte => { …enregistrer texte… });
     NotesIdees.maj(texteVenuDuServeur);
   Couleurs : mêmes variables que le petit menu (--pm-fond, --pm-texte,
   --pm-trait, --pm-discret, --pm-champ, --pm-police), données dans le
   style.css de l'appli par le bloc « .pm-voile, .ni-ecran { … } ».
   ===================================================================== */
(function () {
  "use strict";

  const CSS = `
.ni-ecran { position: fixed; inset: 0; z-index: 2147482000; display: flex; flex-direction: column;
  background: var(--pm-champ, Canvas); color: var(--pm-texte, CanvasText);
  font-family: var(--pm-police, inherit); }
.ni-tete { flex: none; display: flex; align-items: center; gap: 4px; height: 48px; padding: 0 6px;
  border-bottom: 1px solid var(--pm-trait, rgba(128,128,128,.3)); background: var(--pm-fond, Canvas); }
.ni-tete h2 { flex: 1; margin: 0; font-size: 17px; font-weight: 600; font-family: inherit; color: inherit; }
.ni-bouton { width: 40px; height: 40px; display: grid; place-items: center; padding: 0; margin: 0;
  border: 0; border-radius: 8px; background: none; color: inherit; cursor: pointer; }
.ni-bouton:active { background: var(--pm-appui, rgba(128,128,128,.15)); }
.ni-bouton svg { width: 22px; height: 22px; }
.ni-texte { flex: 1; min-height: 0; margin: 10px; padding: 10px 12px; box-sizing: border-box; resize: none;
  border: 1px solid var(--pm-trait, rgba(128,128,128,.3)); border-radius: 10px; outline: none;
  background: var(--pm-fond, Canvas); color: inherit; font: inherit; font-size: 15px; line-height: 1.5; }
.ni-texte::placeholder { color: var(--pm-discret, GrayText); }
.ni-bulle { position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%); padding: 7px 14px;
  border-radius: 999px; background: var(--pm-texte, CanvasText); color: var(--pm-fond, Canvas);
  font-size: 14px; pointer-events: none; }
`;

  // Icônes au trait fin (même famille que les autres icônes des applis).
  const ICONE_RETOUR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M5 12l6 6M5 12l6-6"/></svg>';
  const ICONE_COPIER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';

  let ecran = null;        // l'écran affiché (ou null)
  let zone = null;         // la zone de texte
  let enregistrer = null;  // fonction donnée par l'appli
  let minuteur = null;     // attente avant d'enregistrer (on n'écrit pas à chaque lettre)
  let dernierEnvoye = "";  // dernier texte enregistré (évite d'écrire pour rien)

  function styleUneFois() {
    if (document.getElementById("ni-style")) return;
    const s = document.createElement("style");
    s.id = "ni-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // Enregistre tout de suite ce qui est tapé, si ça a changé.
  function envoyer() {
    clearTimeout(minuteur);
    minuteur = null;
    if (!zone || !enregistrer) return;
    if (zone.value === dernierEnvoye) return;
    dernierEnvoye = zone.value;
    enregistrer(zone.value);
  }

  function bulle(texte) {
    const b = document.createElement("div");
    b.className = "ni-bulle";
    b.textContent = texte;
    ecran.appendChild(b);
    setTimeout(() => b.remove(), 1600);
  }

  // Copie tout le texte (pour le coller dans une discussion, un mail…).
  async function copier() {
    const texte = zone.value;
    try {
      await navigator.clipboard.writeText(texte);
    } catch (e) {
      // Vieux navigateur ou copie refusée : ancienne méthode (on sélectionne puis « copier »).
      zone.select();
      document.execCommand("copy");
      zone.setSelectionRange(texte.length, texte.length);
    }
    bulle("Copié");
  }

  function fermer() {
    if (!ecran) return;
    envoyer();
    ecran.remove();
    ecran = zone = enregistrer = null;
  }

  function ouvrir(texte, fonctionEnregistrer) {
    fermer();
    styleUneFois();
    enregistrer = fonctionEnregistrer;
    dernierEnvoye = texte || "";

    ecran = document.createElement("div");
    ecran.className = "ni-ecran";
    ecran.setAttribute("role", "dialog");
    ecran.setAttribute("aria-label", "Notes");
    ecran.innerHTML = `
      <div class="ni-tete">
        <button type="button" class="ni-bouton" data-ni="retour" aria-label="Retour">${ICONE_RETOUR}</button>
        <h2>Notes</h2>
        <button type="button" class="ni-bouton" data-ni="copier" aria-label="Copier">${ICONE_COPIER}</button>
      </div>
      <textarea class="ni-texte" placeholder="Idées d'amélioration…" spellcheck="true"></textarea>`;
    zone = ecran.querySelector("textarea");
    zone.value = dernierEnvoye;

    ecran.querySelector('[data-ni="retour"]').addEventListener("click", fermer);
    ecran.querySelector('[data-ni="copier"]').addEventListener("click", copier);
    zone.addEventListener("input", () => {
      clearTimeout(minuteur);
      minuteur = setTimeout(envoyer, 700);
    });
    zone.addEventListener("blur", envoyer);
    // Les touchers dans l'écran ne doivent pas « traverser » vers l'appli derrière
    // (une fenêtre Réglages ouverte dessous croirait qu'on a touché à côté).
    ["pointerdown", "mousedown", "touchstart", "click"].forEach(t =>
      ecran.addEventListener(t, e => e.stopPropagation()));

    document.body.appendChild(ecran);
  }

  // Nouveau texte venu d'un autre appareil : on l'affiche, sauf si je suis
  // en train de taper (sinon mes lettres sauteraient).
  function maj(texte) {
    if (!ecran || !zone) return;
    texte = texte || "";
    if (document.activeElement === zone || minuteur) return;
    if (zone.value !== texte) { zone.value = texte; dernierEnvoye = texte; }
  }

  // Touche Échap (PC) = retour ; appli mise en arrière-plan = on enregistre.
  document.addEventListener("keydown", e => { if (e.key === "Escape" && ecran) { e.stopPropagation(); fermer(); } }, true);
  document.addEventListener("visibilitychange", () => { if (document.hidden) envoyer(); });

  window.NotesIdees = { ouvrir, fermer, maj };
})();
