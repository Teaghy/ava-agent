import { useState, useId, useRef, useEffect } from 'react';
import { Popover } from 'radix-ui';
import { DayPicker } from '@daypicker/react';
import { zhCN } from '@daypicker/react/locale';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { Select } from './select';
import { parseLocalDateTime, formatLocalDateTime } from './date-time';

const pad = (n: number) => String(n).padStart(2, '0');
export function DateTimePicker({
  value,
  defaultValue = '',
  onValueChange,
  name,
  disabled,
  min,
  'aria-label': ariaLabel = '选择日期和时间',
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  disabled?: boolean;
  min?: string;
  'aria-label'?: string;
}) {
  const [internal, setInternal] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = value ?? internal;
  const selected = parseLocalDateTime(current);
  const minimum = min ? parseLocalDateTime(min) : undefined;
  const invalid = !!current && (!selected || (!!min && current < min));
  const change = (next: string) => {
    setInternal(next);
    onValueChange?.(next);
  };
  useEffect(() => {
    const form = button.current?.closest('form');
    const reset = () => setInternal(defaultValue);
    form?.addEventListener('reset', reset);
    return () => form?.removeEventListener('reset', reset);
  }, [defaultValue]);
  const apply = (date: Date) => {
    const next = formatLocalDateTime(date);
    change(min && next < min ? min : next);
  };
  return (
    <>
      <input type="hidden" name={name} value={current} disabled={disabled} />
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            ref={button}
            type="button"
            disabled={disabled}
            aria-label={ariaLabel}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? id : undefined}
            className="ui-date-trigger"
          >
            <CalendarDays size={16} />
            <span>
              {selected
                ? `${formatLocalDateTime(selected).slice(0, 10)} ${current.slice(11)}`
                : '选择日期和时间'}
            </span>
            <ChevronDown size={14} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="ui-date-popover"
            aria-label={ariaLabel}
            align="start"
            sideOffset={6}
            collisionPadding={12}
          >
            <DayPicker
              mode="single"
              locale={zhCN}
              selected={selected}
              defaultMonth={selected ?? minimum}
              showOutsideDays
              fixedWeeks
              disabled={
                minimum
                  ? {
                      before: new Date(
                        minimum.getFullYear(),
                        minimum.getMonth(),
                        minimum.getDate(),
                      ),
                    }
                  : undefined
              }
              onSelect={(day) => {
                if (!day) return;
                day.setHours(selected?.getHours() ?? 0, selected?.getMinutes() ?? 0, 0, 0);
                apply(day);
              }}
            />
            <div className="ui-time-fields">
              <span>时间</span>
              <Select
                aria-label="小时"
                value={pad(selected?.getHours() ?? 0)}
                options={Array.from({ length: 24 }, (_, hour) => ({
                  value: pad(hour),
                  label: pad(hour),
                }))}
                disabled={!selected}
                onValueChange={(hour) => {
                  if (selected) {
                    const date = new Date(selected);
                    date.setHours(Number(hour));
                    apply(date);
                  }
                }}
              />
              <span>:</span>
              <Select
                aria-label="分钟"
                value={pad(selected?.getMinutes() ?? 0)}
                options={Array.from({ length: 60 }, (_, minute) => ({
                  value: pad(minute),
                  label: pad(minute),
                }))}
                disabled={!selected}
                onValueChange={(minute) => {
                  if (selected) {
                    const date = new Date(selected);
                    date.setMinutes(Number(minute));
                    apply(date);
                  }
                }}
              />
            </div>
            <div className="ui-date-actions">
              <button
                type="button"
                className="ui-button ui-button-secondary"
                onClick={() => {
                  change('');
                  setOpen(false);
                }}
              >
                清除
              </button>
              <button
                type="button"
                className="ui-button ui-button-primary"
                onClick={() => setOpen(false)}
              >
                完成
              </button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {invalid && (
        <span id={id} className="ui-field-error">
          请选择有效时间，结束时间不能早于开始时间。
        </span>
      )}
    </>
  );
}
