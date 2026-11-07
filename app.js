// =========================================================
// etC. — le « cerveau » de l'appli (carnet de vrac : notes + décisions).
// Plan du fichier :
//   1. Réglages de base et état
//   2. Stockage (Firebase, ou mode démo dans le navigateur)
//   3. Petits outils (dates, saisie rapide, échéances…)
//   4. Écrans : Notes, Décisions, Ma semaine
//   5. Fiches et formulaires (pop-ups)
//   6. Réglages : thème, animations, catégories, Anki, Excel, compte
//   7. Clics, démarrage et mise à jour automatique
// =========================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { chargerExcelJS, ajouterFeuille, telechargerClasseur, lireClasseur, lireFeuille } from "./excel-style.js";

/* ---------- 1. Réglages de base et état ---------- */

const VERSION = "0.1.0";
const NOM_APPLI = "app-carnet-de-vrac"; // dossier dans Firestore et nom des fichiers Excel
const TRI = "À trier";                  // catégorie par défaut, toujours présente

// Tout ce que l'appli sait à un instant donné (comme la « sauvegarde en cours » d'un jeu)
const S = {
  notes: [], decs: [],
  cats: [TRI], lastRecapAt: "", lastAnkiAt: "",   // synchronisés (document « donnees »)
  onglet: "notes", modif: false, recherche: false, q: "",
  filtre: "Tout",        // Tout, une catégorie, "__fav" (favoris) ou "__arch" (archives)
  filtreDec: "cours",    // cours (en cours) ou arch (archivées = tranchées)
  pick: null,            // les 3 vieux sujets tirés au hasard (« Et si tu relisais… »)
  pret: false, compte: ""
};

// Réglages de ressenti, propres à CET appareil (pas synchronisés)
function reglagesLocaux() { try { return JSON.parse(localStorage.getItem("etc-reglages")) || {}; } catch (e) { return {}; } }
function sauverReglageLocal(k, v) {
  const r = reglagesLocaux(); r[k] = v;
  try { localStorage.setItem("etc-reglages", JSON.stringify(r)); } catch (e) { /* stockage bloqué */ }
}

// Mode démo (adresse se terminant par ?demo) : données gardées dans ce navigateur, sans connexion.
const MODE_DEMO = new URLSearchParams(location.search).has("demo");

// Lien ou texte reçu par le menu « Partager » d'Android (arrive dans url, text ou title)
let PARTAGE = MODE_DEMO ? "" : (() => {
  const p = new URLSearchParams(location.search);
  const s = [p.get("title"), p.get("text"), p.get("url")].filter(Boolean).join(" ");
  if (s) history.replaceState(null, "", location.pathname); // recharger ne doit pas l'ajouter deux fois
  return s;
})();

/* ---------- 2. Stockage ---------- */
// Rangement dans Firestore :
//   users/{mon uid}/app-carnet-de-vrac/donnees                 -> { cats, lastRecapAt, lastAnkiAt }
//   users/{mon uid}/app-carnet-de-vrac/donnees/notes/{id}      -> une note par document
//   users/{mon uid}/app-carnet-de-vrac/donnees/decisions/{id}  -> une décision par document
// Un document par élément : deux appareils qui modifient deux notes différentes ne se gênent pas.
// S'ils modifient la même : la dernière modification gagne.

let db = null, auth = null, uid = null, arrets = [];
const coll = nom => collection(db, "users", uid, NOM_APPLI, "donnees", nom);
const refDonnees = () => doc(db, "users", uid, NOM_APPLI, "donnees");
const TABLE = { notes: "notes", decisions: "decs" }; // nom Firestore -> case de S

function erreurEcriture(err) { console.error(err); toast("Échec de l’enregistrement"); }

// On n'attend pas la réponse du serveur : hors ligne, Firestore garde l'écriture
// en attente et l'envoie tout seul au retour du réseau.
function ecrire(nom, o) {
  const liste = S[TABLE[nom]];
  const i = liste.findIndex(x => x.id === o.id);
  if (i >= 0) liste[i] = o; else liste.push(o);
  if (MODE_DEMO) return sauverDemo();
  const { id, ...reste } = o;
  setDoc(doc(coll(nom), id), reste).catch(erreurEcriture);
}
function effacer(nom, id) {
  S[TABLE[nom]] = S[TABLE[nom]].filter(x => x.id !== id);
  if (MODE_DEMO) return sauverDemo();
  deleteDoc(doc(coll(nom), id)).catch(erreurEcriture);
}
function sauverMeta() {
  if (MODE_DEMO) return sauverDemo();
  setDoc(refDonnees(), { cats: S.cats, lastRecapAt: S.lastRecapAt, lastAnkiAt: S.lastAnkiAt }, { merge: true }).catch(erreurEcriture);
}

// Mode démo : tout est recopié dans le navigateur après chaque modification
function sauverDemo() {
  const d = { notes: S.notes, decs: S.decs, cats: S.cats, lastRecapAt: S.lastRecapAt, lastAnkiAt: S.lastAnkiAt };
  try { localStorage.setItem("etc-demo", JSON.stringify(d)); } catch (e) { /* stockage plein ou bloqué */ }
}
function demarrerDemo() {
  let d = {};
  try { d = JSON.parse(localStorage.getItem("etc-demo")) || {}; } catch (e) { /* rien de gardé */ }
  S.notes = d.notes || []; S.decs = d.decs || [];
  S.cats = avecTri(d.cats); S.lastRecapAt = d.lastRecapAt || ""; S.lastAnkiAt = d.lastAnkiAt || "";
  uid = "demo"; S.compte = "Mode démo (données sur cet appareil seulement)";
  demarrerAffichage();
}
const avecTri = cats => [TRI, ...(Array.isArray(cats) ? cats : []).filter(c => c && c !== TRI)];

// Indicateur de synchro (affiché dans Réglages › Compte) : synchronisé / en attente / hors ligne
const enAttente = {};
function majSynchro(cle, meta) {
  if (cle) enAttente[cle] = !!(meta && meta.hasPendingWrites);
  const el = $("#sync");
  if (!el) return;
  const etat = MODE_DEMO ? "ok" : !navigator.onLine ? "horsligne" : Object.values(enAttente).some(Boolean) ? "attente" : "ok";
  el.className = "sync " + etat;
  el.textContent = MODE_DEMO ? "démo" : { ok: "synchronisé", attente: "en attente", horsligne: "hors ligne" }[etat];
}
window.addEventListener("online", () => majSynchro());
window.addEventListener("offline", () => majSynchro());

// Un changement venu d'un autre appareil pendant que je tape : on attend que j'aie fini.
let renduEnAttente = false;
function rerendre() {
  if (!S.pret) return;
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { renduEnAttente = true; return; }
  if ($("#modal").innerHTML) { renduEnAttente = true; return; } // une fiche est ouverte : on la laisse tranquille
  render();
}
document.addEventListener("focusout", () => { if (renduEnAttente) setTimeout(() => { renduEnAttente = false; rerendre(); }, 50); });

