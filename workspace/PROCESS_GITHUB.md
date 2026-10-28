# Fiche de process — DS Studio ↔ GitHub ↔ Figma

Règles pour que les modifications validées dans DS Studio arrivent sur GitHub
par lots, sur des branches, jamais directement sur `main`, et que Figma suive
grâce au plugin DS-Studio.

## 1. La règle des 10

- **Règle 1.** Rien ne part sur GitHub avant **10 modifications validées**.
  Une modification validée = un diff de token accepté, une annulation acceptée
  ou un changement de code appliqué depuis le chat.
- **Règle 2.** Entre 1 et 9, DS Studio affiche seulement le compteur
  (« 4/10 modifications validées avant de publier sur Git »). Écrire « push »
  dans le chat affiche aussi où on en est, sans rien envoyer.
- **Règle 3.** À la 10ᵉ, une carte « Je publie sur Git ? » propose de **créer
  une nouvelle branche `design/AAAA-MM-JJ-sujet`** et de la pousser.
  **Rien ne part sans mon clic.** « Plus tard » ferme la carte : elle revient à
  la modification suivante.
- **Règle 4.** Après un push réussi, le compteur repart à 0. Si le push échoue,
  le compteur reste à 10 et je peux réessayer.

Le compteur est enregistré dans `.ds-studio/` (privé), par projet : il survit
à la fermeture de DS Studio.

## 2. Les branches

- **Règle 5.** DS Studio n'écrit jamais sur `main`.
- **Règle 6.** **Un lot de 10 = une nouvelle branche.** Même message que la
  fois précédente → suffixe `-2`, `-3`…
- **Règle 7.** La nouvelle branche part de là où je suis : de `main`, ou de la
  branche du lot précédent si je ne suis pas revenue sur `main`. Dans ce cas,
  les Pull Requests se fusionnent **dans l'ordre**.
- **Règle 8.** Le message de la carte donne son nom à la branche. Je décris le
  lot :

  ```
  tokens: <ce qui change> (<pourquoi>)
  ex. tokens: palette primaire + espacements (contraste AA, grille 8 px)
  ```

## 3. Qui fait foi

| Où | Rôle |
|---|---|
| DS Studio | On **propose et valide** (diff accepté) |
| Fichier DTCG du projet | Copie des tokens validés, écrite par DS Studio |
| Branche `design/…` | Un lot de 10, en attente de relecture |
| GitHub `main` | **Version officielle**, après fusion de la PR |
| Figma (variables) | Reflet des tokens validés, mis à jour par le plugin (§ 4) |

On ne modifie jamais le fichier de tokens à la main ni directement sur GitHub.

## 4. Le lien avec Figma : obligatoire

- **Règle 9.** Le lien DS Studio ↔ Figma **doit être fait avant de travailler** :
  1. le projet est ouvert dans DS Studio **avec le lien de son fichier Figma** ;
  2. dans Figma, le plugin DS-Studio est lancé **dans ce fichier-là** ;
  3. le plugin est appairé avec le **code d'appairage** (DS Studio, onglet Figma) ;
  4. la case **« Mode automatique »** est cochée.
- **Règle 10.** Tant que le plugin est ouvert en mode automatique, **chaque
  token validé dans DS Studio est appliqué aux variables Figma** (relecture
  toutes les 4 s). Figma suit donc **chaque validation**, sans attendre les
  10 modifications ni le push GitHub.
- **Règle 11.** Le plugin ne fait que **mettre à jour** des variables
  existantes. **Créer ou supprimer** une variable demande toujours un clic dans
  le plugin : je vérifie qu'il ne reste rien en attente.
- **Règle 12.** Si le fichier Figma n'est pas celui du projet, le plugin
  s'arrête. Si le plugin était fermé pendant que je travaillais, je le rouvre :
  il rattrape la dernière version validée.

Le lien Figma ne passe pas par GitHub : Figma reflète ce qui est **validé dans
DS Studio**, `main` ce qui est **fusionné**. Les deux se rejoignent quand la PR
est fusionnée.

## 5. Le cycle

0. **Faire le lien Figma** (§ 4) : plugin ouvert, appairé, mode automatique.
1. **Avant une série** : partir de `main` à jour.
   ```bash
   git switch main && git pull
   ```
2. **Travailler dans DS Studio** : proposer, relire le diff, accepter. Aucune
   autre modification en cours dans le dossier : la publication emporte *tout*
   ce qui a changé.
3. **À 10** : écrire le message, cliquer « Oui, créer la branche et pousser ».
4. **Sur GitHub** : ouvrir la Pull Request `design/…` → `main`, relire le JSON
   des tokens **et** les fichiers générés (`tokens.css`…).
5. **Fusionner** la PR, supprimer la branche sur GitHub.
6. **Revenir sur `main`** pour la série suivante :
   ```bash
   git switch main && git pull && git branch -d design/<nom-de-la-branche>
   ```
7. **Vérifier Figma** : les variables correspondent aux tokens, rien en attente
   de création ou de suppression dans le plugin.

## 6. Ce qui ne part jamais

`.ds-studio/`, `.env`, clés (`.pem`, `.key`, `id_rsa`), `node_modules/`.
DS Studio refuse la publication s'il en voit un : on l'ajoute au `.gitignore`.

## 7. Quand ça bloque

| Message | Que faire |
|---|---|
| « Pas encore : 6/10 modifications validées » | Normal, continuer |
| « Rien à publier » | Les 10 modifications s'annulent entre elles : rien à faire |
| « Publication refusée : fichiers sensibles » | Ajouter le fichier au `.gitignore` |
| « Commit fait sur …, mais push refusé » | `gh auth status`, puis réessayer depuis la carte |
| Conflit dans la PR | Ne pas résoudre à l'aveugle : demander de l'aide |
| Plugin : « DS-Studio injoignable » | DS Studio doit être lancé sur ce poste ; le plugin réessaie tout seul |
| Plugin : code refusé | Recopier le code d'appairage depuis DS Studio (onglet Figma) |
| Plugin arrêté : mauvais fichier | Ouvrir le fichier Figma lié au projet |

**Interdits** : `git push --force`, `git reset --hard`, supprimer `.ds-studio/`.

## 8. Checklist

- [ ] Plugin Figma ouvert, appairé, mode automatique coché
- [ ] Je pars de `main` à jour
- [ ] Un sujet par série de 10
- [ ] Aucune modification hors-sujet dans le dossier
- [ ] Message clair sur la carte
- [ ] PR relue, fusionnée, branche supprimée
- [ ] Retour sur `main`
- [ ] Figma vérifié : variables à jour, rien en attente dans le plugin
