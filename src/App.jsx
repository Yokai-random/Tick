import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import ProgressModal from './components/ProgressModal';
import PendantWidget from './components/PendantWidget';
import HomePage from './pages/HomePage';
import DownloadPage from './pages/DownloadPage';
import SettingsPage from './pages/SettingsPage';
import ModsPage from './pages/ModsPage';
import VersionsPage from './pages/VersionsPage';
import ServerPage from './pages/ServerPage';

function AppInner() {
  const { page } = useApp();
  return (
    <div className="app-layout">
      <TitleBar />
      <div className="app-body">
        <Sidebar />
        <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {page === 'home' && <HomePage />}
          {page === 'download' && <DownloadPage />}
          {page === 'mods' && <ModsPage />}
          {page === 'versions' && <VersionsPage />}
          {page === 'server'   && <ServerPage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
      <ProgressModal />
      <PendantWidget />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  );
}
