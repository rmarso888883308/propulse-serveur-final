// gestion_cles.js - La "télécommande" pour le serveur distant

const ADMIN_SECRET_KEY = 'CHANGER_CE_MOT_DE_PASSE'; // !! METTEZ LE MÊME MOT DE PASSE QUE DANS SERVEUR.JS !!
const SERVER_URL = 'https://propulse-serveur-final.fly.dev'; // !! METTRE À JOUR APRÈS LE DÉPLOIEMENT !!

async function fetchAdmin(endpoint, options = {}) {
    const headers = { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_SECRET_KEY, ...options.headers, };
    const response = await fetch(`${SERVER_URL}${endpoint}`, { ...options, headers });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Erreur du serveur (${response.status}): ${errorData.error || 'Erreur inconnue'}`);
    }
    return response.json();
}

async function ajouterCle() {
    try {
        const data = await fetchAdmin('/admin/add', { method: 'POST' });
        console.log(`✅ Clé ajoutée avec succès : ${data.key}`);
    } catch (e) { console.error(`❌ Erreur: ${e.message}`); }
}

async function listerCles() {
    try {
        const cles = await fetchAdmin('/admin/list');
        console.table(cles);
    } catch (e) { console.error(`❌ Erreur: ${e.message}`); }
}

async function changerStatutCle(cle, statut) {
    try {
        const data = await fetchAdmin('/admin/status', { method: 'POST', body: JSON.stringify({ key: cle, active: statut === 'enable' }) });
        console.log(`✅ ${data.message}`);
    } catch (e) { console.error(`❌ Erreur: ${e.message}`); }
}

async function deleteCle(cle) {
    try {
        const data = await fetchAdmin('/admin/delete', { method: 'POST', body: JSON.stringify({ key: cle }) });
        console.log(`✅ ${data.message}`);
    } catch (e) { console.error(`❌ Erreur: ${e.message}`); }
}

const commande = process.argv[2];
const arg1 = process.argv[3];

if (commande === 'add') {
    ajouterCle();
} else if (commande === 'list') {
    listerCles();
} else if (commande === 'disable' && arg1) {
    changerStatutCle(arg1, 'disable');
} else if (commande === 'enable' && arg1) {
    changerStatutCle(arg1, 'enable');
} else if (commande === 'delete' && arg1) {
    deleteCle(arg1);
} else {
    console.log(`
Commandes disponibles :
  - add           : Ajoute une clé sur le serveur distant.
  - list          : Affiche les clés du serveur distant.
  - disable <clé> : Désactive une clé sur le serveur distant.
  - enable <clé>  : Réactive une clé sur le serveur distant.
  - delete <clé>  : Supprime une clé sur le serveur distant.
    `);
}