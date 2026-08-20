import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './Layout';
import { RecoverableRoute } from './route-resource';
import { routeImporters } from './route-modules';

export default function GameShell() {
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
