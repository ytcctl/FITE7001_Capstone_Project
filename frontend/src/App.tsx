import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import KYCManagement from './pages/KYCManagement';
import TokenMinting from './pages/TokenMinting';
import Settlement from './pages/Settlement';
import ComplianceRules from './pages/ComplianceRules';
import Portfolio from './pages/Portfolio';

const App: React.FC = () => {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/kyc" element={<KYCManagement />} />
        <Route path="/mint" element={<TokenMinting />} />
        <Route path="/settlement" element={<Settlement />} />
        <Route path="/compliance" element={<ComplianceRules />} />
        <Route path="/portfolio" element={<Portfolio />} />
      </Routes>
    </Layout>
  );
};

export default App;
