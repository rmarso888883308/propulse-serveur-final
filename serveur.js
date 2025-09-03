// serveur.js - Version Finale avec Heartbeat de Débogage

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const crypto = require('crypto');
const cors = require('cors');

// --- Configuration ---
const ADMIN_SECRET_KEY = 'zeoirbgpzerugbzpierubg208730'; 
const DB_FILE = '/data/cles.db';
const PORT = process.env.PORT || 3000;
const MAX_DEVICES = 2;

const app = express();
app.use(cors());
app.use(express.json());
app.set('trust proxy', true);

// --- Initialisation de la base de données ---
async function initialiserDB() {
    const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
    console.log("Vérification de la structure de la base de données...");
    await db.exec(`
        CREATE TABLE IF NOT EXISTS cles (
            cle_unique TEXT PRIMARY KEY,
            est_active INTEGER NOT NULL DEFAULT 1,
            discord_user_id TEXT,
            discord_username TEXT,
            appareils_actifs TEXT,
            date_creation TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await db.close();
    console.log("Base de données prête.");
}

// --- Route publique pour la validation des clés ---
app.get('/verifier_cle', async (req, res) => {
    const { cle: cleUtilisateur, fingerprint: empreinteAppareil } = req.query;
    if (!cleUtilisateur || !empreinteAppareil) {
        return res.status(400).json({ status: 'erreur', message: 'Clé ou empreinte d\'appareil non fournie.' });
    }
    let db;
    try {
        db = await open({ filename: DB_FILE, driver: sqlite3.Database });
        const cleInfo = await db.get('SELECT * FROM cles WHERE cle_unique = ?', cleUtilisateur);
        if (!cleInfo || !cleInfo.est_active) {
            return res.status(403).json({ status: 'erreur', message: 'Clé invalide ou désactivée.' });
        }
        let appareils = cleInfo.appareils_actifs ? JSON.parse(cleInfo.appareils_actifs) : [];
        if (appareils.includes(empreinteAppareil)) {
            return res.json({ status: 'ok', message: 'Clé valide.' });
        }
        if (appareils.length < MAX_DEVICES) {
            appareils.push(empreinteAppareil);
            await db.run('UPDATE cles SET appareils_actifs = ? WHERE cle_unique = ?', [JSON.stringify(appareils), cleUtilisateur]);
            return res.json({ status: 'ok', message: 'Nouvel appareil enregistré et validé.' });
        }
        return res.status(409).json({ status: 'erreur', message: `Limite de ${MAX_DEVICES} appareils atteinte.` });
    } catch (err) {
        console.error("Erreur serveur /verifier_cle :", err);
        return res.status(500).json({ status: 'erreur', message: 'Erreur interne du serveur.' });
    } finally {
        if (db) await db.close();
    }
});

// --- Middleware d'administration ---
const checkAdmin = (req, res, next) => {
    if (req.headers['x-admin-key'] === ADMIN_SECRET_KEY) {
        next();
    } else {
        res.status(401).json({ error: 'Accès non autorisé' });
    }
};

// --- Routes d'administration (utilisées par le bot) ---

// Route simple pour créer une clé "vierge"
app.post('/admin/add', checkAdmin, async (req, res) => {
    const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
    try {
        const nouvelleCle = `PROPULSE-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        await db.run(
            'INSERT INTO cles (cle_unique, appareils_actifs) VALUES (?, ?)',
            [nouvelleCle, '[]']
        );
        res.json({ success: true, key: nouvelleCle });
    } catch (e) {
        console.error("Erreur /admin/add :", e);
        res.status(500).json({ error: "Erreur lors de l'ajout de la clé." });
    } finally {
        await db.close();
    }
});

// Route simple pour lier une clé existante à un utilisateur Discord
app.post('/admin/link', checkAdmin, async (req, res) => {
    const { key, discordUserId, discordUsername } = req.body;
    if (!key || !discordUserId || !discordUsername) {
        return res.status(400).json({ error: "Infos manquantes pour lier la clé." });
    }
    const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
    try {
        await db.run(
            'UPDATE cles SET discord_user_id = ?, discord_username = ? WHERE cle_unique = ?',
            [discordUserId, discordUsername, key]
        );
        res.json({ success: true, message: 'Clé liée avec succès.' });
    } catch (e) {
        console.error("Erreur /admin/link :", e);
        res.status(500).json({ error: "Erreur lors du liage de la clé." });
    } finally {
        await db.close();
    }
});

// Route pour lister toutes les clés
app.get('/admin/list', checkAdmin, async (req, res) => {
    const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
    try {
        const cles = await db.all('SELECT * FROM cles');
        res.json(cles);
    } catch(e) {
        console.error("Erreur /admin/list :", e);
        res.status(500).json({ error: "Erreur lors de la récupération des clés." });
    } finally {
        await db.close();
    }
});

// Route pour réinitialiser les appareils d'une clé
app.post('/admin/reset_devices', checkAdmin, async (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: "La clé est requise." });

    const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
    try {
        const resultat = await db.run('UPDATE cles SET appareils_actifs = ? WHERE cle_unique = ?', ['[]', key]);
        if (resultat.changes > 0) {
            res.json({ success: true, message: `Les appareils pour la clé ${key} ont été réinitialisés.` });
        } else {
            res.status(404).json({ error: 'Clé non trouvée.' });
        }
    } catch (e) {
        console.error("Erreur /admin/reset_devices :", e);
        res.status(500).json({ error: "Erreur lors de la réinitialisation." });
    } finally {
        await db.close();
    }
});


// --- AJOUT DU HEARTBEAT DE DÉBOGAGE ---
// Ce code va écrire un message dans les logs toutes les 10 secondes
// pour prouver que l'application est bien en cours d'exécution et n'a pas crashé.
setInterval(() => {
    console.log(`[Heartbeat] Le serveur est en vie à ${new Date().toISOString()}`);
}, 10000);
// --- FIN DU HEARTBEAT ---


// --- Démarrage du serveur ---
initialiserDB().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Serveur Propulse démarré sur le port ${PORT}`);
    });
}).catch(err => {
    console.error("Échec de l'initialisation de la base de données :", err);
    process.exit(1); // Arrête le processus si la DB ne peut pas être initialisée
});