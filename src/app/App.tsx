import { useLocation } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import Welcome from '../pages/Welcome';
import { RecoverableRoute } from './route-resource';
import { routeImporters } from './route-modules';

export { RouteLoading } from './route-resource';

const loadGameShell = () => import('./GameShell');

export default function App() {
  const initialized = useGameStore((s) => s.initialized);
  const location = useLocation();

  if (import.meta.env.VITE_ENABLE_AUDIT === 'true' && new URLSearchParams(location.search).get('auditError') === '1') {
    throw new Error('移动路由审计：模拟页面资源加载失败');
  }

  if (!initialized) {
    if (location.pathname === '/team-editor') {
      return <RecoverableRoute routeId="team-editor" importer={routeImporters.teamEditor} fullPage />;
    }
    return <Welcome />;
  }

  return <RecoverableRoute routeId="game-shell" importer={loadGameShell} fullPage />;
}
