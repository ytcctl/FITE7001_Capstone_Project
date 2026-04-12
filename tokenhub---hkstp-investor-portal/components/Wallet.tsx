import React, { useState } from 'react';
import { CreditCard, ArrowUpRight, ArrowDownLeft, Wallet as WalletIcon, Copy, QrCode } from 'lucide-react';
import { User, Transaction } from '../types';
import { MOCK_TRANSACTIONS } from '../constants';

interface WalletProps {
  user: User;
}

const Wallet: React.FC<WalletProps> = ({ user }) => {
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState<string>('');
  const [step, setStep] = useState<'INPUT' | 'FPS'>('INPUT');

  return (
    <div className="space-y-6">
      <header className="mb-8">
        <h2 className="text-2xl font-bold text-white">Wallet & Settlement</h2>
        <p className="text-gray-400">Manage your tokenized HKD and transaction history.</p>
      </header>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-white/10 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-32 bg-purple-500/20 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
          <div className="flex items-start justify-between relative z-10">
            <div>
              <p className="text-slate-400 font-medium mb-1">Tokenized Cash Balance</p>
              <h3 className="text-3xl font-bold">HKD {user.cashBalance.toLocaleString()}</h3>
            </div>
            <div className="p-3 bg-white/10 rounded-xl backdrop-blur-sm border border-white/5">
              <WalletIcon size={24} className="text-purple-400" />
            </div>
          </div>
          <div className="mt-8 flex gap-3 relative z-10">
            <button 
              onClick={() => setShowDeposit(true)}
              className="flex-1 bg-gradient-to-r from-blue-600 to-cyan-500 hover:shadow-lg hover:shadow-blue-500/20 text-white py-2.5 rounded-xl font-medium transition-all flex items-center justify-center gap-2"
            >
              <ArrowDownLeft size={18} /> Deposit (FPS)
            </button>
            <button className="flex-1 bg-white/10 hover:bg-white/20 text-white py-2.5 rounded-xl font-medium transition-all flex items-center justify-center gap-2 border border-white/5">
              <ArrowUpRight size={18} /> Withdraw
            </button>
          </div>
        </div>

        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-sm">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-gray-400 font-medium mb-1">Wallet Address (ERC-20)</p>
              <div className="flex items-center gap-2 bg-black/20 px-3 py-1.5 rounded-lg border border-white/10">
                <code className="text-sm text-gray-300">{user.walletAddress}</code>
                <button className="text-gray-500 hover:text-purple-400">
                  <Copy size={14} />
                </button>
              </div>
            </div>
          </div>
          <div className="space-y-3">
             <div className="flex justify-between items-center text-sm">
               <span className="text-gray-400">Status</span>
               <span className="text-emerald-400 font-medium bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">Whitelisted</span>
             </div>
             <div className="flex justify-between items-center text-sm">
               <span className="text-gray-400">Daily Limit</span>
               <span className="text-white font-medium">500,000 HKD</span>
             </div>
             <div className="flex justify-between items-center text-sm">
               <span className="text-gray-400">Security</span>
               <span className="text-white font-medium">Multisig Enabled</span>
             </div>
          </div>
        </div>
      </div>

      {/* Transactions */}
      <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-white/10">
          <h3 className="font-bold text-lg text-white">Transaction History</h3>
        </div>
        <table className="w-full">
          <thead className="bg-white/5 text-left text-xs font-semibold text-gray-400 uppercase">
            <tr>
              <th className="px-6 py-4">Type</th>
              <th className="px-6 py-4">Asset</th>
              <th className="px-6 py-4">Amount</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {MOCK_TRANSACTIONS.map((tx) => (
              <tr key={tx.id} className="hover:bg-white/5 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-full ${
                      tx.type.includes('DEPOSIT') || tx.type.includes('SELL') 
                        ? 'bg-emerald-500/20 text-emerald-400' 
                        : 'bg-rose-500/20 text-rose-400'
                    }`}>
                      {tx.type.includes('DEPOSIT') ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                    </div>
                    <span className="text-sm font-medium text-gray-200">
                      {tx.type.replace('_', ' ')}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-gray-400">{tx.asset}</td>
                <td className={`px-6 py-4 text-sm font-medium ${
                   tx.type.includes('DEPOSIT') || tx.type.includes('SELL') ? 'text-emerald-400' : 'text-white'
                }`}>
                  {tx.type.includes('DEPOSIT') || tx.type.includes('SELL') ? '+' : '-'}{tx.amount.toLocaleString()}
                </td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/20">
                    {tx.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">{tx.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Deposit Modal */}
      {showDeposit && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-white">Deposit Funds</h3>
              <button onClick={() => { setShowDeposit(false); setStep('INPUT'); }} className="text-gray-400 hover:text-white">
                &times;
              </button>
            </div>

            {step === 'INPUT' ? (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Amount (HKD)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-3 text-gray-500">HKD</span>
                    <input 
                      type="number" 
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:ring-2 focus:ring-purple-500 outline-none text-lg font-medium text-white placeholder-gray-600"
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-xl flex gap-3 text-sm text-blue-300">
                  <div className="shrink-0 mt-0.5"><CreditCard size={16} /></div>
                  <p>Funds deposited via FPS are instantly tokenized 1:1 into your wallet for settlement.</p>
                </div>
                <button 
                  onClick={() => setStep('FPS')}
                  disabled={!depositAmount}
                  className="w-full bg-gradient-to-r from-blue-600 to-cyan-500 text-white py-3 rounded-xl font-medium hover:shadow-lg hover:shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Generate FPS Code
                </button>
              </div>
            ) : (
              <div className="text-center space-y-6">
                <div className="bg-white border-2 border-white p-4 rounded-xl inline-block mx-auto">
                   {/* Placeholder for QR Code */}
                   <QrCode size={160} className="text-black" />
                </div>
                <div>
                  <p className="text-gray-400 text-sm mb-1">Scan to pay</p>
                  <p className="text-2xl font-bold text-white">HKD {Number(depositAmount).toLocaleString()}</p>
                </div>
                <p className="text-xs text-gray-500">Reference: REF-{Math.floor(Math.random() * 1000000)}</p>
                <button 
                  onClick={() => { setShowDeposit(false); setStep('INPUT'); setDepositAmount(''); }}
                  className="w-full bg-gradient-to-r from-emerald-600 to-emerald-500 text-white py-3 rounded-xl font-medium hover:shadow-lg hover:shadow-emerald-500/20"
                >
                  I have paid
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Wallet;