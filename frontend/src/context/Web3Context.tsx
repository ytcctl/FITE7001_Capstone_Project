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
  ORDER_BOOK_ABI,
  ORDER_BOOK_FACTORY_ABI,
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
  orderBook: ethers.Contract;
  orderBookFactory: ethers.Contract;
}

export interface UserRoles {
  isAdmin: boolean;
  isAgent: boolean;
  isOperator: boolean;
}

/** Connection mode: MetaMask (browser extension) or built-in (private key via RPC) */
export type WalletMode = 'metamask' | 'builtin';

/** Pre-configured test accounts for the Besu devnet */
export const TEST_ACCOUNTS = [
  { label: 'Admin / Deployer', address: '0xFE3B557E8Fb62b89F4916B721be55cEb828dBd73', key: '0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63' },
  { label: 'Operator',         address: '0x627306090abaB3A6e1400e9345bC60c78a8BEf57', key: '0xae6ae8e5ccbfb04590405997ee2d52d2b330726137b875053c36d94e974d162f' },
  { label: 'Agent / Custodian', address: '0xf17f52151EbEF6C7334FAD080c5704D77216b732', key: '0xc88b703fb08cbea894b6aeff5a544fb92e78a18e19814cd85da83b71f772aa6c' },
  { label: 'Seller',           address: '0xC5fdf4076b8F3A5357c5E395ab970B5B54098Fef', key: '0x388c684f0ba1ef5017716adb5d21a053ea8e90277d0868337519f97bede61418' },
  { label: 'Buyer',            address: '0x821aEa9a577a9b44299B9c15c88cf3087F3b5544', key: '0x659cbb0e2411a44db63778987b1e22153c086a95eb6b18bdf89de078917abc63' },
  { label: 'Investor1',        address: '0x5e33E2E5333DD9b7b428AC38AE361E9b707046f3', key: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a' },
] as const;

interface Web3State {
  provider: ethers.BrowserProvider | ethers.JsonRpcProvider | null;
  signer: ethers.JsonRpcSigner | ethers.Wallet | null;
  account: string | null;
  chainId: number | null;
  contracts: Contracts | null;
  roles: UserRoles;
  rolesLoading: boolean;
  isConnecting: boolean;
  error: string | null;
  wrongNetwork: boolean;
  walletMode: WalletMode | null;
  switchNetwork: () => Promise<void>;
  connect: () => Promise<void>;
  connectWithKey: (privateKey: string) => Promise<void>;
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
  wrongNetwork: false,
  walletMode: null,
  switchNetwork: async () => {},
  connect: async () => {},
  connectWithKey: async () => {},
  disconnect: () => {},
});

