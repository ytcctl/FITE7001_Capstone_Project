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
  TOKEN_FACTORY_ABI,
  CLAIM_ISSUER_ABI,
  IDENTITY_FACTORY_ABI,
  GOVERNOR_ABI,
  TIMELOCK_ABI,
  WALLET_REGISTRY_ABI,
  MULTI_SIG_WARM_ABI,
  SYSTEM_HEALTH_CHECK_ABI,
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
  tokenFactory: ethers.Contract;
  claimIssuer: ethers.Contract;
  identityFactory: ethers.Contract;
  governor: ethers.Contract;
  timelock: ethers.Contract;
  walletRegistry: ethers.Contract;
  multiSigWarm: ethers.Contract;
  systemHealthCheck: ethers.Contract;
}

export interface UserRoles {
  isAdmin: boolean;
  isAgent: boolean;
  isOperator: boolean;
}

interface Web3State {
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
  account: string | null;
  chainId: number | null;
  contracts: Contracts | null;
  roles: UserRoles;
  rolesLoading: boolean;
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const DEFAULT_ROLES: UserRoles = { isAdmin: false, isAgent: false, isOperator: false };

const Web3Context = createContext<Web3State>({
  provider: null,
  signer: null,
  account: null,
  chainId: null,
  contracts: null,
  roles: DEFAULT_ROLES,
  rolesLoading: false,
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
  const [roles, setRoles] = useState<UserRoles>(DEFAULT_ROLES);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Detect on-chain roles for the given account */
  const detectRoles = useCallback(async (addr: string, c: Contracts) => {
    setRolesLoading(true);
    try {
      // Fetch role constants
      const [adminRole, agentRole, operatorRole] = await Promise.all([
        c.identityRegistry.DEFAULT_ADMIN_ROLE() as Promise<string>,
        c.identityRegistry.AGENT_ROLE() as Promise<string>,
        c.dvpSettlement.OPERATOR_ROLE() as Promise<string>,
      ]);

      // Check roles on IdentityRegistry (admin/agent) and DvP (operator)
      const [isAdmin, isAgent, isOperator] = await Promise.all([
        c.identityRegistry.hasRole(adminRole, addr) as Promise<boolean>,
        c.identityRegistry.hasRole(agentRole, addr) as Promise<boolean>,
        c.dvpSettlement.hasRole(operatorRole, addr) as Promise<boolean>,
      ]);

      setRoles({ isAdmin, isAgent, isOperator });
    } catch {
      // If role detection fails (e.g. wrong network), default to no roles
      setRoles(DEFAULT_ROLES);
    } finally {
      setRolesLoading(false);
    }
  }, []);

  /** Build ethers contract instances bound to the signer */
  const initContracts = useCallback((s: ethers.JsonRpcSigner) => {
    const c: Contracts = {
      identityRegistry: new ethers.Contract(CONTRACT_ADDRESSES.identityRegistry, IDENTITY_REGISTRY_ABI, s),
      compliance: new ethers.Contract(CONTRACT_ADDRESSES.compliance, COMPLIANCE_ABI, s),
      securityToken: new ethers.Contract(CONTRACT_ADDRESSES.securityToken, SECURITY_TOKEN_ABI, s),
      cashToken: new ethers.Contract(CONTRACT_ADDRESSES.cashToken, CASH_TOKEN_ABI, s),
      dvpSettlement: new ethers.Contract(CONTRACT_ADDRESSES.dvpSettlement, DVP_SETTLEMENT_ABI, s),
      tokenFactory: new ethers.Contract(CONTRACT_ADDRESSES.tokenFactory, TOKEN_FACTORY_ABI, s),
      claimIssuer: new ethers.Contract(CONTRACT_ADDRESSES.claimIssuer, CLAIM_ISSUER_ABI, s),
      identityFactory: new ethers.Contract(CONTRACT_ADDRESSES.identityFactory, IDENTITY_FACTORY_ABI, s),
      governor: new ethers.Contract(CONTRACT_ADDRESSES.governor, GOVERNOR_ABI, s),
      timelock: new ethers.Contract(CONTRACT_ADDRESSES.timelock, TIMELOCK_ABI, s),
      walletRegistry: new ethers.Contract(CONTRACT_ADDRESSES.walletRegistry, WALLET_REGISTRY_ABI, s),
      multiSigWarm: new ethers.Contract(CONTRACT_ADDRESSES.multiSigWarm, MULTI_SIG_WARM_ABI, s),
      systemHealthCheck: new ethers.Contract(CONTRACT_ADDRESSES.systemHealthCheck, SYSTEM_HEALTH_CHECK_ABI, s),
    };
    setContracts(c);
    return c;
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
      const c = initContracts(s);
      detectRoles(accounts[0], c);
    } catch (e: unknown) {
      const err = e as Error;
      setError(err.message || 'Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  }, [ensureNetwork, initContracts, detectRoles]);

  /** Disconnect wallet */
  const disconnect = useCallback(() => {
    setProvider(null);
    setSigner(null);
    setAccount(null);
    setChainId(null);
    setContracts(null);
    setRoles(DEFAULT_ROLES);
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
          const c = initContracts(s);
          detectRoles(accounts[0], c);
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
  }, [connect, disconnect, initContracts, detectRoles]);

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
      value={{ provider, signer, account, chainId, contracts, roles, rolesLoading, isConnecting, error, connect, disconnect }}
    >
      {children}
    </Web3Context.Provider>
  );
};

// -----------------------------------------------------------------
// Hook
// -----------------------------------------------------------------
export const useWeb3 = () => useContext(Web3Context);
