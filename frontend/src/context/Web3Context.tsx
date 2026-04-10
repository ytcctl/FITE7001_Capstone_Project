import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { ethers } from 'ethers';
import {
  NETWORK_CONFIG,
  CONTRACT_ADDRESSES,
  IDENTITY_REGISTRY_ABI,
  COMPLIANCE_ABI,
  SECURITY_TOKEN_ABI,
  CASH_TOKEN_ABI,
  DVP_SETTLEMENT_ABI,
} from '../config/contracts';

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------
export interface Contracts {
  identityRegistry: ethers.Contract;
  compliance: ethers.Contract;
  securityToken: ethers.Contract;
  cashToken: ethers.Contract;
  dvpSettlement: ethers.Contract;
}

interface Web3State {
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
  account: string | null;
  chainId: number | null;
  contracts: Contracts | null;
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const Web3Context = createContext<Web3State>({
  provider: null,
  signer: null,
  account: null,
  chainId: null,
  contracts: null,
  isConnecting: false,
  error: null,
  connect: async () => {},
  disconnect: () => {},
});

// -----------------------------------------------------------------
// Provider
// -----------------------------------------------------------------
export const Web3Provider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [contracts, setContracts] = useState<Contracts | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Build ethers contract instances bound to the signer */
  const initContracts = useCallback((s: ethers.JsonRpcSigner) => {
    setContracts({
      identityRegistry: new ethers.Contract(CONTRACT_ADDRESSES.identityRegistry, IDENTITY_REGISTRY_ABI, s),
      compliance: new ethers.Contract(CONTRACT_ADDRESSES.compliance, COMPLIANCE_ABI, s),
      securityToken: new ethers.Contract(CONTRACT_ADDRESSES.securityToken, SECURITY_TOKEN_ABI, s),
      cashToken: new ethers.Contract(CONTRACT_ADDRESSES.cashToken, CASH_TOKEN_ABI, s),
      dvpSettlement: new ethers.Contract(CONTRACT_ADDRESSES.dvpSettlement, DVP_SETTLEMENT_ABI, s),
    });
  }, []);

  /** Switch MetaMask to the Besu devnet (or add it) */
  const ensureNetwork = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${NETWORK_CONFIG.chainId.toString(16)}` }],
      });
    } catch (switchError: unknown) {
      const err = switchError as { code?: number };
      if (err.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: `0x${NETWORK_CONFIG.chainId.toString(16)}`,
              chainName: NETWORK_CONFIG.chainName,
              rpcUrls: [NETWORK_CONFIG.rpcUrl],
              nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
            },
          ],
        });
      }
    }
  }, []);

  /** Connect wallet */
  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError('MetaMask not detected. Please install MetaMask.');
      return;
    }
    setIsConnecting(true);
    setError(null);
    try {
      await ensureNetwork();
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[];
      const network = await browserProvider.getNetwork();
      const s = await browserProvider.getSigner();

      setProvider(browserProvider);
      setSigner(s);
      setAccount(accounts[0]);
      setChainId(Number(network.chainId));
      initContracts(s);
    } catch (e: unknown) {
      const err = e as Error;
      setError(err.message || 'Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  }, [ensureNetwork, initContracts]);

  /** Disconnect wallet */
  const disconnect = useCallback(() => {
    setProvider(null);
    setSigner(null);
    setAccount(null);
    setChainId(null);
    setContracts(null);
  }, []);

  /** Listen for MetaMask account / chain changes */
  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = async (...args: unknown[]) => {
      const accounts = args[0] as string[];
      if (accounts.length === 0) {
        disconnect();
      } else {
        // Re-create provider + signer for the new account
        try {
          const browserProvider = new ethers.BrowserProvider(window.ethereum!);
          const s = await browserProvider.getSigner();
          const network = await browserProvider.getNetwork();
          setProvider(browserProvider);
          setSigner(s);
          setAccount(accounts[0]);
          setChainId(Number(network.chainId));
          initContracts(s);
        } catch {
          // Fallback: full reconnect
          connect();
        }
      }
    };

    const handleChainChanged = () => {
      // Chain changed — full reconnect to rebuild everything
      window.location.reload();
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);
    return () => {
      window.ethereum?.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum?.removeListener('chainChanged', handleChainChanged);
    };
  }, [connect, disconnect, initContracts]);

  /** Auto-reconnect on page load if wallet was previously connected */
  useEffect(() => {
    if (!window.ethereum) return;
    window.ethereum
      .request({ method: 'eth_accounts' })
      .then((result: unknown) => {
        const accounts = result as string[];
        if (accounts.length > 0) {
          connect();
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Web3Context.Provider
      value={{ provider, signer, account, chainId, contracts, isConnecting, error, connect, disconnect }}
    >
      {children}
    </Web3Context.Provider>
  );
};

// -----------------------------------------------------------------
// Hook
// -----------------------------------------------------------------
export const useWeb3 = () => useContext(Web3Context);
