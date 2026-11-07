import { useId, useState, type ComponentPropsWithoutRef } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../lib/utils';
import './select.css';

export type SelectOption = { value: string; label: string; disabled?: boolean };
type SelectProps = Omit<
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>,
  'value' | 'defaultValue' | 'onChange' | 'children'
> & {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  helperText?: string;
  required?: boolean;
};

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  helperText,
  required,
  disabled,
  className,
  'aria-describedby': describedBy,
  ...triggerProps
}: SelectProps) {
  const id = useId();
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const emptyValue = `__empty-select-${id}__`;
  const emptyOption = options.find((option) => option.value === '');
  // Radix reserves the empty string for a placeholder; filters also need a selectable "all".
  const selectedValue = value === '' && emptyOption && !emptyOption.disabled ? emptyValue : value;
  const helperId = helperText ? `${id}-helper` : undefined;
  const description = [describedBy, helperId].filter(Boolean).join(' ') || undefined;

  return (
    <>
      <SelectPrimitive.Root
        value={selectedValue}
        onValueChange={(next) => onValueChange(next === emptyValue ? '' : next)}
        disabled={disabled}
        required={required}
      >
        <SelectPrimitive.Trigger
          {...triggerProps}
          ref={setTrigger}
          className={cn('select-trigger', className)}
          aria-describedby={description}
        >
          <SelectPrimitive.Value
            data-select-value=""
            placeholder={placeholder ?? emptyOption?.label ?? 'Выберите значение'}
          />
          <SelectPrimitive.Icon className="select-chevron" asChild>
            <ChevronDown size={16} aria-hidden="true" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal container={trigger?.closest('dialog') ?? undefined}>
          <SelectPrimitive.Content
            className="select-content"
            position="popper"
            sideOffset={5}
            collisionPadding={12}
          >
            <SelectPrimitive.ScrollUpButton className="select-scroll-button">
              <ChevronUp size={16} aria-hidden="true" />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport className="select-viewport">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value === '' ? emptyValue : option.value}
                  disabled={option.disabled}
                  className="select-item"
                  textValue={option.label}
                >
                  <SelectPrimitive.ItemIndicator className="select-indicator">
                    <Check size={15} aria-hidden="true" />
                  </SelectPrimitive.ItemIndicator>
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className="select-scroll-button">
              <ChevronDown size={16} aria-hidden="true" />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {helperText && (
        <span id={helperId} className="select-helper">
          {helperText}
        </span>
      )}
    </>
  );
}
