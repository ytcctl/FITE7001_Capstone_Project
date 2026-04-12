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
import Governance from './pages/Governance';
import WalletCustody from './pages/WalletCustody';
import Trading from './pages/Trading';
import MarketManagement from './pages/MarketManagement';
import { useWeb3 } from './context/Web3Context';
import { NETWORK_CONFIG } from './config/contracts';
import { AlertTriangle } from 'lucide-react';

/** Route guard — redirects non-admin users to the dashboard */
const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { roles, rolesLoading, account } = useWeb3();
  // While loading roles or not connected, show nothing (avoids flash)
  if (!account || rolesLoading) return null;
  if (!roles.isAdmin && !roles.isAgent) return <Navigate to="/" replace />;
  return <>{children}</>;
};

/** Banner shown when MetaMask is on the wrong network */
const WrongNetworkBanner: React.FC = () => {
  const { wrongNetwork, switchNetwork, chainId } = useWeb3();

  // Debug — remove after confirming fix works
  React.useEffect(() => {
    console.log('[WrongNetworkBanner] wrongNetwork =', wrongNetwork, '| chainId =', chainId);
  }, [wrongNetwork, chainId]);

  if (!wrongNetwork) return null;
  return (
    <div className="fixed top-0 left-0 right-0 bg-red-600 text-white px-4 py-3 flex items-center justify-center gap-3 text-sm font-medium z-[9999] shadow-lg">
      <AlertTriangle size={18} />
      <span>
        Wrong network detected (Chain ID: {chainId ?? '?'}). Please switch to{' '}
        <strong>{NETWORK_CONFIG.chainName}</strong> (Chain ID: {NETWORK_CONFIG.chainId}).
      </span>
      <button
        onClick={switchNetwork}
        className="ml-2 bg-white text-red-700 px-3 py-1 rounded-lg font-bold text-xs hover:bg-red-100 transition-colors"
      >
        Switch Network
      </button>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <>
      <WrongNetworkBanner />
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/kyc" element={<AdminRoute><KYCManagement /></AdminRoute>} />
          <Route path="/mint" element={<AdminRoute><TokenMinting /></AdminRoute>} />
          <Route path="/settlement" element={<Settlement />} />
          <Route path="/compliance" element={<AdminRoute><ComplianceRules /></AdminRoute>} />
          <Route path="/tokens" element={<AdminRoute><TokenManagement /></AdminRoute>} />
          <Route path="/custody" element={<AdminRoute><WalletCustody /></AdminRoute>} />
          <Route path="/governance" element={<Governance />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/trading" element={<Trading />} />
          <Route path="/markets" element={<AdminRoute><MarketManagement /></AdminRoute>} />
        </Routes>
      </Layout>
    </>
  );
};

export default App;
