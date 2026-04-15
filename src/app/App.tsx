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
        <Route path="/team/:id" element={<TeamDetail />} />
        <Route path="/coach/:id" element={<CoachDetail />} />
        <Route path="/history" element={<History />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}
