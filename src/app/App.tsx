import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import Layout from './Layout';
import Welcome from '../pages/Welcome';
import { RecoverableRoute } from './route-resource';

const routeImporters = {
  dashboard: () => import('../pages/Dashboard'),
  calendar: () => import('../pages/Calendar'),
  league: () => import('../pages/League'),
  cup: () => import('../pages/Cup'),
  coaches: () => import('../pages/Coaches'),
  teamDetail: () => import('../pages/TeamDetail'),
  coachDetail: () => import('../pages/CoachDetail'),
  history: () => import('../pages/History'),
  compare: () => import('../pages/Compare'),
  chronicle: () => import('../pages/Chronicle'),
  legends: () => import('../pages/Legends'),
  teams: () => import('../pages/Teams'),
  players: () => import('../pages/Players'),
  playerDetail: () => import('../pages/PlayerDetail'),
  settings: () => import('../pages/Settings'),
  teamEditor: () => import('../pages/TeamEditor'),
  transfers: () => import('../pages/Transfers'),
  market: () => import('../pages/Market'),
  memorable: () => import('../pages/MemorableMatches'),
  search: () => import('../pages/AdvancedSearch'),
};

export { RouteLoading } from './route-resource';

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

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<RecoverableRoute routeId="dashboard" importer={routeImporters.dashboard} />} />
        <Route path="/calendar" element={<RecoverableRoute routeId="calendar" importer={routeImporters.calendar} />} />
        <Route path="/league/:level" element={<RecoverableRoute routeId="league" importer={routeImporters.league} />} />
        <Route path="/cup/:type" element={<RecoverableRoute routeId="cup" importer={routeImporters.cup} />} />
        <Route path="/teams" element={<RecoverableRoute routeId="teams" importer={routeImporters.teams} />} />
        <Route path="/coaches" element={<RecoverableRoute routeId="coaches" importer={routeImporters.coaches} />} />
        <Route path="/players" element={<RecoverableRoute routeId="players" importer={routeImporters.players} />} />
        <Route path="/player/:id" element={<RecoverableRoute routeId="player-detail" importer={routeImporters.playerDetail} />} />
        <Route path="/team/:id" element={<RecoverableRoute routeId="team-detail" importer={routeImporters.teamDetail} />} />
        <Route path="/coach/:id" element={<RecoverableRoute routeId="coach-detail" importer={routeImporters.coachDetail} />} />
        <Route path="/history" element={<RecoverableRoute routeId="history" importer={routeImporters.history} />} />
        <Route path="/chronicle" element={<RecoverableRoute routeId="chronicle" importer={routeImporters.chronicle} />} />
        <Route path="/legends" element={<RecoverableRoute routeId="legends" importer={routeImporters.legends} />} />
        <Route path="/transfers" element={<RecoverableRoute routeId="transfers" importer={routeImporters.transfers} />} />
        <Route path="/market" element={<RecoverableRoute routeId="market" importer={routeImporters.market} />} />
        <Route path="/memorable" element={<RecoverableRoute routeId="memorable" importer={routeImporters.memorable} />} />
        <Route path="/search" element={<RecoverableRoute routeId="search" importer={routeImporters.search} />} />
        <Route path="/compare" element={<RecoverableRoute routeId="compare" importer={routeImporters.compare} />} />
        <Route path="/team-editor" element={<RecoverableRoute routeId="team-editor" importer={routeImporters.teamEditor} />} />
        <Route path="/settings" element={<RecoverableRoute routeId="settings" importer={routeImporters.settings} />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}
