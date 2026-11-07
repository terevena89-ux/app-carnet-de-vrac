// Adresse du serveur Firebase partagé par toutes mes applis.
// Ce n'est PAS un secret : la sécurité vient de la connexion Google
// et des règles Firestore (voir firestore.rules).
// Chaque appli en garde une copie dans son propre dossier.
export const firebaseConfig = {
  apiKey: "AIzaSyDJTb4Oo2ZZsBN2glFODzeJVlcQBuy-MC0",
  authDomain: "mes-applis-8bbd7.firebaseapp.com",
  projectId: "mes-applis-8bbd7",
  storageBucket: "mes-applis-8bbd7.firebasestorage.app",
  messagingSenderId: "358512209219",
  appId: "1:358512209219:web:8861e7efbe21ba488cd3f6"
};
