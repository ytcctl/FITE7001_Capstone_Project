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
import OracleCommittee from './pages/OracleCommittee';
import TokenDetail from './pages/TokenDetail';
import { useWeb3 } from './context/Web3Context';
import { NETWORK_CONFIG } from './config/contracts';
import { AlertTriangle } from 'lucide-react';

/** Route guard — allows Admin OR Agent (KYC, Minting) */
const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { roles, rolesLoading, account } = useWeb3();
  if (!account || rolesLoading) return null;
  if (!roles.isAdmin && !roles.isAgent) return <Navigate to="/" replace />;
  return <>{children}</>;
};

/** Strict route guard — Admin only (Compliance, Token Mgmt, Markets, Custody).
 *  Agent has no on-chain role on these contracts, so UI access is blocked. */
const AdminOnlyRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { roles, rolesLoading, account } = useWeb3();
  if (!account || rolesLoading) return null;
  if (!roles.isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
};

/** Route guard — allows Admin, Agent, OR Operator (Oracle Committee).
 *  All three are initial oracle members. */
const PrivilegedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { roles, rolesLoading, account } = useWeb3();
  if (!account || rolesLoading) return null;
  if (!roles.isAdmin && !roles.isAgent && !roles.isOperator) return <Navigate to="/" replace />;
  return <>{children}</>;
};

/** Banner shown when wallet is on the wrong network */
const WrongNetworkBanner: React.FC = () => {
  const { wrongNetwork, switchNetwork, chainId, walletMode } = useWeb3();

  if (!wrongNetwork) return null;
  return (
    <div className="fixed top-0 left-0 right-0 bg-red-600 text-white px-4 py-3 flex items-center justify-center gap-3 text-sm font-medium z-[9999] shadow-lg">
      <AlertTriangle size={18} />
      <span>
        Wrong network detected (Chain ID: {chainId ?? '?'}). Please switch to{' '}
        <strong>{NETWORK_CONFIG.chainName}</strong> (Chain ID: {NETWORK_CONFIG.chainId}).
      </span>
      {walletMode === 'metamask' && (
        <button
          onClick={switchNetwork}
          className="ml-2 bg-white text-red-700 px-3 py-1 rounded-lg font-bold text-xs hover:bg-red-100 transition-colors"
        >
          Switch Network
        </button>
      )}
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
          {/* Admin + Agent routes (Agent has AGENT_ROLE on these contracts) */}
          <Route path="/kyc" element={<AdminRoute><KYCManagement /></AdminRoute>} />
          <Route path="/mint" element={<AdminRoute><TokenMinting /></AdminRoute>} />
          {/* Admin + Agent + Operator route (all are oracle members) */}
          <Route path="/oracle" element={<PrivilegedRoute><OracleCommittee /></PrivilegedRoute>} />
          {/* Admin-only routes (Agent has NO on-chain role on these contracts) */}
          <Route path="/compliance" element={<AdminOnlyRoute><ComplianceRules /></AdminOnlyRoute>} />
          <Route path="/tokens" element={<AdminOnlyRoute><TokenManagement /></AdminOnlyRoute>} />
          <Route path="/custody" element={<AdminOnlyRoute><WalletCustody /></AdminOnlyRoute>} />
          <Route path="/markets" element={<AdminOnlyRoute><MarketManagement /></AdminOnlyRoute>} />
          <Route path="/token/:address" element={<AdminOnlyRoute><TokenDetail /></AdminOnlyRoute>} />
          {/* Public routes */}
          <Route path="/settlement" element={<Settlement />} />
          <Route path="/governance" element={<Governance />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/trading" element={<Trading />} />
        </Routes>
      </Layout>
    </>
  );
};

export default App;