// Transforme en texte toujours dans le même ordre : sert à voir si quelque chose a vraiment changé
const enTexte = v => JSON.stringify(v, (k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x);

function ecouter() {
  const attendus = new Set(["notes", "decisions", "donnees"]);
  const premier = cle => { if (attendus.delete(cle) && !attendus.size) demarrerAffichage(); };
  ["notes", "decisions"].forEach(nom => {
    arrets.push(onSnapshot(coll(nom), { includeMetadataChanges: true }, snap => {
      majSynchro(nom, snap.metadata);
      const recu = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      if (enTexte(recu) !== enTexte(S[TABLE[nom]])) { S[TABLE[nom]] = recu; rerendre(); }
      premier(nom);
    }, err => { console.error(err); toast("Accès refusé aux données"); }));
  });
  arrets.push(onSnapshot(refDonnees(), { includeMetadataChanges: true }, snap => {
    majSynchro("donnees", snap.metadata);
    const d = snap.exists() ? snap.data() : {};
    S.cats = avecTri(d.cats); S.lastRecapAt = d.lastRecapAt || ""; S.lastAnkiAt = d.lastAnkiAt || "";
    rerendre();
    premier("donnees");
  }, err => console.error(err)));
}

function demarrerFirebase() {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // Cache local permanent : l'appli marche hors ligne avec la dernière copie connue
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  onAuthStateChanged(auth, user => {
    arrets.forEach(f => f()); arrets = [];
    if (!user) { uid = null; S.pret = false; renderConnexion(); return; }
    uid = user.uid;
    S.compte = user.displayName || user.email || "";
    ecouter();
  });
}

async function seConnecter(btn) {
  const fournisseur = new GoogleAuthProvider();
  btn.disabled = true;
  try { await signInWithPopup(auth, fournisseur); }
  catch (e) {
    // Fenêtre de connexion bloquée : on passe par une redirection
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") signInWithRedirect(auth, fournisseur);
    else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") toast("Connexion impossible (" + e.code + ")");
  } finally { btn.disabled = false; }
}
function renderConnexion() {
  $("#onglets").hidden = true;
  $("#main").innerHTML = `<div class="connexion"><p>Connecte-toi pour retrouver ton carnet sur tous tes appareils.</p>
    <button class="btn prim" data-act="connexion">Se connecter avec Google</button></div>`;
}

function demarrerAffichage() {
  S.pret = true;
  $("#onglets").hidden = false;
  if (PARTAGE) { const p = PARTAGE; PARTAGE = ""; S.onglet = "notes"; ajouterNote(p, TRI); }
  render();
}

/* ---------- 3. Petits outils ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const maintenant = () => new Date().toISOString();
const deux = n => String(n).padStart(2, "0");
const jourIso = d => d.getFullYear() + "-" + deux(d.getMonth() + 1) + "-" + deux(d.getDate()); // date locale AAAA-MM-JJ
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
// « 2026-11-15 » ou une date ISO -> « 15 nov. » (+ l'année si ce n'est pas celle-ci)
function dateCourte(v) {
  if (!v) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + "T12:00") : new Date(v);
  if (isNaN(d)) return "";
  return d.getDate() + " " + MOIS[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : "");
}
// Nombre de jours d'aujourd'hui jusqu'à la date « AAAA-MM-JJ » (négatif = passée)
const joursAvant = iso => Math.round((Date.parse(iso + "T12:00") - Date.parse(jourIso(new Date()) + "T12:00")) / 864e5);
function nouvelId() { try { return crypto.randomUUID().replace(/-/g, "").slice(0, 16); } catch (e) { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); } }
const sansAccent = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const recherche = t => "https://www.google.com/search?q=" + encodeURIComponent(t);
// « https://www.site.com/un/chemin » -> « site.com/un/chemin » (plus court à lire)
const lienCourt = u => String(u).replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

// Saisie rapide : « Écluses #histoire https://… » -> titre, catégorie, liens
function lireSaisie(brut) {
  let texte = String(brut || "").trim();
  const liens = texte.match(/https?:\/\/\S+/g) || [];
  liens.forEach(l => { texte = texte.replace(l, " "); });
  let cat = null;
  texte = texte.replace(/(^|\s)#([\p{L}][\p{L}\d_-]*)/gu, (m, esp, mot) => {
    const cle = c => sansAccent(c).replace(/[\s_-]/g, "");
    const k = cle(mot);
    // catégorie existante (même sans accents, ou juste le début : #hist -> Histoire), sinon nouvelle
    const trouvee = S.cats.find(c => cle(c) === k) || (k.length >= 3 && S.cats.find(c => cle(c).startsWith(k)));
    cat = trouvee || mot.replace(/[-_]/g, " ").replace(/^./, c => c.toUpperCase());
    return " ";
  });
  texte = texte.replace(/\s+/g, " ").trim();
  if (!texte && liens.length) texte = lienCourt(liens[0]);
  return { titre: texte, liens, cat };
}
function ajouterCat(cat) {
  if (cat && !S.cats.includes(cat)) { S.cats.push(cat); sauverMeta(); }
}

// Échéances rapides des décisions
const ECHEANCES = [["semaine", "Cette semaine"], ["prochaine", "Sem. prochaine"], ["mois", "Fin du mois"], ["3mois", "Dans 3 mois"], ["", "Sans date"]];
function dateEcheance(p) {
  const d = new Date(); const jour = (d.getDay() + 6) % 7; // lundi = 0
  if (p === "semaine") d.setDate(d.getDate() + (6 - jour));
  else if (p === "prochaine") d.setDate(d.getDate() + (13 - jour));
  else if (p === "mois") d.setMonth(d.getMonth() + 1, 0);
  else if (p === "3mois") d.setMonth(d.getMonth() + 3);
  else return "";
  return jourIso(d);
}
// Couleur et texte d'échéance : orange à 3 jours, rouge en retard
function etatEcheance(d) {
  if (d.status === "decided") return { cls: "tranchee", txt: "tranchée " + dateCourte(d.decidedAt) };
  if (!d.due) return { cls: "", txt: "sans date" };
  const n = joursAvant(d.due);
  if (n < 0) return { cls: "retard", txt: "en retard · " + dateCourte(d.due) };
  if (n === 0) return { cls: "bientot", txt: "aujourd’hui" };
  if (n === 1) return { cls: "bientot", txt: "demain" };
  if (n <= 3) return { cls: "bientot", txt: "dans " + n + " j · " + dateCourte(d.due) };
  return { cls: "", txt: dateCourte(d.due) };
}
const urgentes = () => S.decs.filter(d => d.status !== "decided" && d.due && joursAvant(d.due) <= 3);

// Message en bas de l'écran ; avec « annuler », un bouton Annuler pendant quelques secondes
let toastT;
function toast(msg, annuler) {
  let t = $(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.innerHTML = "";
  const s = document.createElement("span"); s.textContent = msg; t.appendChild(s);
  if (annuler) {
    const b = document.createElement("button"); b.textContent = "Annuler";
    b.onclick = () => { t.hidden = true; annuler(); };
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, annuler ? 6000 : 2800);
}
const plur = (n, mot) => n + " " + mot + (n > 1 ? "s" : "");

/* ---------- 4. Écrans ---------- */

function render() {
  if (!S.pret) return;
  document.querySelectorAll("[data-onglet]").forEach(b => b.classList.toggle("on", b.dataset.onglet === S.onglet));
  // bouton Modifier : crayon, ou coche « Terminé » quand le mode est actif
  const bm = $('[data-act="modifier"]');
  bm.classList.toggle("on", S.modif);
  bm.innerHTML = `<svg><use href="#${S.modif ? "i-ok" : "i-mod"}"/></svg>`;
  $('[data-act="chercher"]').classList.toggle("on", S.recherche);
  const nb = urgentes().length;
  $("#badge").hidden = !nb; $("#badge").textContent = nb;
  $("#point").hidden = !recapAProposer();
  $("#main").innerHTML = S.onglet === "decisions" ? ecranDecisions() : S.onglet === "semaine" ? ecranSemaine() : ecranNotes();
}

// Champ de recherche (affiché par la loupe en haut)
const barreRecherche = ph => S.recherche ? `<div class="ajout"><input class="champ" id="q" type="search" placeholder="${ph}" value="${esc(S.q)}" autocomplete="off"></div>` : "";
const correspond = (o, ...champs) => { const q = sansAccent(S.q).trim(); return !q || champs.some(c => sansAccent(Array.isArray(o[c]) ? o[c].join(" ") : o[c]).includes(q)); };

/* Notes */
function notesFiltrees() {
  const f = S.filtre;
  let l = S.notes.filter(n => f === "__arch" ? n.archived : !n.archived);
  if (f === "__fav") l = l.filter(n => n.fav);
  else if (f !== "Tout" && f !== "__arch") l = l.filter(n => n.cat === f);
  if (S.recherche && S.q.trim()) l = S.notes.filter(n => correspond(n, "title", "note", "links", "cat")); // la recherche fouille tout, archives comprises
  return l.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); // les plus récentes en haut
}
function ligneNote(n) {
  return `<button class="ligne ${n.archived ? "archivee" : ""}" data-act="note" data-id="${esc(n.id)}">
    ${n.pinned ? `<svg class="pin"><use href="#i-pin"/></svg>` : ""}
    <span class="t">${esc(n.title)}</span>
    ${n.fav ? `<svg class="fav"><use href="#i-etoile"/></svg>` : ""}
    ${n.links && n.links.length ? `<svg><use href="#i-lien"/></svg>` : ""}
    <span class="c">${esc(n.cat)}</span>
    ${S.modif ? `<span class="suppr" data-act="suppr-note" data-id="${esc(n.id)}" role="button" aria-label="Supprimer"><svg><use href="#i-croix"/></svg></span>` : ""}
  </button>`;
}
function ecranNotes() {
  if (S.filtre !== "Tout" && !S.filtre.startsWith("__") && !S.cats.includes(S.filtre)) S.filtre = "Tout";
  const aTrier = S.notes.filter(n => !n.archived && n.cat === TRI).length;
  const puce = (v, contenu) => `<button class="f ${S.filtre === v ? "on" : ""}" data-act="filtre" data-v="${esc(v)}">${contenu}</button>`;
  const filtres = puce("Tout", "Tout") + S.cats.map(c => puce(c, esc(c) + (c === TRI && aTrier ? ` <small>${aTrier}</small>` : ""))).join("")
    + puce("__fav", `<svg><use href="#i-etoile"/></svg>`) + puce("__arch", `<svg><use href="#i-archive"/></svg>`);
  const l = notesFiltrees();
  const epinglees = l.filter(n => n.pinned && !n.archived), autres = l.filter(n => !(n.pinned && !n.archived));
  const corps = !l.length ? `<div class="vide">${S.q.trim() && S.recherche ? "Rien trouvé" : "Aucune note"}</div>`
    : (epinglees.length ? `<div class="sec">Épinglées</div>${epinglees.map(ligneNote).join("")}<div class="sec">Notes</div>` : "") + autres.map(ligneNote).join("");
  return barreRecherche("Rechercher une note…") + `
    <div class="ajout"><input class="champ" id="nouvelle" placeholder="Une idée… #catégorie" autocomplete="off" enterkeyhint="done">
      <button class="plus" data-act="ajouter-note" aria-label="Ajouter"><svg><use href="#i-plus"/></svg></button></div>
    <div class="filtres">${filtres}</div>
    <div class="liste">${corps}</div>`;
}
// Ajoute une note depuis la saisie rapide (ou un partage Android)
function ajouterNote(brut, catParDefaut) {
  const p = lireSaisie(brut);
  if (!p.titre) return false;
  const cat = p.cat || catParDefaut || TRI;
  ajouterCat(cat);
  const t = maintenant();
  ecrire("notes", { id: nouvelId(), title: p.titre, cat, note: "", links: p.liens, fav: false, pinned: false, archived: false,
    createdAt: t, updatedAt: t, anki: { on: false, front: p.titre, back: "", at: t } });
  toast("Ajoutée dans « " + cat + " »");
  return true;
}

