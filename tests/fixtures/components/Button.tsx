import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './Button.css'

export type ButtonVariant = 'filled' | 'outline' | 'icon'
export type ButtonSize = 'small' | 'default'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Propriété Figma « style » */
  variant?: ButtonVariant
  /** Propriété Figma « Size » (« Par défaut » = 'default') */
  size?: ButtonSize
  /** Propriété Figma « error » */
  error?: boolean
  /** Icône avant le texte (Figma « icon/Arrow circle left ») */
  iconLeft?: ReactNode
  /** Icône après le texte (Figma « icon/Arrow circle right ») */
  iconRight?: ReactNode
}

/**
 * Bouton du Design System.
 * En variant « icon », children est l'icône : passe obligatoirement un aria-label.
 */
function Button({
  variant = 'filled',
  size = 'default',
  error = false,
  iconLeft,
  iconRight,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    'button',
    `button--${variant}`,
    `button--${size}`,
    error && 'button--error',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  if (variant === 'icon') {
    return (
      <button type={type} className={classes} {...rest}>
        <span className="button__icon" aria-hidden="true">
          {children}
        </span>
      </button>
    )
  }

  return (
    <button type={type} className={classes} {...rest}>
      {iconLeft && (
        <span className="button__icon" aria-hidden="true">
          {iconLeft}
        </span>
      )}
      <span className="button__label">{children}</span>
      {iconRight && (
        <span className="button__icon" aria-hidden="true">
          {iconRight}
        </span>
      )}
    </button>
  )
}

export default Button
