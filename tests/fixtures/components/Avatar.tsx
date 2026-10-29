import './Avatar.css'

export type AvatarUserType = 'rêveur' | 'cauchemar'

export interface AvatarProps {
  /** Variante Figma « user type » */
  userType?: AvatarUserType
  /** Nom lu par les lecteurs d'écran ; chaîne vide = avatar décoratif */
  label?: string
  className?: string
}

const variantClass: Record<AvatarUserType, string> = {
  'rêveur': 'avatar--reveur',
  'cauchemar': 'avatar--cauchemar',
}

function Avatar({ userType = 'rêveur', label, className }: AvatarProps) {
  const classes = ['avatar', variantClass[userType], className]
    .filter(Boolean)
    .join(' ')
  const accessibleLabel = label ?? `Avatar ${userType}`

  if (accessibleLabel === '') {
    return <span className={classes} aria-hidden="true" />
  }

  return <span className={classes} role="img" aria-label={accessibleLabel} />
}

export default Avatar
