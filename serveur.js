// serveur.js - Version finale et propre

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const crypto = require('crypto');

// --- Configuration ---
const ADMIN_SECRET_KEY = 'CHANGER_CE_MOT_DE_PASSE'; // !! CHANGEZ CECI PAR UN MOT DE PASSE COMPLEXE !!
const DB_FILE = '/data/cles.db'; // Chemin vers la base de données sur le disque persistant
const PORT = 3000;
const TEMPS_GRACE_MINUTES = 5;

const app = express();
app.use(express.json());
app.set('trust proxy', true);

// --- Initialisation de la base de données ---
async function initialiserDB() {
    const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS cles (
            cle_unique TEXT PRIMARY KEY,
            est_active INTEGER NOT NULL DEFAULT 1,
            derniere_ip_utilisee TEXT,
            derniere_verification INTEGER
        )
    `);
    await db.close();
    console.log("Base de données prête.");
}

// --- Route publique pour la validation des clés ---
app.get('/verifier_cle', async (req, res) => {
    const cleUtilisateur = req.query.cle;
    const ipUtilisateur = req.ip;
    if (!cleUtilisateur) return res.status(400).json({ status: 'erreur', message: 'Clé non fournie.' });
    let db;
    try {
        db = await open({ filename: DB_FILE, driver: sqlite3.Database });
        const cleInfo = await db.get('SELECT * FROM cles WHERE cle_unique = ?', cleUtilisateur);
        if (!cleInfo || !cleInfo.est_active) return res.status(403).json({ status: 'erreur', message: 'Clé invalide ou désactivée.' });
        const maintenant = Date.now();
        if (!cleInfo.derniere_ip_utilisee || cleInfo.derniere_ip_utilisee === ipUtilisateur) {
            await db.run('UPDATE cles SET derniere_ip_utilisee = ?, derniere_verification = ? WHERE cle_unique = ?', [ipUtilisateur, maintenant, cleUtilisateur]);
            return res.json({ status: 'ok', message: 'Clé valide.' });
        }
        if (cleInfo.derniere_ip_utilisee !== ipUtilisateur) {
            const tempsEcouleMs = maintenant - cleInfo.derniere_verification;
            const tempsGraceMs = TEMPS_GRACE_MINUTES * 60 * 1000;
            if (tempsEcouleMs < tempsGraceMs) {
                return res.status(409).json({ status: 'erreur', message: 'Cette clé est déjà utilisée sur un autre appareil.' });
            } else {
                await db.run('UPDATE cles SET derniere_ip_utilisee = ?, derniere_verification = ? WHERE cle_unique = ?', [ipUtilisateur, maintenant, cleUtilisateur]);
                return res.json({ status: 'ok', message: 'Clé valide (session transférée).' });
            }
        }
    } catch (err) {
        console.error("Erreur serveur :", err);
        return res.status(500).json({ status: 'erreur', message: 'Erreur interne du serveur.' });
    } finally {
        if (db) await db.close();
    }
});

// --- Routes d'administration sécurisées ---
const checkAdmin = (req, res, next) => {
    const providedKey = req.headers['x-admin-key'];
    if (providedKey === ADMIN_SECRET_KEY) {
        next();
    } else {
        res.status(401).json({ error: 'Accès non autorisé' });
    }
};

app.post('/admin/add', checkAdmin, async (req, res) => {
    const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
    const nouvelleCle = `PROPULSE-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    await db.run('INSERT INTO cles (cle_unique) VALUES (?)', nouvelleCle);
    await db.close();
    res.json({ success: true, key: nouvelleCle });
});

app.get('/admin/list', checkAdmin, async (req, res) => {
    const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
    const cles = await db.all('SELECT *, datetime(derniere_verification / 1000, "unixepoch", "localtime") as derniere_verif_humaine FROM cles');
    await db.close();
    res.json(cles);
});

app.post('/admin/status', checkAdmin, async (req, res) => {
    const { key, active } = req.body;
    const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
    const resultat = await db.run('UPDATE cles SET est_active = ? WHERE cle_unique = ?', [active ? 1 : 0, key]);
    await db.close();
    if (resultat.changes > 0) {
        res.json({ success: true, message: `Clé ${key} mise à jour.` });
    } else {
        res.status(404).json({ error: 'Clé non trouvée.' });
    }
});

app.post('/admin/delete', checkAdmin, async (req, res) => {
    const { key } = req.body;
    const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
    const resultat = await db.run('DELETE FROM cles WHERE cle_unique = ?', key);
    await db.close();
    if (resultat.changes > 0) {
        res.json({ success: true, message: `Clé ${key} supprimée définitivement.` });
    } else {
        res.status(404).json({ error: 'Clé non trouvée.' });
    }
});

// --- Démarrage ---
initialiserDB().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
    });
});