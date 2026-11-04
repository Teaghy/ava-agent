import { AlertDialog, Dialog as Primitive } from 'radix-ui';
import { configureNonce } from './nonce';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = '',
  busy = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
  busy?: boolean;
}) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Primitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <Primitive.Portal>
        <Primitive.Overlay className="ui-overlay" />
        <Primitive.Content
          className={`ui-dialog-content ${className}`}
          onOpenAutoFocus={() => {
            opener.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(e) => {
            if (opener.current?.isConnected) {
              e.preventDefault();
              opener.current.focus();
            }
          }}
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <Primitive.Title className="ui-sr-only">{title}</Primitive.Title>
          <Primitive.Description className="ui-sr-only">{description}</Primitive.Description>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
interface Confirmation {
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
}
const ConfirmContext = createContext<((options: Confirmation) => Promise<boolean>) | undefined>(
  undefined,
);
export function UIProvider({ children }: { children: ReactNode }) {
  configureNonce();
  const [request, setRequest] = useState<Confirmation>();
  const resolve = useRef<((result: boolean) => void) | undefined>(undefined);
  const opener = useRef<HTMLElement | null>(null);
  const confirm = useCallback(
    (options: Confirmation) =>
      new Promise<boolean>((done) => {
        if (resolve.current) {
          done(false);
          return;
        }
        opener.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        resolve.current = done;
        setRequest(options);
      }),
    [],
  );
  const finish = (result: boolean) => {
    const done = resolve.current;
    resolve.current = undefined;
    setRequest(undefined);
    done?.(result);
  };
  useEffect(() => () => resolve.current?.(false), []);
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog.Root
        open={!!request}
        onOpenChange={(open) => {
          if (!open) finish(false);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="ui-overlay" />
          <AlertDialog.Content
            className="ui-dialog-content ui-confirm"
            onCloseAutoFocus={(e) => {
              if (opener.current?.isConnected) {
                e.preventDefault();
                opener.current.focus();
              }
            }}
          >
            <AlertDialog.Title className="ui-dialog-title">{request?.title}</AlertDialog.Title>
            <AlertDialog.Description className="ui-dialog-description">
              {request?.description}
            </AlertDialog.Description>
            <div className="ui-dialog-actions">
              <AlertDialog.Cancel asChild>
                <button className="ui-button ui-button-secondary" onClick={() => finish(false)}>
                  取消
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  className={`ui-button ${request?.danger ? 'ui-button-danger' : 'ui-button-primary'}`}
                  onClick={() => finish(true)}
                >
                  {request?.confirmLabel ?? '确认'}
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </ConfirmContext.Provider>
  );
}
export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('UIProvider is required');
  return confirm;
}
