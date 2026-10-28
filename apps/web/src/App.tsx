import { useEffect, useState } from 'react';
import { ChatPage } from './pages/ChatPage';
import { PluginsPage } from './pages/PluginsPage';

export function App() {
  const [pluginsOpen, setPluginsOpen] = useState(() => location.hash === '#/plugins');
  useEffect(() => {
    const navigate = () => setPluginsOpen(location.hash === '#/plugins');
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  return (
    <>
      <div hidden={pluginsOpen}>
        <ChatPage visible={!pluginsOpen} />
      </div>
      {pluginsOpen && <PluginsPage />}
    </>
  );
}
