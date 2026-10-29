// Composants proposés dans le panneau « Construire » de la Preview : ceux qui
// servent à composer une page, rangés comme dans le DS (sélection validée à
// partir de l'inventaire Figma). Les pièces internes (barres de graphe,
// jours de calendrier…) n'y figurent pas : elles sont codées à la demande
// quand un composant du panneau en a besoin.
export const panelSelection: { level: string; names: string[] }[] = [
  {
    level: 'Atomes',
    names: [
      'button',
      'button/toggle',
      'check-box',
      'text/title',
      'text/label',
      'Tag',
      'avatar',
      'logo',
      'notification',
    ],
  },
  {
    level: 'Molécules',
    names: [
      'header',
      'search-bar',
      'cells.data',
      'toggle/content',
      'check-box-content',
      'title.toggle',
      'profil+texte',
      'number + icon + indicator',
      'donut + indicator',
    ],
  },
  {
    level: 'Organismes',
    names: [
      'menu',
      'calendrier',
      'calendar-weekly',
      'card.satisfaction',
      'card - % - stock',
      'card-q-stock',
      'card.donut',
      'map',
      'settings/card',
    ],
  },
];
