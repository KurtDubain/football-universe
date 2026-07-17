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

export function RouteLoading({ fullPage = false }: { fullPage?: boolean }) {
  return (
    <div
      role="status"
      aria-label="正在加载页面"
      className={`${fullPage ? 'min-h-screen px-5 py-12 bg-slate-900' : 'min-h-72 py-1'} w-full`}
    >
      <span className="sr-only">正在加载...</span>
      <div className="w-full max-w-4xl mx-auto space-y-4 animate-pulse motion-reduce:animate-none" aria-hidden="true">
        <div className="h-7 w-32 rounded-md bg-slate-800" />
        <div className="h-20 rounded-lg border border-slate-700/60 bg-slate-800/70" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="h-36 rounded-lg border border-slate-700/60 bg-slate-800/70" />
          <div className="h-36 rounded-lg border border-slate-700/60 bg-slate-800/70" />
        </div>
      </div>
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
