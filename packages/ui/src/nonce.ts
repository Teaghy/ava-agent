import { setNonce } from 'get-nonce';

// Radix's scroll-lock styles use the server nonce without allowing arbitrary inline CSS.
export function configureNonce() {
  const nonce =
    typeof document === 'undefined'
      ? undefined
      : document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;
  if (nonce) setNonce(nonce);
  return nonce;
}
