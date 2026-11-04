import { Select as Primitive } from 'radix-ui';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { configureNonce } from './nonce';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}
export function Select({
  options,
  value,
  defaultValue,
  onValueChange,
  name,
  id,
  disabled,
  placeholder = '请选择',
  className = '',
  'aria-label': ariaLabel,
}: {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <Primitive.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      name={name}
      disabled={disabled || !options.length}
    >
      <Primitive.Trigger
        id={id}
        aria-label={ariaLabel}
        className={`ui-select-trigger ${className}`}
      >
        <Primitive.Value placeholder={placeholder} />
        <Primitive.Icon asChild>
          <ChevronDown size={15} />
        </Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          position="popper"
          sideOffset={5}
          collisionPadding={12}
          className="ui-select-content"
        >
          <Primitive.ScrollUpButton className="ui-select-scroll">
            <ChevronUp size={15} />
          </Primitive.ScrollUpButton>
          <Primitive.Viewport className="ui-select-viewport" nonce={configureNonce()}>
            {options.map((option) => (
              <Primitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="ui-select-item"
              >
                <Primitive.ItemIndicator className="ui-select-check">
                  <Check size={14} />
                </Primitive.ItemIndicator>
                <Primitive.ItemText>{option.label}</Primitive.ItemText>
              </Primitive.Item>
            ))}
          </Primitive.Viewport>
          <Primitive.ScrollDownButton className="ui-select-scroll">
            <ChevronDown size={15} />
          </Primitive.ScrollDownButton>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
