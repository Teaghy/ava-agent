import { UIProvider } from '@ava/ui';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import '@ava/ui/styles.css';
const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');
createRoot(root).render(
  <UIProvider>
    <App />
  </UIProvider>,
);
