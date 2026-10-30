# Ouvrir un projet dans DS-Studio : ce qu'il faut

DS-Studio relie un **dossier de code** (Git) et un **fichier Figma**. Pour
que tout marche (Design System, Preview, Composer, Build, synchro Figma,
publication), le projet doit avoir ce qui suit. À l'ouverture, ou quand tu
écris « vérifie mon projet » dans le chat, DS-Studio fait ce contrôle et le
chat te propose de régler chaque manque.

| Élément | Ce qu'il faut | Si ça manque |
|---|---|---|
| **Dépôt Git** | Le dossier est un dépôt Git, relié à GitHub | Tu le clones (GitHub Desktop → Clone repository) ou tu le publies (Publish repository) |
| **Application** | React + Vite, avec un script `dev` dans `package.json` | Le chat peut créer l'application ou ajouter le script. Sans React + Vite, l'Aperçu marche, pas le mode Composer. |
| **Dépendances** | Installées (`node_modules`) | Bouton « Installer (npm install) » |
| **Composants codés** | `src/components/<atoms\|molecules\|organisms>/<Nom>/<Nom>.tsx`, avec une interface `<Nom>Props` | Le chat range les composants existants, ou code le premier depuis Figma |
| **Tokens du code** | `design-system/tokens.json` au format DTCG, et `npm run tokens` qui génère `src/design-system/tokens.css` | Le chat crée le fichier avec les tokens du DS, sans rien inventer |
| **Fichier Figma** | Le lien du fichier, et une clé Figma (`FIGMA_TOKEN` dans le `.env` de DS-Studio, portée « File content : Read-only ») | Tu ajoutes le lien (bouton du chat) ; la clé, toi seule peux l'ajouter |
| **Preview (Composer)** | Le relais : 2 fichiers de développement, à jour | Bouton « Voir le diff du relais », puis tu valides |
| **Plugin Figma** | Ouvert dans Figma desktop, sur ce fichier, en Mode automatique | Tu l'ouvres : sans lui, rien ne s'écrit dans Figma |

Ce que le chat ne fait jamais à ta place : cloner un dépôt, créer un compte,
ajouter une clé, ouvrir Figma. Il te dit quoi faire, en une phrase.
