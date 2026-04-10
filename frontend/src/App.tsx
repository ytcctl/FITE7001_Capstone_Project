import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import KYCManagement from './pages/KYCManagement';
import TokenMinting from './pages/TokenMinting';
import Settlement from './pages/Settlement';
import ComplianceRules from './pages/ComplianceRules';
import Portfolio from './pages/Portfolio';
import TokenManagement from './pages/TokenManagement';
import { useWeb3 } from './context/Web3Context';

/** Route guard — redirects non-admin users to the dashboard */
const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { roles, rolesLoading, account } = useWeb3();
  // While loading roles or not connected, show nothing (avoids flash)
  if (!account || rolesLoading) return null;
  if (!roles.isAdmin && !roles.isAgent) return <Navigate to="/" replace />;
  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/kyc" element={<AdminRoute><KYCManagement /></AdminRoute>} />
        <Route path="/mint" element={<AdminRoute><TokenMinting /></AdminRoute>} />
        <Route path="/settlement" element={<Settlement />} />
        <Route path="/compliance" element={<AdminRoute><ComplianceRules /></AdminRoute>} />
        <Route path="/tokens" element={<AdminRoute><TokenManagement /></AdminRoute>} />
        <Route path="/portfolio" element={<Portfolio />} />
      </Routes>
    </Layout>
  );
};

export default App;
