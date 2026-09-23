// 极简 hash 路由：/ 曲目列表 · /score/:id 编辑器 · /score/:id/print 打印 · /library 曲牌库 · /settings 设置
import { useEffect, useState, type ReactNode } from 'react';
import { ScoreList } from './pages/ScoreList';
import { Editor } from './pages/Editor';
import { Print } from './pages/Print';
import { Library } from './pages/Library';
import { Settings } from './pages/Settings';
import { SettingsProvider } from './settingsContext';

function parseHash(): { page: string; id?: string } {
  const h = window.location.hash.replace(/^#/, '') || '/';
  let m = h.match(/^\/score\/([^/]+)\/print$/);
  if (m) return { page: 'print', id: decodeURIComponent(m[1]) };
  m = h.match(/^\/score\/([^/]+)$/);
  if (m) return { page: 'editor', id: decodeURIComponent(m[1]) };
  if (h.startsWith('/library')) return { page: 'library' };
  if (h.startsWith('/settings')) return { page: 'settings' };
  return { page: 'list' };
}

function Nav() {
  const cur = window.location.hash || '#/';
  const item = (href: string, label: string, testid: string) => (
    <a href={href} className={`nav-item ${cur === href ? 'on' : ''}`} data-testid={testid}>
      {label}
    </a>
  );
  return (
    <nav className="top-nav">
      <span className="brand">锣鼓经记谱</span>
      {item('#/', '曲目', 'nav-list')}
      {item('#/library', '曲牌库', 'nav-library')}
      {item('#/settings', '设置', 'nav-settings')}
    </nav>
  );
}

function Page({ children }: { children: ReactNode }) {
  return (
    <>
      <Nav />
      {children}
    </>
  );
}

export function App() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const fn = () => setRoute(parseHash());
    window.addEventListener('hashchange', fn);
    return () => window.removeEventListener('hashchange', fn);
  }, []);

  let content: ReactNode;
  if (route.page === 'editor') content = <Editor scoreId={route.id!} onNavigate={(h) => (window.location.hash = h)} />;
  else if (route.page === 'print') content = <Print scoreId={route.id!} />;
  else if (route.page === 'library') content = <Library />;
  else if (route.page === 'settings') content = <Settings />;
  else content = <ScoreList />;

  const bare = route.page === 'print';
  return <SettingsProvider>{bare ? content : <Page>{content}</Page>}</SettingsProvider>;
}