// -----------------------------------------------------------------
// Provider
// -----------------------------------------------------------------
export const Web3Provider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [provider, setProvider] = useState<ethers.BrowserProvider | ethers.JsonRpcProvider | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | ethers.Wallet | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [contracts, setContracts] = useState<Contracts | null>(null);
  const [roles, setRoles] = useState<UserRoles>(DEFAULT_ROLES);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrongNetwork, setWrongNetwork] = useState(false);
  const [walletMode, setWalletMode] = useState<WalletMode | null>(null);

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

      console.log('[Web3] Roles detected for', addr, { isAdmin, isAgent, isOperator });
      setRoles({ isAdmin, isAgent, isOperator });
    } catch (err) {
      console.error('[Web3] Role detection failed:', err);
      // If role detection fails (e.g. wrong network), default to no roles
      setRoles(DEFAULT_ROLES);
    } finally {
      setRolesLoading(false);
    }
  }, []);

  /** Build ethers contract instances bound to the signer */
  const initContracts = useCallback((s: ethers.JsonRpcSigner | ethers.Wallet) => {
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
      orderBook: new ethers.Contract(CONTRACT_ADDRESSES.orderBook, ORDER_BOOK_ABI, s),
      orderBookFactory: new ethers.Contract(CONTRACT_ADDRESSES.orderBookFactory, ORDER_BOOK_FACTORY_ABI, s),
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

  /** Public: prompt user to switch network, then reconnect */
  const switchNetwork = useCallback(async () => {
    await ensureNetwork();
    // handleChainChanged will fire and call reconnect() automatically
  }, [ensureNetwork]);

  /**
   * Internal reconnect — reads current wallet state WITHOUT prompting a
   * network switch.  Used on page-load auto-reconnect and chainChanged events
   * so the wrong-network banner stays visible until the user explicitly clicks
   * "Switch Network".
   *
   * @param newAccount  Optional account address from the accountsChanged event.
   *                    When provided, forces the provider to use this address
   *                    instead of whatever getSigner() returns (avoids stale cache).
   */
  const reconnect = useCallback(async (newAccount?: string) => {
    if (!window.ethereum) return;
    try {
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const accounts = newAccount
        ? [newAccount]
        : ((await window.ethereum.request({ method: 'eth_accounts' })) as string[]);
      if (accounts.length === 0) return;

      const network = await browserProvider.getNetwork();
      const currentChainId = Number(network.chainId);

      setAccount(accounts[0]);
      setChainId(currentChainId);
      setError(null);

      if (currentChainId !== NETWORK_CONFIG.chainId) {
        setWrongNetwork(true);
        setContracts(null);
        setRoles(DEFAULT_ROLES);
        setProvider(browserProvider);
        setSigner(null);
        return;
      }

      // Get the signer for the specific account address
      const s = await browserProvider.getSigner(accounts[0]);

      setProvider(browserProvider);
      setSigner(s);
      setWrongNetwork(false);
      const c = initContracts(s);
      detectRoles(accounts[0], c);
    } catch {
      // Ignore — wallet may not be ready
    }
  }, [initContracts, detectRoles]);

  /** Connect wallet — interactive, called by the "Connect Wallet" button.
   *  This is the ONLY path that calls ensureNetwork(). */
  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError('MetaMask not detected. Please install MetaMask.');
      return;
    }
    setIsConnecting(true);
    setError(null);
    try {
      // Prompt wallet connection first (so MetaMask unlocks)
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[];
      const network = await browserProvider.getNetwork();
      const currentChainId = Number(network.chainId);

      // If wrong chain, try to switch (user may reject)
      if (currentChainId !== NETWORK_CONFIG.chainId) {
        try {
          await ensureNetwork();
          // handleChainChanged will fire → reconnect() will run
        } catch {
          // User rejected — just show the banner
          setAccount(accounts[0]);
          setChainId(currentChainId);
          setWrongNetwork(true);
          setContracts(null);
          setRoles(DEFAULT_ROLES);
        }
        return;
      }

      // Correct chain — finish connecting
      const s = await browserProvider.getSigner();
      setProvider(browserProvider);
      setSigner(s);
      setAccount(accounts[0]);
      setChainId(currentChainId);
      setWrongNetwork(false);
      setWalletMode('metamask');
      const c = initContracts(s);
      detectRoles(accounts[0], c);
    } catch (e: unknown) {
      const err = e as Error;
      setError(err.message || 'Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  }, [ensureNetwork, initContracts, detectRoles]);

  /** Connect using a private key directly via JSON-RPC (no browser extension needed) */
  const connectWithKey = useCallback(async (privateKey: string) => {
    setIsConnecting(true);
    setError(null);
    try {
      console.log('[Web3] Connecting via built-in wallet, RPC:', NETWORK_CONFIG.rpcUrl);
      const rpcProvider = new ethers.JsonRpcProvider(NETWORK_CONFIG.rpcUrl);
      const network = await rpcProvider.getNetwork();
      const currentChainId = Number(network.chainId);
      console.log('[Web3] Connected to chain', currentChainId);

      const wallet = new ethers.Wallet(privateKey, rpcProvider);
      const addr = wallet.address;

      setProvider(rpcProvider);
      setSigner(wallet);
      setAccount(addr);
      setChainId(currentChainId);
      setWalletMode('builtin');
      setWrongNetwork(currentChainId !== NETWORK_CONFIG.chainId);

      if (currentChainId === NETWORK_CONFIG.chainId) {
        const c = initContracts(wallet);
        detectRoles(addr, c);
      }
    } catch (e: unknown) {
      const err = e as Error;
      setError(err.message || 'Failed to connect with private key');
    } finally {
      setIsConnecting(false);
    }
  }, [initContracts, detectRoles]);

  /** Disconnect wallet */
  const disconnect = useCallback(() => {
    setProvider(null);
    setSigner(null);
    setAccount(null);
    setChainId(null);
    setContracts(null);
    setRoles(DEFAULT_ROLES);
    setWalletMode(null);
  }, []);

  /** Listen for MetaMask account / chain changes */
  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = async (...args: unknown[]) => {
      const accounts = args[0] as string[];
      if (accounts.length === 0) {
        disconnect();
      } else {
        // Pass the new account directly to avoid stale provider cache
        reconnect(accounts[0]);
      }
    };

    const handleChainChanged = (_newChainIdHex: unknown) => {
      // Silent reconnect — reads the new chain and sets wrongNetwork accordingly
      reconnect();
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);
    return () => {
      window.ethereum?.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum?.removeListener('chainChanged', handleChainChanged);
    };
  }, [reconnect, disconnect]);

  /** Passive chain check on mount — detect wrong network even when wallet is
   *  not connected (eth_accounts may return []).  reconnect() handles the
   *  connected case; this covers the disconnected case. */
  useEffect(() => {
    if (!window.ethereum) return;
    (async () => {
      try {
        const hexChainId = (await window.ethereum!.request({
          method: 'eth_chainId',
        })) as string;
        const cid = parseInt(hexChainId, 16);
        setChainId(cid);
        if (cid !== NETWORK_CONFIG.chainId) {
          setWrongNetwork(true);
        }
      } catch {
        // MetaMask not ready — ignore
      }
    })();
  }, []);

  /** Auto-reconnect on page load if wallet was previously connected.
   *  Uses reconnect() (silent) — never prompts a network switch popup. */
  useEffect(() => {
    if (!window.ethereum) return;
    reconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Web3Context.Provider
      value={{ provider, signer, account, chainId, contracts, roles, rolesLoading, isConnecting, error, wrongNetwork, walletMode, switchNetwork, connect, connectWithKey, disconnect }}
    >
      {children}
    </Web3Context.Provider>
  );
};

// -----------------------------------------------------------------
// Hook
// -----------------------------------------------------------------
export const useWeb3 = () => useContext(Web3Context);
