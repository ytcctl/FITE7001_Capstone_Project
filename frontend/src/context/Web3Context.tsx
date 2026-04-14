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
  ORACLE_COMMITTEE_ABI,
  TOKEN_FACTORY_V2_ABI,
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
  oracleCommittee: ethers.Contract;
  tokenFactoryV2: ethers.Contract;
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
  { label: 'Operator',         address: '0x627306090abaB3A6e1400e9345bC60c78a8BEf57', key: '0xc87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3' },
  { label: 'Agent / Custodian', address: '0xf17f52151EbEF6C7334FAD080c5704D77216b732', key: '0xae6ae8e5ccbfb04590405997ee2d52d2b330726137b875053c36d94e974d162f' },
  { label: 'Seller',           address: '0xC5fdf4076b8F3A5357c5E395ab970B5B54098Fef', key: '0x0dbbe8e4ae425a6d2687f1a7e3ba17bc98c673636790f1b8ad91193c05875ef1' },
  { label: 'Buyer',            address: '0x821aEa9a577a9b44299B9c15c88cf3087F3b5544', key: '0xc88b703fb08cbea894b6aeff5a544fb92e78a18e19814cd85da83b71f772aa6c' },
] as const;

// -----------------------------------------------------------------
// Saved accounts (localStorage)
// -----------------------------------------------------------------
export interface SavedAccount {
  label: string;
  address: string;
  key: string;
}

const SAVED_ACCOUNTS_KEY = 'tokenhub_saved_accounts';

export function getSavedAccounts(): SavedAccount[] {
  try {
    const raw = localStorage.getItem(SAVED_ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveAccount(account: SavedAccount): void {
  const existing = getSavedAccounts();
  // Deduplicate by address (case-insensitive)
  const filtered = existing.filter(
    (a) => a.address.toLowerCase() !== account.address.toLowerCase(),
  );
  filtered.push(account);
  localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(filtered));
}

export function removeSavedAccount(address: string): void {
  const existing = getSavedAccounts();
  const filtered = existing.filter(
    (a) => a.address.toLowerCase() !== address.toLowerCase(),
  );
  localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(filtered));
}

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
  connectWithKey: (privateKey: string, label?: string) => Promise<void>;
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
  connectWithKey: async (_key: string, _label?: string) => {},
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

      setRoles({ isAdmin, isAgent, isOperator });
    } catch {
      // If role detection fails (e.g. wrong network), default to no roles
      setRoles(DEFAULT_ROLES);
    } finally {
      setRolesLoading(false);
    }
  }, []);

  /** Build ethers contract instances bound to the signer.
   *  Contracts whose addresses are missing/empty use ZeroAddress as a
   *  placeholder so that the rest of the app (especially role detection)
   *  is not blocked. */
  const initContracts = useCallback((s: ethers.JsonRpcSigner | ethers.Wallet) => {
    const addr = (key: string) => (CONTRACT_ADDRESSES as Record<string, string>)[key] || ethers.ZeroAddress;
    const c: Contracts = {
      identityRegistry: new ethers.Contract(addr('identityRegistry'), IDENTITY_REGISTRY_ABI, s),
      compliance: new ethers.Contract(addr('compliance'), COMPLIANCE_ABI, s),
      securityToken: new ethers.Contract(addr('securityToken'), SECURITY_TOKEN_ABI, s),
      cashToken: new ethers.Contract(addr('cashToken'), CASH_TOKEN_ABI, s),
      dvpSettlement: new ethers.Contract(addr('dvpSettlement'), DVP_SETTLEMENT_ABI, s),
      tokenFactory: new ethers.Contract(addr('tokenFactory'), TOKEN_FACTORY_ABI, s),
      claimIssuer: new ethers.Contract(addr('claimIssuer'), CLAIM_ISSUER_ABI, s),
      identityFactory: new ethers.Contract(addr('identityFactory'), IDENTITY_FACTORY_ABI, s),
      governor: new ethers.Contract(addr('governor'), GOVERNOR_ABI, s),
      timelock: new ethers.Contract(addr('timelock'), TIMELOCK_ABI, s),
      walletRegistry: new ethers.Contract(addr('walletRegistry'), WALLET_REGISTRY_ABI, s),
      multiSigWarm: new ethers.Contract(addr('multiSigWarm'), MULTI_SIG_WARM_ABI, s),
      systemHealthCheck: new ethers.Contract(addr('systemHealthCheck'), SYSTEM_HEALTH_CHECK_ABI, s),
      orderBook: new ethers.Contract(addr('orderBook'), ORDER_BOOK_ABI, s),
      orderBookFactory: new ethers.Contract(addr('orderBookFactory'), ORDER_BOOK_FACTORY_ABI, s),
      oracleCommittee: new ethers.Contract(addr('oracleCommittee'), ORACLE_COMMITTEE_ABI, s),
      tokenFactoryV2: new ethers.Contract(addr('tokenFactoryV2'), TOKEN_FACTORY_V2_ABI, s),
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
   *  Uses wallet_requestPermissions to ALWAYS show the MetaMask account picker,
   *  even if the site has been previously authorized. */
  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError('MetaMask not detected. Please install MetaMask.');
      return;
    }
    setIsConnecting(true);
    setError(null);
    try {
      // Force MetaMask to show the account-selection popup every time
      await window.ethereum.request({
        method: 'wallet_requestPermissions',
        params: [{ eth_accounts: {} }],
      });

      // Now read the selected account(s)
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const accounts = (await window.ethereum.request({
        method: 'eth_accounts',
      })) as string[];

      if (accounts.length === 0) {
        setError('No account selected');
        return;
      }

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
  const connectWithKey = useCallback(async (privateKey: string, label?: string) => {
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

      // Save to localStorage if a label is provided and not a built-in test account
      if (label) {
        const isBuiltIn = TEST_ACCOUNTS.some((ta) => ta.address.toLowerCase() === addr.toLowerCase());
        if (!isBuiltIn) {
          saveAccount({ label, address: addr, key: privateKey });
        }
      }

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
