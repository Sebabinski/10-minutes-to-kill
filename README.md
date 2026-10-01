# 10′ to Kill — version web

Adaptation fan-made, pour jouer entre amis, du jeu de déduction *10' to Kill* (Benoit Bannier, La Boîte de Jeu).
De 2 à 4 joueurs, chacun sur son écran.

## Lancer en local

```bash
npm install
npm start
```

Puis ouvrir http://localhost:3000. Pour tester seul, ouvrez plusieurs fenêtres en navigation privée
(chaque fenêtre privée compte comme un joueur différent).

## Mettre en ligne sur Render

1. Pousser ce dossier sur un dépôt GitHub.
2. Sur Render : New → Web Service, choisir le dépôt.
3. Build command : `npm install` — Start command : `npm start` — offre Free.
4. Partager l'URL : l'hôte crée une partie, les autres rejoignent avec le code à 4 lettres
   (ou le lien d'invitation copié depuis le salon).

Sur l'offre gratuite, le service s'endort après une période d'inactivité : le premier chargement peut prendre ~30 secondes.
Les parties sont gardées en mémoire, donc un redémarrage du service les efface.

## Fichiers

- `game.js` : les règles (moteur pur, testable sans serveur)
- `server.js` : salons, codes de partie, reconnexion, envoi à chaque joueur de sa vue privée
- `public/` : l'interface (HTML, CSS, JS)

## Différences avec le jeu de plateau

- Le jeu refuse un meurtre impossible (tueur vu, cible hors de portée) au lieu de pénaliser l'erreur.
- Chaque meurtre affiche automatiquement la liste des suspects possibles.
- Le plateau est soit un carré 4 × 4, soit une « ville aléatoire » de 16 lieux avec des trous ; 5 lieux sont des toits de tir.
- Quand il n'y a plus de policier en réserve, celui qui revient sur la scène de crime est tiré au hasard.
