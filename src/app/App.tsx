import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import Layout from './Layout';
import Dashboard from '../pages/Dashboard';
import Welcome from '../pages/Welcome';

const Calendar = lazy(() => import('../pages/Calendar'));
const League = lazy(() => import('../pages/League'));
const Cup = lazy(() => import('../pages/Cup'));
const Coaches = lazy(() => import('../pages/Coaches'));
const TeamDetail = lazy(() => import('../pages/TeamDetail'));
const CoachDetail = lazy(() => import('../pages/CoachDetail'));
const History = lazy(() => import('../pages/History'));
const Compare = lazy(() => import('../pages/Compare'));
const Chronicle = lazy(() => import('../pages/Chronicle'));
const Legends = lazy(() => import('../pages/Legends'));
const Teams = lazy(() => import('../pages/Teams'));
const Players = lazy(() => import('../pages/Players'));
const PlayerDetail = lazy(() => import('../pages/PlayerDetail'));
const Settings = lazy(() => import('../pages/Settings'));
const TeamEditor = lazy(() => import('../pages/TeamEditor'));
const Transfers = lazy(() => import('../pages/Transfers'));
const Market = lazy(() => import('../pages/Market'));
const MemorableMatches = lazy(() => import('../pages/MemorableMatches'));
const AdvancedSearch = lazy(() => import('../pages/AdvancedSearch'));

function RouteLoading({ fullPage = false }: { fullPage?: boolean }) {
  return (
    <div
      role="status"
      className={`${fullPage ? 'min-h-screen' : 'min-h-[50vh]'} grid place-items-center bg-slate-950 text-sm text-slate-400`}
    >
      正在加载...
    </div>
  );
}

export default function App() {
  const initialized = useGameStore((s) => s.initialized);
  const location = useLocation();

  if (!initialized) {
    if (location.pathname === '/team-editor') {
      return <Suspense fallback={<RouteLoading fullPage />}><TeamEditor /></Suspense>;
    }
    return <Welcome />;
  }

  return (
    <Layout>
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/league/:level" element={<League />} />
          <Route path="/cup/:type" element={<Cup />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/coaches" element={<Coaches />} />
          <Route path="/players" element={<Players />} />
          <Route path="/player/:id" element={<PlayerDetail />} />
          <Route path="/team/:id" element={<TeamDetail />} />
          <Route path="/coach/:id" element={<CoachDetail />} />
          <Route path="/history" element={<History />} />
          <Route path="/chronicle" element={<Chronicle />} />
          <Route path="/legends" element={<Legends />} />
          <Route path="/transfers" element={<Transfers />} />
          <Route path="/market" element={<Market />} />
          <Route path="/memorable" element={<MemorableMatches />} />
          <Route path="/search" element={<AdvancedSearch />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/team-editor" element={<TeamEditor />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
