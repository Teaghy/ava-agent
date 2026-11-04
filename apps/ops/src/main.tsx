import { UIProvider } from '@ava/ui';
import { createRoot } from 'react-dom/client';
import { PluginsPage } from './pages/PluginsPage';
import './styles.css';
import '@ava/ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');
createRoot(root).render(
  <UIProvider>
    <PluginsPage />
  </UIProvider>,
);
