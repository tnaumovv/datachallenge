import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  variant?: 'primary' | 'secondary';
  children: ReactNode;
};

export function ActionButton({
  icon,
  variant = 'secondary',
  children,
  className = '',
  type = 'button',
  ...props
}: ActionButtonProps) {
  return (
    <button {...props} type={type} className={`button ${variant} action-button ${className}`}>
      <span className="button-icon">
        <Icon name={icon} size={18} />
      </span>
      <span>{children}</span>
    </button>
  );
}
