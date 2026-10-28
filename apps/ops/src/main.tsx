import { createRoot } from 'react-dom/client';
import { PluginsPage } from './pages/PluginsPage';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');
createRoot(root).render(<PluginsPage />);
