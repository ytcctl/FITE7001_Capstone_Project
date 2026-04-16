import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Marketplace from './components/Marketplace';
import Trading from './components/Trading';
import Wallet from './components/Wallet';
import Onboarding from './components/Onboarding';
import IPO from './components/IPO';
import { User, KycStatus, Startup } from './types';
import { Sparkles } from 'lucide-react';

// Mock Initial User State
const INITIAL_USER: User = {
  id: 'u1',
  name: 'Tai Man Chan',
  email: 'taiman@example.com',
  kycStatus: KycStatus.NOT_STARTED,
  walletAddress: '0x71C...9A21',
  cashBalance: 250000,
  portfolioValue: 125400
};

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState('dashboard');
  const [selectedAsset, setSelectedAsset] = useState<Startup | null>(null);

  // Simple SSO Login Simulation
  const handleLogin = () => {
    // In real app: Redirect to IDP, wait for callback
    setUser(INITIAL_USER);
  };

  const handleKycComplete = () => {
    if (user) {
      setUser({ ...user, kycStatus: KycStatus.APPROVED });
    }
  };

  const handleAssetSelect = (asset: Startup) => {
    setSelectedAsset(asset);
    setView('trading');
  };

  const handleBackToMarket = () => {
    setSelectedAsset(null);
    setView('market');
  };

  // Render Logic
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 p-8 rounded-2xl shadow-2xl w-full max-w-md text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-purple-500/30">
            <Sparkles size={40} fill="white" className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">TokenHub Exchange</h1>
          <p className="text-gray-400 mb-8">Startup Token Trading</p>
          
          <div className="space-y-4">
            <button 
              onClick={handleLogin}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-3 px-4 rounded-xl font-bold hover:shadow-lg hover:shadow-purple-500/25 transition-all transform active:scale-[0.98]"
            >
              Sign in with HKSTP ID
            </button>
            <p className="text-xs text-gray-500">
              By signing in, you agree to the Terms of Service and Privacy Policy for regulated digital assets.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Force Onboarding if KYC not approved
  if (user.kycStatus !== KycStatus.APPROVED) {
    return (
      <div className="min-h-screen">
        <div className="bg-black/20 backdrop-blur-lg border-b border-white/10 px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3 font-bold text-xl text-white">
             <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center shadow-md shadow-purple-500/20">
                <Sparkles size={20} fill="currentColor" className="text-white" />
             </div>
             TokenHub Exchange
          </div>
          <button onClick={() => setUser(null)} className="text-sm text-gray-400 hover:text-white">Logout</button>
        </div>
        <Onboarding onComplete={handleKycComplete} />
      </div>
    );
  }

  // Main App Layout
  return (
    <div className="min-h-screen flex">
      <Sidebar currentView={view} setView={setView} onLogout={() => setUser(null)} />
      
      <main className="flex-1 ml-64 p-8">
        <div className="max-w-7xl mx-auto">
          {view === 'dashboard' && <Dashboard user={user} onNavigate={setView} />}
          
          {view === 'market' && <Marketplace onSelectAsset={handleAssetSelect} />}

          {view === 'ipo' && <IPO />}
          
          {view === 'trading' && selectedAsset && (
            <Trading asset={selectedAsset} onBack={handleBackToMarket} user={user} />
          )}

          {view === 'wallet' && <Wallet user={user} />}

          {view === 'profile' && (
             <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-12 text-center">
                <div className="w-24 h-24 bg-white/10 rounded-full mx-auto mb-4 flex items-center justify-center text-3xl font-bold text-gray-400">
                   {user.name.charAt(0)}
                </div>
                <h2 className="text-2xl font-bold text-white">{user.name}</h2>
                <p className="text-gray-400">{user.email}</p>
                <div className="mt-6 inline-flex items-center gap-2 bg-green-500/20 text-green-400 px-4 py-2 rounded-full font-medium border border-green-500/30">
                   <div className="w-2 h-2 bg-green-500 rounded-full shadow-[0_0_10px_rgba(34,197,94,0.5)]"></div> KYC Verified
                </div>
             </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;