/* Décisions */
function ligneDec(d) {
  const e = etatEcheance(d);
  return `<button class="ligne dec ${e.cls}" data-act="dec" data-id="${esc(d.id)}">
    <span class="t">${esc(d.title)}</span><span class="e">${esc(e.txt)}</span>
    ${S.modif ? `<span class="suppr" data-act="suppr-dec" data-id="${esc(d.id)}" role="button" aria-label="Supprimer"><svg><use href="#i-croix"/></svg></span>` : ""}
  </button>`;
}
const parEcheance = (a, b) => (a.due || "9999").localeCompare(b.due || "9999") || String(a.createdAt).localeCompare(String(b.createdAt));
function ecranDecisions() {
  const arch = S.filtreDec === "arch";
  let l = S.decs.filter(d => arch ? d.status === "decided" : d.status !== "decided");
  if (S.recherche && S.q.trim()) l = S.decs.filter(d => correspond(d, "title", "note", "outcome", "links"));
  l.sort(arch && !S.q.trim() ? (a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)) : parEcheance);
  return barreRecherche("Rechercher une décision…") + `
    <div class="ajout"><input class="champ" id="nouvelle-dec" placeholder="Une décision à prendre…" autocomplete="off" enterkeyhint="next">
      <button class="plus" data-act="ajouter-dec" aria-label="Ajouter"><svg><use href="#i-plus"/></svg></button></div>
    <div class="filtres"><button class="f ${!arch ? "on" : ""}" data-act="filtre-dec" data-v="cours">En cours</button>
      <button class="f ${arch ? "on" : ""}" data-act="filtre-dec" data-v="arch">Archivées</button></div>
    <div class="liste">${l.length ? l.map(ligneDec).join("") : `<div class="vide">${arch ? "Aucune décision tranchée" : "Aucune décision en attente"}</div>`}</div>`;
}

