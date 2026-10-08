# Suivi des congés

Remplace le classeur Excel `AF_Activites.xlsx` (un onglet par année) par une application web
qui fonctionne entièrement dans le navigateur : pas de serveur, pas d'installation.

## Utilisation

Ouvrir `index.html` dans un navigateur (ou publier le dossier tel quel, par exemple avec GitHub Pages).

- **Pinceau** : choisir un type (TT, CA, CJT…), puis cliquer ou glisser sur les jours du calendrier.
  Recliquer sur un jour qui porte déjà ce code l'efface. **Gomme** efface le code et le lieu.
  Un pinceau **Lieu** (CDG, VLB…) ajoute le triangle de couleur des jours (équivalent des cellules colorées).
- **Soldes** (panneau de droite) : droits, pris (jusqu'à aujourd'hui), posés (toute l'année), reste maintenant et
  reste prévisionnel ; RA et CH sont aussi affichés en heures (7 h par jour, réglable).
- Pied du calendrier : jours ouvrés, absences, télétravail et jours sur site par mois.
- **Annuler** : bouton ou Ctrl+Z.
- **Réglages** : droits de l'année, jours fériés (génération automatique pour la France), vacances scolaires,
  types de jours (libellés, couleurs, « décompté d'un droit », « absence ») et lieux.
- **Données** : export / import JSON. Les données sont stockées dans le navigateur (`localStorage`), sur
  l'appareil uniquement : pensez à exporter régulièrement.

## Données initiales

`data/seed.js` contient les données des onglets 2018 à 2027 du classeur ; elles sont chargées à la première
ouverture. Pour les régénérer depuis un classeur :

```
pip install openpyxl
python3 tools/import_excel.py chemin/vers/AF_Activites.xlsx data/seed.js
```

Le code `CP` (congés payés, 2018-2021) est converti en `CA`.

> `data/seed.js` contient vos données personnelles. Si ce dépôt est public ou publié sur Internet,
> supprimez ce fichier (l'application démarre alors vide) et importez votre sauvegarde JSON.

## Développement

```
npm test        # tests de la logique (Node ≥ 18), comparés aux valeurs du classeur
```

- `js/lib.js` : dates, jours fériés, calcul des soldes (sans DOM, testé)
- `js/app.js` : interface
- `tools/import_excel.py` : conversion du classeur
