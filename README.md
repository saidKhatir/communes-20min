# Carte d’Accessibilité – Temps de trajet

Application web cartographique interactive permettant de visualiser les communes accessibles depuis un lieu de travail, avec une représentation par **temps de trajet**.

## Description

Cette carte met en évidence les communes accessibles depuis un **point de départ (lieu de travail dans le nord-est de Nantes)**, avec une coloration selon le temps estimé :

- 🟢 **Vert** : ≤ 10 minutes  
- 🟠 **Orange** : ≤ 20 minutes  
- 🔴 **Rouge** : ≤ 30 minutes  

## Méthodologie (pré-traitement SIG)

Le calcul des zones d’accessibilité a été effectué **en amont dans QGIS**, à partir du point de départ (lieu de travail), en utilisant l’extension **QNEAT3** :

- Outil : **Iso-area as polygon (from point)**
- Critère de coût : **fastest time**
- Type de zone : **size of area (time)**
- Paramètres :
  - Temps maximum : **1800 secondes (30 minutes)**
  - Intervalle : **600 secondes (10 minutes)**
  - Résultat : **3 polygones isochrones** (0–10 min, 10–20 min, 20–30 min)

Ensuite, ces **trois polygones de temps d’accessibilité** ont été **comparés aux communes** (intersection / comparaison spatiale) afin d’estimer, pour chaque commune, une classe de temps d’accès (10, 20 ou 30 minutes).

## Fonctionnalités

- Carte interactive basée sur **MapLibre GL JS**
- Recherche de commune avec suggestions en temps réel
- Interaction : clic sur une commune pour afficher les détails
- Tableau récapitulatif avec filtres par temps d’accès
- Design **mobile-first** (optimisé iOS / Android)
- Gestion des **safe-area** pour iPhone

## 🚀 Démo

**[Voir la démo en ligne](https://saidkhatir.github.io/communes-20min/)**

## Technologies

- **MapLibre GL JS** – Cartographie interactive
- **Turf.js** – Calculs géométriques côté client
- **HTML / CSS / JavaScript** – Sans framework
- **OpenFreeMap** – Fond de carte gratuit

## Compatibilité

- Safari iOS 14+
- Chrome Android 90+
- Firefox 88+
- Edge 90+

## Licence

MIT — Libre d’utilisation et de modification.

## Auteur

**KHATIR Saïd**