/* Ma semaine : les 7 derniers jours d'un coup d'œil (+ PDF) */
const ilYa = j => Date.now() - j * 864e5;
// Le point bleu sur l'onglet : plus de 7 jours depuis le dernier passage sur « Ma semaine »
const recapAProposer = () => S.notes.length > 0 && (!S.lastRecapAt || Date.parse(S.lastRecapAt) < ilYa(7));
function donneesSemaine() {
  const debut = ilYa(7);
  const actives = S.notes.filter(n => !n.archived);
  // « Et si tu relisais… » : 3 notes de plus de 10 jours, tirées au hasard (gardées jusqu'au prochain mélange)
  const vieilles = actives.filter(n => Date.parse(n.createdAt) < ilYa(10));
  if (!S.pick || S.pick.some(id => !vieilles.some(n => n.id === id)) || (S.pick.length < 3 && vieilles.length > S.pick.length))
    S.pick = vieilles.map(n => n.id).sort(() => Math.random() - .5).slice(0, 3);
  return {
    debut,
    ajouts: S.notes.filter(n => Date.parse(n.createdAt) >= debut).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    aTrier: actives.filter(n => n.cat === TRI),
    ouvertes: S.decs.filter(d => d.status !== "decided").sort(parEcheance),
    tranchees: S.decs.filter(d => d.status === "decided" && Date.parse(d.decidedAt) >= debut),
    relire: S.pick.map(id => S.notes.find(n => n.id === id)).filter(Boolean)
  };
}
function ecranSemaine() {
  const w = donneesSemaine();
  const urg = urgentes().length;
  const sec = (titre, l, f) => l.length ? `<div class="sec">${titre}</div>${l.map(f).join("")}` : "";
  return `<div class="tete-sem"><span>Du ${dateCourte(new Date(w.debut).toISOString())} au ${dateCourte(maintenant())}</span>
      <button class="btn" data-act="pdf"><svg><use href="#i-pdf"/></svg>PDF</button></div>
    <div class="chiffres"><div><b>${w.ajouts.length}</b>ajouts</div><div><b>${w.aTrier.length}</b>à trier</div>
      <div class="${urg ? "alerte" : ""}"><b>${urg}</b>urgentes</div></div>
    <div class="liste">
      ${sec("Décisions à prendre", w.ouvertes, ligneDec)}
      ${w.relire.length ? `<div class="sec" style="display:flex;align-items:center">Et si tu relisais…<span style="flex:1"></span>
        <button class="f" data-act="melanger" aria-label="Autres sujets"><svg><use href="#i-melange"/></svg></button></div>${w.relire.map(ligneNote).join("")}` : ""}
      ${sec("Ajouts de la semaine", w.ajouts, ligneNote)}
      ${sec("Tranchées cette semaine", w.tranchees, ligneDec)}
      ${!w.ouvertes.length && !w.ajouts.length && !w.relire.length ? `<div class="vide">Semaine calme</div>` : ""}
    </div>`;
}
// PDF : on prépare une page de récap en noir sur blanc, puis on ouvre l'impression
// (sur le téléphone : « Enregistrer au format PDF »). Pas de bibliothèque à charger.
function imprimerRecap() {
  const w = donneesSemaine();
  const lien = (t, u) => `<a href="${esc(u)}">${esc(t)}</a>`;
  const liens = o => (o.links || []).map(u => `<br><span class="m">${lien(lienCourt(u), u)}</span>`).join("");
  const li = (l, f) => l.length ? `<ul>${l.map(f).join("")}</ul>` : `<p class="m">Rien.</p>`;
  $("#impression").innerHTML = `<h1>etC. — ma semaine</h1>
    <div class="m">Du ${dateCourte(new Date(w.debut).toISOString())} au ${dateCourte(maintenant())} · ${plur(w.ajouts.length, "ajout")} · ${w.aTrier.length} à trier · ${plur(w.ouvertes.length, "décision")} en attente</div>
    <h2>Décisions à prendre</h2>${li(w.ouvertes, d => { const e = etatEcheance(d); return `<li><b>${lien(d.title, recherche(d.title))}</b> — <span class="${e.cls === "retard" ? "r" : "m"}">${esc(e.txt)}</span>${d.note ? `<br><span class="m">${esc(d.note.slice(0, 300))}</span>` : ""}${liens(d)}</li>`; })}
    ${w.tranchees.length ? `<h2>Tranché cette semaine</h2>${li(w.tranchees, d => `<li><b>${esc(d.title)}</b>${d.outcome ? ` → ${esc(d.outcome)}` : ""}</li>`)}` : ""}
    <h2>Ajouts de la semaine</h2>${li(w.ajouts, n => `<li><b>${lien(n.title, recherche(n.title))}</b> <span class="m">· ${esc(n.cat)} · ${dateCourte(n.createdAt)}</span>${n.note ? `<br><span class="m">${esc(n.note.slice(0, 300))}</span>` : ""}${liens(n)}</li>`)}
    ${w.relire.length ? `<h2>À relire</h2>${li(w.relire, n => `<li>${lien(n.title, recherche(n.title))} <span class="m">· ${esc(n.cat)}</span></li>`)}` : ""}
    ${w.aTrier.length ? `<h2>À trier (${w.aTrier.length})</h2>${li(w.aTrier, n => `<li>${esc(n.title)}</li>`)}` : ""}`;
  window.print();
}

