// serveur.js - V2 avec gestion des empreintes d'appareils et utilisateurs Discord

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const crypto = require('crypto');
const cors = require('cors');

// --- Configuration ---
// !! IMPORTANT : Utilisez une clé complexe et gardez-la secrète.
// !! Elle doit être identique dans le fichier .env de votre bot.
const ADMIN_SECRET_KEY = 'CHANGER_CE_MOT_DE_PASSE_ULTRA_SECRET'; 
const DB_FILE = '/data/cles.db'; // Chemin persistant sur Fly.io
const PORT = process.env.PORT || 3000;
const MAX_DEVICES = 2; // Limite de 2 appareils par clé

const app = express();
app.use(cors());
app.use(express.json());
app.set('trust proxy', true);

// --- Initialisation de la base de données ---
async function initialiserDB() {
    const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
    console.log("Vérification de la structure de la base de données...");
    // Nouvelle structure de table pour supporter les nouvelles fonctionnalités
    await db.exec(`
        CREATE TABLE IF NOT EXISTS cles (
            cle_unique TEXT PRIMARY KEY,
            est_active INTEGER NOT NULL DEFAULT 1,
            discord_user_id TEXT,
            discord_username TEXT,
            appareils_actifs TEXT, -- Stockera un tableau JSON d'empreintes
            date_creation TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await db.close();
    console.log("Base de données prête.");
}

// --- Route publique pour la validation des clés par empreinte ---
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

        // Si l'empreinte est déjà enregistrée, c'est bon.
        if (appareils.includes(empreinteAppareil)) {
            return res.json({ status: 'ok', message: 'Clé valide.' });
        }

        // Sinon, si il reste de la place, on l'ajoute.
        if (appareils.length < MAX_DEVICES) {
            appareils.push(empreinteAppareil);
            await db.run('UPDATE cles SET appareils_actifs = ? WHERE cle_unique = ?', [JSON.stringify(appareils), cleUtilisateur]);
            return res.json({ status: 'ok', message: 'Nouvel appareil enregistré et validé.' });
        }

        // Si la limite d'appareils est atteinte.
        return res.status(409).json({ status: 'erreur', message: `Limite de ${MAX_DEVICES} appareils atteinte. Utilisez la commande /admin resetdevices sur Discord pour réinitialiser.` });

    } catch (err) {
        console.error("Erreur serveur :", err);
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

app.post('/admin/add', checkAdmin, async (req, res) => {
    const { discordUserId, discordUsername } = req.body;
    if (!discordUserId || !discordUsername) {
        return res.status(400).json({ error: "Les informations Discord sont requises." });
    }

    const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
    try {
        // On vérifie si l'utilisateur a déjà une clé
        const existingKey = await db.get('SELECT cle_unique FROM cles WHERE discord_user_id = ?', discordUserId);
        if (existingKey) {
            return res.status(409).json({ success: false, message: 'Cet utilisateur a déjà une clé.', key: existingKey.cle_unique });
        }

        const nouvelleCle = `PROPULSE-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        await db.run(
            'INSERT INTO cles (cle_unique, discord_user_id, discord_username, appareils_actifs) VALUES (?, ?, ?, ?)',
            [nouvelleCle, discordUserId, discordUsername, '[]']
        );
        res.json({ success: true, key: nouvelleCle });

    } catch (e) {
        console.error("Erreur /admin/add :", e);
        res.status(500).json({ error: "Erreur lors de l'ajout de la clé." });
    } finally {
        await db.close();
    }
});

app.get('/admin/list', checkAdmin, async (req, res) => {
    const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
    const cles = await db.all('SELECT cle_unique, est_active, discord_user_id, discord_username, appareils_actifs, date_creation FROM cles');
    await db.close();
    res.json(cles);
});

app.post('/admin/reset_devices', checkAdmin, async (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: "La clé est requise." });

    const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
    const resultat = await db.run('UPDATE cles SET appareils_actifs = ? WHERE cle_unique = ?', ['[]', key]);
    await db.close();
    
    if (resultat.changes > 0) {
        res.json({ success: true, message: `Les appareils pour la clé ${key} ont été réinitialisés.` });
    } else {
        res.status(404).json({ error: 'Clé non trouvée.' });
    }
});


// --- Démarrage ---
initialiserDB().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Serveur Propulse démarré sur le port ${PORT}`);
    });
});
