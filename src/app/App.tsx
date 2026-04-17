import { Routes, Route, Navigate } from 'react-router-dom';
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
import Teams from '../pages/Teams';
import Players from '../pages/Players';
import PlayerDetail from '../pages/PlayerDetail';
import Settings from '../pages/Settings';
import Welcome from '../pages/Welcome';

export default function App() {
  const initialized = useGameStore((s) => s.initialized);

  if (!initialized) {
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
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}
