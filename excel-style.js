// =========================================================
// STYLE EXCEL COMMUN à toutes mes applis.
// Une copie de ce fichier est à la racine du dossier « Mes applications » :
// pour une nouvelle appli, on la recopie telle quelle (comme firebase-config.js).
// =========================================================

// Bibliothèque ExcelJS, version fixe (pour que rien ne casse un jour).
const EXCELJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";

// Couleurs communes (format ARGB : FF + code couleur)
const COULEURS = {
  entete: "FF1F6F5C",       // fond des en-têtes (vert sapin)
  enteteTexte: "FFFFFFFF",  // texte des en-têtes (blanc)
  ligneAlternee: "FFF2F7F5",// une ligne sur deux, très légèrement teintée
  bordure: "FFD0D5DA"       // traits fins gris
};

// Charge ExcelJS seulement quand on en a besoin (export / import),
// pour que l'appli démarre vite.
export function chargerExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = EXCELJS_URL;
    s.onload = () => ok(window.ExcelJS);
    s.onerror = () => ko(new Error("Impossible de charger ExcelJS (pas de réseau ?)"));
    document.head.appendChild(s);
  });
}

// Crée une feuille déjà mise en forme.
// colonnes = [{ header: "Titre", key: "cle", width: 20 }, ...]
// lignes   = [{ cle: valeur, ... }, ...]
export function ajouterFeuille(classeur, nom, colonnes, lignes) {
  const ws = classeur.addWorksheet(nom, {
    views: [{ state: "frozen", ySplit: 1 }] // en-tête figé quand on fait défiler
  });
  ws.columns = colonnes;
  lignes.forEach(l => ws.addRow(l));

  const bord = { style: "thin", color: { argb: COULEURS.bordure } };
  const bordures = { top: bord, left: bord, bottom: bord, right: bord };

  ws.eachRow((rang, n) => {
    rang.eachCell({ includeEmpty: true }, cell => {
      cell.border = bordures;
      cell.alignment = { vertical: "middle" };
      if (n === 1) {
        // Ligne d'en-tête : fond coloré, texte blanc en gras
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COULEURS.entete } };
        cell.font = { bold: true, color: { argb: COULEURS.enteteTexte } };
      } else if (n % 2 === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COULEURS.ligneAlternee } };
      }
    });
  });
  ws.getRow(1).height = 20;
  // Petits filtres dans l'en-tête (flèches de tri dans Excel)
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colonnes.length } };
  return ws;
}

// Télécharge le classeur sous le nom <nom-appli>_AAAA-MM-JJ.xlsx
export async function telechargerClasseur(classeur, nomAppli) {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const tampon = await classeur.xlsx.writeBuffer();
  const blob = new Blob([tampon], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${nomAppli}_${date}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// Lit un fichier .xlsx choisi par l'utilisateur et renvoie le classeur.
export async function lireClasseur(fichier) {
  const ExcelJS = await chargerExcelJS();
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.load(await fichier.arrayBuffer());
  return classeur;
}

// Transforme une feuille en tableau d'objets, en se servant des en-têtes.
// Ex. : [{ "Liste": "Sport", "Objet": "Gourde", ... }, ...]
export function lireFeuille(ws) {
  if (!ws) return [];
  const entetes = [];
  ws.getRow(1).eachCell((c, i) => { entetes[i] = String(c.text).trim(); });
  const lignes = [];
  ws.eachRow((rang, n) => {
    if (n === 1) return;
    const o = {};
    entetes.forEach((h, i) => { if (h) o[h] = String(rang.getCell(i).text ?? "").trim(); });
    lignes.push(o);
  });
  return lignes;
}
