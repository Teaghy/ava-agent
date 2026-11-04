import { Checkbox as Primitive } from 'radix-ui';
import { Check } from 'lucide-react';

export function Checkbox({
  checked,
  defaultChecked,
  onCheckedChange,
  name,
  id,
  disabled,
  'aria-label': ariaLabel,
}: {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (value: boolean) => void;
  name?: string;
  id?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <Primitive.Root
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={(value) => onCheckedChange?.(value === true)}
      name={name}
      id={id}
      disabled={disabled}
      aria-label={ariaLabel}
      className="ui-checkbox"
    >
      <Primitive.Indicator className="ui-checkbox-indicator">
        <Check size={13} strokeWidth={2.8} />
      </Primitive.Indicator>
    </Primitive.Root>
  );
}
