import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import Layout from './Layout';
import Dashboard from '../pages/Dashboard';
import Calendar from '../pages/Calendar';
import League from '../pages/League';
import Cup from '../pages/Cup';
import Coaches from '../pages/Coaches';
import TeamDetail from '../pages/TeamDetail';
import CoachDetail from '../pages/CoachDetail';
import History from '../pages/History';
import Compare from '../pages/Compare';
import Chronicle from '../pages/Chronicle';
import Legends from '../pages/Legends';
import Teams from '../pages/Teams';
import Players from '../pages/Players';
import PlayerDetail from '../pages/PlayerDetail';
import Settings from '../pages/Settings';
import Welcome from '../pages/Welcome';
import TeamEditor from '../pages/TeamEditor';
import Transfers from '../pages/Transfers';
import Market from '../pages/Market';
import MemorableMatches from '../pages/MemorableMatches';
import AdvancedSearch from '../pages/AdvancedSearch';

export default function App() {
  const initialized = useGameStore((s) => s.initialized);
  const location = useLocation();

  if (!initialized) {
    if (location.pathname === '/team-editor') return <TeamEditor />;
    return <Welcome />;
  }

  return (
    <Layout>
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
    </Layout>
  );
}
