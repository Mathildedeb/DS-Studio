# Refonte UX — version locale à revoir

Branche : `design/refonte-ux`.

## Implémenté

- Navigation Accueil / Bibliothèque / Pages / Synchro ; anciennes ancres conservées.
- Accès directs aux tâches sur l’accueil, suivi PFE conservé.
- Styles : filtres par type de valeur, recherche conservée, liste limitée en hauteur sur petit écran.
- Composants : recherche commune Figma/code, catégories atomiques et filtre des composants codés ; fiches Figma réutilisées. Les vues par niveau restent disponibles.
- Synchro dédiée : chargement explicite, erreur annoncée, nouvelle tentative ; résultat limité aux variantes prises en charge.
- Pages : modes Code réel / Composer ; libellés aperçu local et lien partagé distincts ; bouton Calques et composants explicite.
- Retrait de page/format confirmé ; restauration de la configuration précédente disponible jusqu’au prochain enregistrement réussi. La configuration affichée change seulement après succès du serveur.
- Diff : liste des fichiers concernés et consigne de vérification visuelle ; bouton Valider et enregistrer.
- Conversation conservée dans le stockage local du navigateur, par dossier projet, limitée aux 100 derniers messages. Une indisponibilité du stockage est signalée. Les propositions de code et les étapes actives ne sont pas restaurées : aucune application de diff périmé.
- Accès Clodo nommé et focus du champ de conversation renforcé.

## Vérifications

- TESTED — macOS, typage et compilation de production : succès.
- TESTED — 102 tests unitaires : succès.
- TESTED — navigateur intégré, interface locale : accueil, bibliothèque commune, Pages, distinction local/partagé ; retrait et restauration d’un format dans un serveur de test à données temporaires.
- PARTIAL — 14 tests de parcours préparés/actualisés, mais aucune assertion exécutée : Chromium de test échoue au démarrage sous macOS (`MachPortRendezvousServer`, permission refusée).
- PARTIAL — le contrôle de publication relève seulement le document PASSATION.md préexistant, non suivi et exclu du commit UX.
- NOT TESTED — appel réel à Clodo, reprise de conversation de bout en bout, Build, publication GitHub et écriture Figma. Aucun de ces services n’a été déclenché.
- NOT TESTED — petits écrans : la demande de redimensionnement du navigateur intégré ne change pas la largeur DOM constatée (1280 px). Les styles adaptatifs restent à qualifier sur un vrai petit écran ou via les tests de parcours.

## Limites de cette version

La validation présente toujours le diff intégral. Elle n’invente ni résumé fonctionnel des modifications ni aperçu avant/après. La conversation est locale au navigateur ; elle ne restaure pas les opérations en attente après un redémarrage du serveur.

La refonte ne change ni les tokens du projet de design, ni la portée de synchronisation Figma, ni le seuil de publication serveur. Elle ne fusionne pas encore les deux sélecteurs format/modèle d’appareil de Pages. L’audit d’accessibilité complet et les tests IA de bout en bout restent à faire.

Le document privé `docs/PASSATION.md` préexistant est conservé hors commit. Aucun push, aucune PR ni publication.