/* ---------- 5. Fiches et formulaires ---------- */
let ouvert = null; // ce qui est ouvert dans le pop-up : { type, id }
const premiereOuverture = () => !$("#modal").innerHTML; // l'animation d'ouverture ne joue qu'à la vraie ouverture
function popup(html) {
  const neuf = premiereOuverture();
  $("#modal").innerHTML = `<div class="voile" data-act="fermer-fond" ${neuf ? "" : 'style="animation:none"'}><div class="panneau" ${neuf ? "" : 'style="animation:none"'}>${html}</div></div>`;
}
function fermer() {
  $("#modal").innerHTML = ""; ouvert = null;
  if (renduEnAttente) renduEnAttente = false;
  render();
}
const blocLiens = o => o.links && o.links.length ? `<div class="carte liens">${o.links.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><svg><use href="#i-lien"/></svg><span>${esc(lienCourt(u))}</span></a>`).join("")}</div>` : "";
const blocNote = o => o.note ? `<div class="carte texte">${esc(o.note)}</div>` : "";
const bouton = (act, icone, txt, on) => `<button class="btn large ${on ? "on" : ""}" data-act="${act}"><svg><use href="#${icone}"/></svg>${txt}</button>`;

// Fiche d'une note (mode normal) : lire + actions courantes
function ficheNote(id) {
  const n = S.notes.find(x => x.id === id); if (!n) return fermer();
  ouvert = { type: "note", id };
  popup(`<h2>${esc(n.title)}</h2>
    <div class="meta" style="margin:-4px 0 8px">${esc(n.cat)} · ajoutée le ${dateCourte(n.createdAt)}${n.archived ? " · archivée" : ""}</div>
    <div style="display:grid;gap:6px">${blocNote(n)}${blocLiens(n)}</div>
    <div class="actions">${bouton("google", "i-google", "Chercher")}${bouton("epingler", "i-pin", n.pinned ? "Épinglée" : "Épingler", n.pinned)}</div>
    <div class="actions" style="margin-top:6px">${bouton("favori", "i-etoile", "Favori", n.fav)}${bouton("archiver", "i-archive", n.archived ? "Archivée" : "Archiver", n.archived)}</div>`);
}
// Fiche d'une décision : lire + trancher
function ficheDec(id) {
  const d = S.decs.find(x => x.id === id); if (!d) return fermer();
  ouvert = { type: "dec", id };
  const e = etatEcheance(d), fini = d.status === "decided";
  popup(`<h2>${esc(d.title)}</h2>
    <div class="meta" style="margin:-4px 0 8px">${fini ? esc(e.txt) : "Échéance : " + esc(e.txt)}</div>
    <div style="display:grid;gap:6px">${blocNote(d)}${blocLiens(d)}</div>
    <div class="lbl">Ce que j’ai décidé</div>
    <textarea class="champ" id="issue" rows="3" style="width:100%">${esc(d.outcome)}</textarea>
    <div class="actions">${bouton("google", "i-google", "Chercher")}
      ${fini ? `<button class="btn large" data-act="rouvrir">Rouvrir</button>` : `<button class="btn large prim" data-act="trancher"><svg><use href="#i-ok"/></svg>Trancher</button>`}</div>`);
}

// Formulaire de modification d'une note (mode Modifier)
function formNote(id) {
  const n = S.notes.find(x => x.id === id); if (!n) return fermer();
  ouvert = { type: "form-note", id };
  const a = n.anki || {};
  popup(`<h2>Modifier la note</h2><div class="form">
    <div class="lbl">Titre</div><input class="champ" id="f-titre" value="${esc(n.title)}" autocomplete="off">
    <div class="lbl">Catégorie</div><select class="champ" id="f-cat">${S.cats.map(c => `<option ${c === n.cat ? "selected" : ""}>${esc(c)}</option>`).join("")}<option value="__nouvelle">+ Nouvelle catégorie…</option></select>
    <input class="champ" id="f-cat-neuve" placeholder="Nom de la catégorie" hidden style="margin-top:6px" autocomplete="off">
    <div class="lbl">Note</div><textarea class="champ" id="f-note" rows="4">${esc(n.note)}</textarea>
    <div class="lbl">Liens (un par ligne)</div><textarea class="champ" id="f-liens" rows="2">${esc((n.links || []).join("\n"))}</textarea>
    <div class="lbl">Anki</div>
    <button class="rangee" data-act="anki-interr" type="button"><span>Carte Anki</span><span class="interr ${a.on ? "on" : ""}" id="f-anki"></span></button>
    <div id="f-anki-zone" ${a.on ? "" : "hidden"}>
      <input class="champ" id="f-recto" placeholder="Recto" value="${esc(a.front || n.title)}" style="margin-bottom:6px" autocomplete="off">
      <textarea class="champ" id="f-verso" rows="3" placeholder="Verso">${esc(a.back)}</textarea></div>
    <div class="pied"><button class="btn danger" data-act="suppr-note" data-id="${esc(n.id)}" style="margin-right:auto">Supprimer</button>
      <button class="btn" data-act="fermer">Annuler</button><button class="btn prim" data-act="enreg-note">Enregistrer</button></div></div>`);
}
function enregistrerNote() {
  const n = S.notes.find(x => x.id === ouvert.id); if (!n) return fermer();
  const titre = $("#f-titre").value.trim();
  if (!titre) return toast("Il faut un titre");
  let cat = $("#f-cat").value;
  if (cat === "__nouvelle") { cat = $("#f-cat-neuve").value.trim() || TRI; ajouterCat(cat); }
  const a = n.anki || {}, on = $("#f-anki").classList.contains("on");
  const recto = on ? $("#f-recto").value.trim() : (a.front || titre), verso = on ? $("#f-verso").value : (a.back || "");
  // « at » = date de la dernière modif de la carte : sert à exporter seulement les nouvelles cartes
  const changeAnki = on !== !!a.on || recto !== a.front || verso !== a.back;
  ecrire("notes", Object.assign({}, n, {
    title: titre, cat, note: $("#f-note").value.trim(), links: $("#f-liens").value.split(/\s+/).filter(u => /^https?:\/\//.test(u)),
    anki: { on, front: recto, back: verso, at: changeAnki ? maintenant() : (a.at || maintenant()) }, updatedAt: maintenant()
  }));
  fermer(); toast("Enregistré");
}

// Formulaire d'une décision : nouvelle (titre déjà tapé) ou modification (mode Modifier)
function formDec(id, titre) {
  const d = id ? S.decs.find(x => x.id === id) : { title: titre || "", due: "", note: "", links: [], outcome: "", status: "open" };
  if (!d) return fermer();
  ouvert = { type: "form-dec", id: id || null };
  popup(`<h2>${id ? "Modifier la décision" : "Nouvelle décision"}</h2><div class="form">
    <div class="lbl">Décision à prendre</div><input class="champ" id="f-titre" value="${esc(d.title)}" autocomplete="off">
    <div class="lbl">Échéance</div>
    <div class="puces">${ECHEANCES.map(([v, l]) => `<button class="f ${dateEcheance(v) === (d.due || "") ? "on" : ""}" data-act="echeance" data-v="${v}" type="button">${l}</button>`).join("")}</div>
    <input class="champ" type="date" id="f-due" value="${esc(d.due)}" style="margin-top:6px">
    <div class="lbl">Note</div><textarea class="champ" id="f-note" rows="3">${esc(d.note)}</textarea>
    <div class="lbl">Liens (un par ligne)</div><textarea class="champ" id="f-liens" rows="2">${esc((d.links || []).join("\n"))}</textarea>
    ${d.status === "decided" ? `<div class="lbl">Ce que j’ai décidé</div><textarea class="champ" id="f-issue" rows="2">${esc(d.outcome)}</textarea>` : ""}
    <div class="pied">${id ? `<button class="btn danger" data-act="suppr-dec" data-id="${esc(id)}" style="margin-right:auto">Supprimer</button>` : ""}
      <button class="btn" data-act="fermer">Annuler</button><button class="btn prim" data-act="enreg-dec">Enregistrer</button></div></div>`);
  if (!id && !d.title) setTimeout(() => $("#f-titre") && $("#f-titre").focus(), 50); // titre vide : on y place le curseur
}
function enregistrerDec() {
  const titre = $("#f-titre").value.trim();
  if (!titre) return toast("Il faut un titre");
  const t = maintenant();
  const avant = ouvert.id ? S.decs.find(x => x.id === ouvert.id) : { id: nouvelId(), status: "open", decidedAt: "", outcome: "", createdAt: t };
  if (!avant) return fermer();
  ecrire("decisions", Object.assign({}, avant, {
    title: titre, due: $("#f-due").value || "", note: $("#f-note").value.trim(),
    links: $("#f-liens").value.split(/\s+/).filter(u => /^https?:\/\//.test(u)),
    outcome: $("#f-issue") ? $("#f-issue").value.trim() : avant.outcome, updatedAt: t
  }));
  const nouveau = !ouvert.id;
  fermer(); toast(nouveau ? "Décision ajoutée" : "Enregistré");
}

// Suppression avec « Annuler » pendant quelques secondes
function supprimer(nom, id) {
  const l = S[TABLE[nom]], o = l.find(x => x.id === id); if (!o) return;
  effacer(nom, id);
  if ($("#modal").innerHTML) { $("#modal").innerHTML = ""; ouvert = null; }
  render();
  toast(nom === "notes" ? "Note supprimée" : "Décision supprimée", () => { ecrire(nom, o); render(); });
}

/* ---------- 6. Réglages ---------- */
const THEMES = [["auto", "Auto", "Suit le téléphone / PC"], ["clair", "Clair", "Papier + encre bleue"], ["sombre", "Sombre", "Ardoise + pastel"]];
let importPret = null; // données lues dans un fichier Excel, en attente de confirmation

function ouvrirReglages() {
  ouvert = { type: "reglages" }; importPret = null;
  const r = reglagesLocaux();
  const theme = THEMES.find(t => t[0] === (r.theme || "auto"))[1];
  const anim = r.anim === "simples" ? "simples" : "completes";
  const nouvellesCartes = S.notes.filter(n => n.anki && n.anki.on && (!S.lastAnkiAt || String(n.anki.at) > S.lastAnkiAt)).length;
  popup(`<h2>Réglages</h2>
    <div class="lbl">Apparence</div>
    <button class="rangee" data-act="themes"><span>Thème</span><span class="meta">${theme} ›</span></button>
    <div class="rangee"><span>Animations</span><span class="puces">
      <button class="f ${anim === "completes" ? "on" : ""}" data-act="anim" data-v="completes">Complètes</button>
      <button class="f ${anim === "simples" ? "on" : ""}" data-act="anim" data-v="simples">Simples</button></span></div>
    <div class="lbl">Contenu</div>
    <button class="rangee" data-act="cats"><span>Catégories</span><span class="meta">Voir… ›</span></button>
    <div class="lbl">Anki</div>
    <div class="duo"><button class="btn" data-act="anki" data-v="nouvelles">Nouvelles cartes${nouvellesCartes ? " (" + nouvellesCartes + ")" : ""}</button>
      <button class="btn" data-act="anki" data-v="toutes">Toutes</button></div>
    <div class="lbl">Excel</div>
    <div class="duo"><button class="btn" data-act="exporter">Exporter</button>
      <label class="btn">Importer<input type="file" id="fichier" accept=".xlsx" hidden></label></div>
    <div id="imp"></div>
    <div class="lbl">Compte</div>
    <div class="carte"><div style="display:flex;align-items:center;gap:8px"><span class="meta" style="flex:1;overflow:hidden;text-overflow:ellipsis">${esc(S.compte)}</span>
      ${MODE_DEMO ? "" : `<button class="btn" data-act="deconnexion">Se déconnecter</button>`}</div>
      <div style="display:flex;align-items:center;margin-top:6px"><span class="meta" style="flex:1">Synchro</span><span id="sync" class="sync"></span></div></div>
    <div class="version">Version ${VERSION}</div>
    <div class="pied"><button class="btn" data-act="fermer">Fermer</button></div>`);
  majSynchro();
}
function ouvrirThemes() {
  ouvert = { type: "themes" };
  const cur = reglagesLocaux().theme || "auto";
  popup(`<button class="retour" data-act="reglages">‹ Réglages</button><h2>Thème</h2>
    ${THEMES.map(([v, nom, desc]) => `<button class="rangee" data-act="theme" data-v="${v}"><span><b>${nom}</b><br><span class="meta">${desc}</span></span>
      ${v === cur ? `<svg style="color:var(--acc)"><use href="#i-ok"/></svg>` : ""}</button>`).join("")}`);
}
// Catégories : renommer, supprimer (ses notes vont dans « À trier »), ajouter
function ouvrirCats() {
  ouvert = { type: "cats" };
  popup(`<button class="retour" data-act="reglages">‹ Réglages</button><h2>Catégories</h2>
    <div class="cat-ligne"><input class="champ" value="${esc(TRI)}" disabled></div>
    ${S.cats.filter(c => c !== TRI).map(c => `<div class="cat-ligne"><input class="champ" data-cat="${esc(c)}" value="${esc(c)}" autocomplete="off">
      <button class="ic" data-act="suppr-cat" data-v="${esc(c)}" aria-label="Supprimer"><svg style="color:var(--rouge)"><use href="#i-croix"/></svg></button></div>`).join("")}
    <div class="cat-ligne" style="margin-top:10px"><input class="champ" id="cat-neuve" placeholder="Nouvelle catégorie" autocomplete="off">
      <button class="plus" data-act="ajout-cat" aria-label="Ajouter"><svg><use href="#i-plus"/></svg></button></div>`);
}
function renommerCat(ancien, nouveau) {
  nouveau = nouveau.trim();
  if (!nouveau || nouveau === ancien) return;
  if (S.cats.includes(nouveau)) { toast("Cette catégorie existe déjà"); return ouvrirCats(); }
  S.cats = S.cats.map(c => c === ancien ? nouveau : c); sauverMeta();
  S.notes.filter(n => n.cat === ancien).forEach(n => ecrire("notes", Object.assign({}, n, { cat: nouveau, updatedAt: maintenant() })));
  if (S.filtre === ancien) S.filtre = nouveau;
  ouvrirCats(); toast("Renommée");
}
function supprimerCat(c) {
  const concernees = S.notes.filter(n => n.cat === c);
  S.cats = S.cats.filter(x => x !== c); sauverMeta();
  concernees.forEach(n => ecrire("notes", Object.assign({}, n, { cat: TRI, updatedAt: maintenant() })));
  ouvrirCats();
  toast("Catégorie supprimée", () => {
    S.cats.push(c); sauverMeta();
    concernees.forEach(n => ecrire("notes", Object.assign({}, n, { cat: c })));
    ouvrirCats();
  });
}

// Petit outil : télécharger un fichier préparé dans l'appli
function telecharger(nom, contenu, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([contenu], { type }));
  a.download = nom; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// Anki : fichier texte « séparé par des tabulations » que Anki sait importer.
// La 4e colonne (identifiant « carnet-<id> ») évite les doublons quand on réimporte.
function exporterAnki(seulementNouvelles) {
  let cartes = S.notes.filter(n => n.anki && n.anki.on);
  if (seulementNouvelles && S.lastAnkiAt) cartes = cartes.filter(n => String(n.anki.at) > S.lastAnkiAt);
  if (!cartes.length) return toast(seulementNouvelles ? "Aucune nouvelle carte" : "Aucune carte Anki");
  const h = s => esc(s).replace(/\t/g, " ").replace(/\r?\n/g, "<br>");
  const lignes = ["#separator:tab", "#html:true", "#deck:Carnet de vrac", "#tags column:3", "#guid column:4"];
  cartes.forEach(n => {
    let verso = h(n.anki.back || "");
    const liens = (n.links || []).map(u => `<a href="${esc(u)}">${esc(lienCourt(u))}</a>`).join("<br>");
    if (liens) verso += (verso ? "<br><br>" : "") + liens;
    lignes.push([h(n.anki.front || n.title), verso, ["carnet", n.cat.replace(/\s+/g, "_")].join(" "), "carnet-" + n.id].join("\t"));
  });
  telecharger(`etc-anki_${jourIso(new Date())}.txt`, lignes.join("\n") + "\n", "text/plain;charset=utf-8");
  S.lastAnkiAt = maintenant(); sauverMeta();
  toast(plur(cartes.length, "carte") + " exportée" + (cartes.length > 1 ? "s" : ""));
}

/* Excel : colonnes de chaque feuille (clé dans l'appli, en-tête dans Excel, largeur) */
const COL_NOTES = [["id", "ID", 18], ["title", "Titre", 36], ["cat", "Catégorie", 14], ["note", "Note", 40], ["links", "Liens", 40],
  ["pinned", "Épinglée", 10], ["fav", "Favori", 9], ["archived", "Archivée", 10], ["ankiOn", "Anki", 8], ["ankiFront", "Recto", 30], ["ankiBack", "Verso", 30],
  ["createdAt", "Créée le", 17], ["updatedAt", "Modifiée le", 17]];
const COL_DECS = [["id", "ID", 18], ["title", "Décision", 36], ["due", "Échéance", 12], ["status", "Statut", 11], ["decidedAt", "Tranchée le", 17],
  ["outcome", "Ce que j'ai décidé", 36], ["note", "Note", 36], ["links", "Liens", 36], ["createdAt", "Créée le", 17], ["updatedAt", "Modifiée le", 17]];
// Date ISO -> « 2026-11-02 11:00 » (heure locale, lisible dans Excel) et retour
const versTexteDate = iso => { const d = new Date(iso); return iso && !isNaN(d) ? jourIso(d) + " " + deux(d.getHours()) + ":" + deux(d.getMinutes()) : ""; };
const depuisTexteDate = t => { const d = new Date(String(t || "").trim().replace(" ", "T")); return t && !isNaN(d) ? d.toISOString() : ""; };
const oui = v => /^(oui|vrai|true|1|x)$/i.test(String(v || "").trim());

async function construireClasseur() {
  const ExcelJS = await chargerExcelJS();
  const wb = new ExcelJS.Workbook();
  const feuille = (nom, cols, lignes) => {
    const ws = ajouterFeuille(wb, nom, cols.map(([k, h, w]) => ({ header: h, key: k, width: w })), lignes);
    ws.eachRow((r, i) => { if (i > 1) r.eachCell(c => { c.alignment = { vertical: "top", wrapText: true }; }); });
  };
  feuille("Notes", COL_NOTES, S.notes.slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(n => ({
    id: n.id, title: n.title, cat: n.cat, note: n.note || "", links: (n.links || []).join("\n"),
    pinned: n.pinned ? "Oui" : "", fav: n.fav ? "Oui" : "", archived: n.archived ? "Oui" : "",
    ankiOn: n.anki && n.anki.on ? "Oui" : "", ankiFront: n.anki ? n.anki.front || "" : "", ankiBack: n.anki ? n.anki.back || "" : "",
    createdAt: versTexteDate(n.createdAt), updatedAt: versTexteDate(n.updatedAt)
  })));
  feuille("Décisions", COL_DECS, S.decs.slice().sort(parEcheance).map(d => ({
    id: d.id, title: d.title, due: d.due || "", status: d.status === "decided" ? "Tranchée" : "En cours", decidedAt: versTexteDate(d.decidedAt),
    outcome: d.outcome || "", note: d.note || "", links: (d.links || []).join("\n"), createdAt: versTexteDate(d.createdAt), updatedAt: versTexteDate(d.updatedAt)
  })));
  feuille("Catégories", [["nom", "Catégorie", 24]], S.cats.map(c => ({ nom: c })));
  return wb;
}
async function exporterExcel(btn) {
  btn.disabled = true; btn.textContent = "Préparation…";
  try { await telechargerClasseur(await construireClasseur(), NOM_APPLI); toast("Fichier Excel prêt"); }
  catch (e) { toast("Export impossible : " + e.message); }
  finally { btn.disabled = false; btn.textContent = "Exporter"; }
}
// Import : lit le fichier, montre ce qui va être restauré, puis attend « Importer »
async function lireImport(fichier) {
  const zone = $("#imp");
  zone.innerHTML = `<div class="meta" style="margin-top:6px">Lecture…</div>`;
  try {
    const wb = await lireClasseur(fichier);
    const h = (cols, ligne) => Object.fromEntries(cols.map(([k, t]) => [k, ligne[t] || ""]));
    const notes = lireFeuille(wb.getWorksheet("Notes")).map(l => h(COL_NOTES, l)).filter(n => n.title).map(n => {
      const t = depuisTexteDate(n.createdAt) || maintenant();
      return { id: idPropre(n.id) || nouvelId(), title: n.title, cat: n.cat || TRI, note: n.note, links: n.links.split(/\s+/).filter(u => /^https?:\/\//.test(u)),
        pinned: oui(n.pinned), fav: oui(n.fav), archived: oui(n.archived), createdAt: t, updatedAt: depuisTexteDate(n.updatedAt) || t,
        anki: { on: oui(n.ankiOn), front: n.ankiFront || n.title, back: n.ankiBack, at: depuisTexteDate(n.updatedAt) || t } };
    });
    const decs = lireFeuille(wb.getWorksheet("Décisions")).map(l => h(COL_DECS, l)).filter(d => d.title).map(d => {
      const t = depuisTexteDate(d.createdAt) || maintenant();
      return { id: idPropre(d.id) || nouvelId(), title: d.title, due: /^\d{4}-\d{2}-\d{2}$/.test(d.due) ? d.due : "", status: /tranch/i.test(d.status) ? "decided" : "open",
        decidedAt: depuisTexteDate(d.decidedAt), outcome: d.outcome, note: d.note, links: d.links.split(/\s+/).filter(u => /^https?:\/\//.test(u)),
        createdAt: t, updatedAt: depuisTexteDate(d.updatedAt) || t };
    });
    const cats = lireFeuille(wb.getWorksheet("Catégories")).map(l => (l["Catégorie"] || "").trim()).filter(Boolean);
    if (!notes.length && !decs.length) { zone.innerHTML = `<div class="meta" style="margin-top:6px">Rien à importer dans ce fichier.</div>`; return; }
    importPret = { notes, decs, cats };
    zone.innerHTML = `<div class="carte" style="margin-top:6px"><div>${plur(notes.length, "note")}, ${plur(decs.length, "décision")}</div>
      <div class="meta">Remplace les éléments de même ID, garde les autres.</div>
      <div class="duo" style="margin-top:8px"><button class="btn" data-act="import-annuler">Annuler</button><button class="btn prim" data-act="import-ok">Importer</button></div></div>`;
  } catch (e) { zone.innerHTML = `<div class="meta" style="margin-top:6px">Fichier illisible (${esc(e.message)})</div>`; }
}
const idPropre = id => String(id || "").trim().replace(/\//g, "-").replace(/^\.+$/, "");
function faireImport() {
  if (!importPret) return;
  const { notes, decs, cats } = importPret; importPret = null;
  S.cats = avecTri([...S.cats, ...cats, ...notes.map(n => n.cat)].filter((c, i, t) => t.indexOf(c) === i));
  sauverMeta();
  notes.forEach(n => ecrire("notes", n));
  decs.forEach(d => ecrire("decisions", d));
  fermer();
  toast("Import terminé : " + plur(notes.length, "note") + ", " + plur(decs.length, "décision"));
}

/* ---------- 7. Clics et démarrage ---------- */
document.addEventListener("click", e => {
  const el = e.target.closest("[data-act], [data-onglet]");
  if (!el) return;
  if (el.dataset.onglet) {
    S.onglet = el.dataset.onglet; S.q = "";
    if (S.onglet === "semaine") { S.lastRecapAt = maintenant(); sauverMeta(); } // le point bleu disparaît
    render(); $("#main").scrollTop = 0; return;
  }
  const id = el.dataset.id, v = el.dataset.v;
  const n = ouvert && S.notes.find(x => x.id === ouvert.id), d = ouvert && S.decs.find(x => x.id === ouvert.id);
  switch (el.dataset.act) {
    case "connexion": seConnecter(el); break;
    case "deconnexion": $("#modal").innerHTML = ""; signOut(auth); break;
    case "chercher": S.recherche = !S.recherche; if (!S.recherche) S.q = ""; render(); if (S.recherche) $("#q") && $("#q").focus(); break;
    case "modifier": S.modif = !S.modif; render(); break;
    case "reglages": ouvrirReglages(); break;
    case "filtre": S.filtre = v; render(); break;
    case "filtre-dec": S.filtreDec = v; render(); break;
    case "ajouter-note": { const c = $("#nouvelle"); if (ajouterNote(c.value, S.filtre.startsWith("__") || S.filtre === "Tout" ? TRI : S.filtre)) { c.value = ""; render(); $("#nouvelle").focus(); } break; }
    case "ajouter-dec": { const c = $("#nouvelle-dec"); formDec(null, c.value.trim()); c.value = ""; break; }
    // ligne touchée : fiche en mode normal, formulaire en mode Modifier
    case "note": if (e.target.closest(".suppr")) break; S.modif ? formNote(id) : ficheNote(id); break;
    case "dec": if (e.target.closest(".suppr")) break; S.modif ? formDec(id) : ficheDec(id); break;
    case "suppr-note": e.stopPropagation(); supprimer("notes", id); break;
    case "suppr-dec": e.stopPropagation(); supprimer("decisions", id); break;
    case "fermer": fermer(); break;
    case "fermer-fond": if (e.target === el) fermer(); break;
    // fiche d'une note
    case "google": window.open(recherche((n || d).title), "_blank", "noopener"); break;
    case "epingler": ecrire("notes", Object.assign({}, n, { pinned: !n.pinned, updatedAt: maintenant() })); ficheNote(n.id); break;
    case "favori": ecrire("notes", Object.assign({}, n, { fav: !n.fav, updatedAt: maintenant() })); ficheNote(n.id); break;
    case "archiver": ecrire("notes", Object.assign({}, n, { archived: !n.archived, pinned: false, updatedAt: maintenant() }));
      if (!n.archived) { fermer(); toast("Note archivée", () => { ecrire("notes", n); render(); }); } else ficheNote(n.id); break;
    // fiche d'une décision
    case "trancher": ecrire("decisions", Object.assign({}, d, { status: "decided", decidedAt: maintenant(), outcome: $("#issue").value.trim(), updatedAt: maintenant() }));
      fermer(); toast("Tranchée : rangée dans Archivées", () => { ecrire("decisions", d); render(); }); break;
    case "rouvrir": ecrire("decisions", Object.assign({}, d, { status: "open", decidedAt: "", outcome: $("#issue").value.trim(), updatedAt: maintenant() })); ficheDec(d.id); break;
    // formulaires
    case "enreg-note": enregistrerNote(); break;
    case "enreg-dec": enregistrerDec(); break;
    case "anki-interr": { const i = $("#f-anki"); i.classList.toggle("on"); $("#f-anki-zone").hidden = !i.classList.contains("on"); break; }
    case "echeance": $("#f-due").value = dateEcheance(v); document.querySelectorAll('[data-act="echeance"]').forEach(b => b.classList.toggle("on", b === el)); break;
    // Ma semaine
    case "melanger": S.pick = null; render(); break;
    case "pdf": imprimerRecap(); break;
    // réglages
    case "themes": ouvrirThemes(); break;
    case "theme": sauverReglageLocal("theme", v); window.appliquerTheme(v); ouvrirThemes(); break;
    case "anim": sauverReglageLocal("anim", v); document.documentElement.classList.toggle("anim-simples", v === "simples"); ouvrirReglages(); break;
    case "cats": ouvrirCats(); break;
    case "suppr-cat": supprimerCat(v); break;
    case "ajout-cat": { const c = $("#cat-neuve").value.trim(); if (c && !S.cats.includes(c)) { ajouterCat(c); ouvrirCats(); } break; }
    case "anki": exporterAnki(v === "nouvelles"); break;
    case "exporter": exporterExcel(el); break;
    case "import-ok": faireImport(); break;
    case "import-annuler": importPret = null; $("#imp").innerHTML = ""; break;
  }
});
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.id === "nouvelle") { e.preventDefault(); $('[data-act="ajouter-note"]').click(); }
  if (e.key === "Enter" && e.target.id === "nouvelle-dec") { e.preventDefault(); $('[data-act="ajouter-dec"]').click(); }
  if (e.key === "Enter" && e.target.id === "cat-neuve") $('[data-act="ajout-cat"]').click();
  if (e.key === "Escape" && $("#modal").innerHTML) fermer();
});
document.addEventListener("input", e => {
  if (e.target.id === "q") {
    S.q = e.target.value;
    // on ne redessine que la liste, pour ne pas perdre le curseur
    const tmp = document.createElement("div");
    tmp.innerHTML = S.onglet === "decisions" ? ecranDecisions() : ecranNotes();
    $("#main .liste").innerHTML = tmp.querySelector(".liste").innerHTML;
  }
});
document.addEventListener("change", e => {
  if (e.target.id === "fichier" && e.target.files[0]) lireImport(e.target.files[0]);
  if (e.target.id === "f-cat") { $("#f-cat-neuve").hidden = e.target.value !== "__nouvelle"; if (e.target.value === "__nouvelle") $("#f-cat-neuve").focus(); }
  if (e.target.id === "f-due") document.querySelectorAll('[data-act="echeance"]').forEach(b => b.classList.toggle("on", dateEcheance(b.dataset.v) === e.target.value));
  if (e.target.dataset.cat !== undefined && e.target.dataset.cat) renommerCat(e.target.dataset.cat, e.target.value);
});

// Le « gardien » hors ligne (service worker) : garde une copie des fichiers de l'appli
// et installe tout seul les nouvelles versions.
if ("serviceWorker" in navigator && !MODE_DEMO && location.protocol === "https:") {
  // updateViaCache "none" : toujours demander sw.js au serveur, jamais à la mémoire du téléphone
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(reg => {
    // à chaque retour sur l'appli, on vérifie s'il y a une mise à jour
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
  }).catch(() => {});
  // Nouvelle version installée : on recharge une fois (pas à la 1re installation),
  // en attendant qu'aucune fiche ne soit ouverte.
  const avaitUneVersion = !!navigator.serviceWorker.controller;
  let dejaRecharge = false;
  const recharger = () => {
    if (dejaRecharge) return;
    if ($("#modal").innerHTML) return setTimeout(recharger, 3000);
    dejaRecharge = true; location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (avaitUneVersion) recharger(); });
}

// En mode démo uniquement : outils de test (préparer un fichier Excel sans cliquer)
if (MODE_DEMO) window.etcDemo = { construireClasseur, S };

if (MODE_DEMO) demarrerDemo(); else demarrerFirebase();
