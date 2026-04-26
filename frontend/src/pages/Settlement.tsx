import React, { useState, useEffect, useCallback } from 'react';
import { useWeb3 } from '../context/Web3Context';
import { CONTRACT_ADDRESSES, SECURITY_TOKEN_ABI, CASH_TOKEN_ABI } from '../config/contracts';
import { createNonceManager } from '../utils/nonce';
import { ArrowRightLeft, Plus, Play, XCircle, RefreshCw, Loader2, CheckSquare } from 'lucide-react';
import { ethers } from 'ethers';

interface TokenOption {
  name: string;
  symbol: string;
  address: string;
}

interface SettlementData {
  id: number;
  seller: string;
  buyer: string;
  securityToken: string;
  securitySymbol: string;
  cashToken: string;
  cashSymbol: string;
  tokenAmount: string;
  cashAmount: string;
  status: number;
  matchId: string;
  deadline: number;
  createdBy: string;
}

const STATUS_LABELS = ['Pending', 'Settled', 'Failed', 'Cancelled'];
const STATUS_COLORS = [
  'bg-amber-500/20 text-amber-400 border-amber-500/30',
  'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  'bg-red-500/20 text-red-400 border-red-500/30',
  'bg-gray-500/20 text-gray-400 border-gray-500/30',
];
const EXPIRED_COLOR = 'bg-orange-500/20 text-orange-400 border-orange-500/30';

/** Returns true if a pending settlement's deadline has passed (uses chain time) */
const isExpired = (s: SettlementData, chainTime: number) => s.status === 0 && s.deadline > 0 && chainTime > s.deadline;

const Settlement: React.FC = () => {
  const { account, contracts } = useWeb3();

  // Token selector
  const [tokenOptions, setTokenOptions] = useState<TokenOption[]>([]);
  const [selectedSecurityToken, setSelectedSecurityToken] = useState('');

  // Create
  const [seller, setSeller] = useState('');
  const [buyer, setBuyer] = useState('');
  const [tokenAmount, setTokenAmount] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [deadlineHours, setDeadlineHours] = useState('24');
  // Execute / Cancel
  const [executeId, setExecuteId] = useState('');
  // List
  const [settlements, setSettlements] = useState<SettlementData[]>([]);
  const [txStatus, setTxStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Batch execute
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // Chain clock (may differ from wall clock due to time-warps)
  const [chainTime, setChainTime] = useState(Math.floor(Date.now() / 1000));

  // Load available security tokens from factory contracts
  const loadTokenOptions = useCallback(async () => {
    if (!contracts) return;
    const options: TokenOption[] = [];
    // Default security token
    try {
      const [name, symbol] = await Promise.all([
        contracts.securityToken.name(),
        contracts.securityToken.symbol(),
      ]);
      const addr = await contracts.securityToken.getAddress();
      options.push({ name, symbol, address: addr });
    } catch {}
    // V1 factory tokens
    try {
      const all = await contracts.tokenFactory.allTokens();
      for (const t of all) {
        if (!t.active) continue;
        if (options.find(o => o.address.toLowerCase() === t.tokenAddress.toLowerCase())) continue;
        options.push({ name: t.name, symbol: t.symbol, address: t.tokenAddress });
      }
    } catch {}
    // V2 factory tokens
    try {
      const allV2 = await contracts.tokenFactoryV2.allTokens();
      for (const t of allV2) {
        if (!t.active) continue;
        if (options.find(o => o.address.toLowerCase() === t.proxyAddress.toLowerCase())) continue;
        options.push({ name: t.name, symbol: t.symbol, address: t.proxyAddress });
      }
    } catch {}
    setTokenOptions(options);
    if (options.length > 0 && !selectedSecurityToken) {
      setSelectedSecurityToken(options[0].address);
    }
  }, [contracts, selectedSecurityToken]);

  // Cache resolved ERC-20 symbols so we don't re-query the same token contract
  const symbolCache = React.useRef<Record<string, string>>({});

  const resolveSymbol = async (tokenAddr: string, provider: ethers.Provider): Promise<string> => {
    const key = tokenAddr.toLowerCase();
    if (symbolCache.current[key]) return symbolCache.current[key];
    try {
      const c = new ethers.Contract(tokenAddr, ['function symbol() view returns (string)'], provider);
      const sym = await c.symbol();
      symbolCache.current[key] = sym;
      return sym;
    } catch {
      const short = `${tokenAddr.slice(0, 6)}…${tokenAddr.slice(-4)}`;
      symbolCache.current[key] = short;
      return short;
    }
  };

  const loadSettlements = async () => {
    if (!contracts) return;
    try {
      const count = await contracts.dvpSettlement.settlementCount();
      const provider = (contracts.dvpSettlement.runner as ethers.Signer).provider!;
      // Fetch chain timestamp (may be ahead of wall clock due to governance time-warps)
      const latestBlock = await provider.getBlock('latest');
      if (latestBlock) setChainTime(latestBlock.timestamp);
      const items: SettlementData[] = [];
      for (let i = 0; i < Number(count); i++) {
        const s = await contracts.dvpSettlement.settlements(i);
        const [securitySymbol, cashSymbol] = await Promise.all([
          resolveSymbol(s.securityToken, provider),
          resolveSymbol(s.cashToken, provider),
        ]);
        items.push({
          id: i,
          seller: s.seller,
          buyer: s.buyer,
          securityToken: s.securityToken,
          securitySymbol,
          cashToken: s.cashToken,
          cashSymbol,
          tokenAmount: ethers.formatUnits(s.tokenAmount, 18),
          cashAmount: ethers.formatUnits(s.cashAmount, 6),
          status: Number(s.status),
          matchId: s.matchId,
          deadline: Number(s.settlementDeadline),
          createdBy: s.createdBy,
        });
      }
      setSettlements(items);
    } catch (e) {
      console.error('Load settlements error:', e);
    }
  };

  useEffect(() => {
    loadSettlements();
    loadTokenOptions();
  }, [contracts]);

  // Reset the create-settlement form whenever the connected account changes
  // (including disconnect → reconnect with a different wallet). Counterparty
  // addresses, amounts, and execute-id from the previous session are not
  // meaningful for a different user and risk accidental submission.
  useEffect(() => {
    setSeller('');
    setBuyer('');
    setTokenAmount('');
    setCashAmount('');
    setDeadlineHours('24');
    setExecuteId('');
    setSelectedIds(new Set());
    setTxStatus('');
  }, [account]);

  /** Parse settlement errors into human-readable messages */
  const parseSettlementError = (e: any): string => {
    const raw = e?.reason || e?.message || '';
    // ENS not supported on local chain
    if (raw.includes('does not support ENS') || (e?.code === 'UNSUPPORTED_OPERATION' && raw.includes('getEnsAddress'))) {
      return 'Invalid address format. Please enter a valid Ethereum address (0x…).';
    }
    if (raw.includes('invalid address') || raw.includes('INVALID_ARGUMENT')) {
      return 'Invalid address format. Please enter a valid Ethereum address (0x…).';
    }
    if (raw.includes('creator cannot execute') || raw.includes('createdBy')) {
      return 'Only the counterparty can execute this DvP settlement.';
    }
    // Nonce out of sync — typically after an Anvil state load reset the chain
    // but the wallet's local nonce tracker is stale.
    if (raw.includes('nonce has already been used') || raw.includes('nonce too low') || raw.includes('NONCE_EXPIRED')) {
      return 'Wallet nonce is out of sync with the chain (often happens after loading an Anvil snapshot). MetaMask: Settings → Advanced → "Clear activity tab data" for this account, then retry. Built-in wallet: disconnect and reconnect.';
    }
    // Custom error selectors
    const data = typeof e?.data === 'string' ? e.data
      : typeof e?.error?.data === 'string' ? e.error.data : null;
    if (data && data.startsWith('0x')) {
      const selector = data.slice(0, 10).toLowerCase();
      const knownErrors: Record<string, string> = {
        '0xe450d38c': 'Insufficient token balance',
        '0xfb8f41b2': 'Insufficient allowance — please approve tokens first',
        '0x1a83e5fc': 'Token transfer failed — sender or recipient may be frozen or not KYC-verified',
      };
      if (knownErrors[selector]) return knownErrors[selector];
      // OpenZeppelin AccessControlUnauthorizedAccount(address account, bytes32 neededRole)
      if (selector === '0xe2517d3f' && data.length >= 138) {
        try {
          const [account, neededRole] = ethers.AbiCoder.defaultAbiCoder().decode(
            ['address', 'bytes32'],
            '0x' + data.slice(10)
          );
          const ROLE_NAMES: Record<string, string> = {
            [ethers.id('OPERATOR_ROLE')]: 'OPERATOR_ROLE',
            [ethers.id('AGENT_ROLE')]: 'AGENT_ROLE',
            [ethers.id('TIMELOCK_MINTER_ROLE')]: 'TIMELOCK_MINTER_ROLE',
            [ethers.id('COMPLIANCE_OFFICER_ROLE')]: 'COMPLIANCE_OFFICER_ROLE',
            [ethers.id('MLRO_ROLE')]: 'MLRO_ROLE',
            [ethers.id('UPGRADER_ROLE')]: 'UPGRADER_ROLE',
            [ethers.id('ORACLE_ROLE')]: 'ORACLE_ROLE',
            [ethers.id('PAUSER_ROLE')]: 'PAUSER_ROLE',
            '0x0000000000000000000000000000000000000000000000000000000000000000': 'DEFAULT_ADMIN_ROLE',
          };
          const roleName = ROLE_NAMES[neededRole.toLowerCase()] || `role ${neededRole.slice(0, 10)}…`;
          const acctShort = `${account.slice(0, 6)}…${account.slice(-4)}`;
          if (roleName === 'OPERATOR_ROLE') {
            return `Wallet ${acctShort} is missing OPERATOR_ROLE on the DvP Settlement contract. Only the matching-engine / Operator account can create or execute DvP settlements. Connect the Operator test account (or have an admin grant OPERATOR_ROLE to this wallet).`;
          }
          return `Wallet ${acctShort} is missing the required role ${roleName} on this contract. Connect an account that holds this role (or have an admin grant it).`;
        } catch { /* fall through */ }
      }
      if (selector === '0x08c379a0' && data.length >= 74) {
        try {
          const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + data.slice(10));
          return decoded[0];
        } catch { /* fall through */ }
      }
    }
    // String revert reason from message
    const match = raw.match(/reverted with reason string '([^']+)'/);
    if (match) return match[1];
    if (raw.length > 200) return raw.slice(0, 200) + '…';
    return raw || 'Transaction failed';
  };

  const handleCreate = async () => {
    if (!contracts || !seller || !buyer || !tokenAmount || !cashAmount || !selectedSecurityToken) return;

    // Validate addresses
    if (!ethers.isAddress(seller)) {
      setTxStatus('✗ Invalid seller address. Please enter a valid Ethereum address (0x…).');
      return;
    }
    if (!ethers.isAddress(buyer)) {
      setTxStatus('✗ Invalid buyer address. Please enter a valid Ethereum address (0x…).');
      return;
    }

    // Only seller or buyer can place a DvP settlement instruction
    const meAddr = account?.toLowerCase() ?? '';
    if (meAddr !== seller.toLowerCase() && meAddr !== buyer.toLowerCase()) {
      setTxStatus('✗ Only the seller or buyer can place a DvP settlement instruction.');
      return;
    }

    setIsSubmitting(true);
    setTxStatus('Creating settlement…');
    try {
      // Frozen pre-check on the selected security token
      const signer = (contracts.dvpSettlement as any).runner as ethers.Signer;
      const secToken = new ethers.Contract(selectedSecurityToken, SECURITY_TOKEN_ABI, signer);
      try {
        const [sellerFrozen, buyerFrozen] = await Promise.all([
          secToken.frozen(seller),
          secToken.frozen(buyer),
        ]);
        if (sellerFrozen) {
          setTxStatus('✗ Seller address is frozen by the compliance administrator. Settlement cannot be created.');
          setIsSubmitting(false);
          return;
        }
        if (buyerFrozen) {
          setTxStatus('✗ Buyer address is frozen by the compliance administrator. Settlement cannot be created.');
          setIsSubmitting(false);
          return;
        }
      } catch {
        // frozen() not available — skip pre-check
      }

      const me = (await signer.getAddress()).toLowerCase();
      const dvpAddr = await contracts.dvpSettlement.getAddress();
      const tokenAmountBN = ethers.parseUnits(tokenAmount, 18);
      const cashAmountBN = ethers.parseUnits(cashAmount, 6);

      // Local nonce management spans approve(s) + createSettlement so the
      // wallet/provider per-block cache can't cause a stale nonce on the next tx.
      const provider = (contracts.dvpSettlement as any).runner?.provider ?? contracts.dvpSettlement.runner;
      const nm = await createNonceManager(signer);

      // Pre-approve tokens so executeSettlement can transferFrom later.
      // The seller must approve security tokens; the buyer must approve cash tokens.
      // Only the connected wallet can approve its own tokens.
      if (me === seller.toLowerCase()) {
        setTxStatus('Approving security token for DvP…');
        const secTokenSigner = new ethers.Contract(selectedSecurityToken, SECURITY_TOKEN_ABI, signer);
        const allowance: bigint = await secTokenSigner.allowance(me, dvpAddr);
        if (allowance < tokenAmountBN) {
          const appTx = await secTokenSigner.approve(dvpAddr, tokenAmountBN, nm.next());
          await appTx.wait();
        }
      }
      if (me === buyer.toLowerCase()) {
        setTxStatus('Approving cash token for DvP…');
        const cashToken = new ethers.Contract(CONTRACT_ADDRESSES.cashToken, CASH_TOKEN_ABI, signer);
        const allowance: bigint = await cashToken.allowance(me, dvpAddr);
        if (allowance < cashAmountBN) {
          const appTx = await cashToken.approve(dvpAddr, cashAmountBN, nm.next());
          await appTx.wait();
        }
      }

      setTxStatus('Creating settlement…');
      // Use chain block.timestamp (may be far ahead of wall-clock due to governance time-warps)
      const latestBlock = await provider.getBlock('latest');
      const chainNow = latestBlock!.timestamp;
      const deadline = chainNow + Number(deadlineHours) * 3600;
      const matchId = ethers.keccak256(ethers.toUtf8Bytes(`match-${Date.now()}`));
      const tx = await contracts.dvpSettlement.createSettlement(
        seller,
        buyer,
        selectedSecurityToken,
        tokenAmountBN,
        CONTRACT_ADDRESSES.cashToken,
        cashAmountBN,
        deadline,
        matchId,
        nm.next()
      );
      await tx.wait();
      setTxStatus('✓ Settlement created successfully');
      setTokenAmount('');
      setCashAmount('');
      loadSettlements();
    } catch (e: any) {
      setTxStatus(`✗ ${parseSettlementError(e)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExecute = async (id: number) => {
    if (!contracts) return;
    setIsSubmitting(true);
    setTxStatus(`Executing settlement #${id}…`);
    try {
      // Fetch settlement details to check required approvals
      const s = await contracts.dvpSettlement.settlements(id);
      const dvpAddr = await contracts.dvpSettlement.getAddress();
      const signer = (contracts.dvpSettlement as any).runner as ethers.Signer;
      const me = await signer.getAddress();
      const meLower = me.toLowerCase();

      // ── Pre-check: both parties must have sufficient allowances ──
      // Seller must have approved security tokens to DvP
      const secToken = new ethers.Contract(s.securityToken, SECURITY_TOKEN_ABI, signer);
      const sellerAllowance: bigint = await secToken.allowance(s.seller, dvpAddr);
      if (sellerAllowance < s.tokenAmount) {
        if (meLower === s.seller.toLowerCase()) {
          // We are the seller — approve now
          setTxStatus(`Approving security token for settlement #${id}…`);
          const appTx = await secToken.approve(dvpAddr, s.tokenAmount);
          await appTx.wait();
        } else {
          // We are not the seller — cannot approve on their behalf
          const sellerShort = `${s.seller.slice(0, 6)}…${s.seller.slice(-4)}`;
          setTxStatus(`✗ Seller (${sellerShort}) has not approved security tokens to the DvP contract. The seller must connect their wallet and approve before this settlement can be executed.`);
          setIsSubmitting(false);
          return;
        }
      }

      // Buyer must have approved cash tokens to DvP
      const cashTokenContract = new ethers.Contract(s.cashToken, CASH_TOKEN_ABI, signer);
      const buyerAllowance: bigint = await cashTokenContract.allowance(s.buyer, dvpAddr);
      if (buyerAllowance < s.cashAmount) {
        if (meLower === s.buyer.toLowerCase()) {
          // We are the buyer — approve now
          setTxStatus(`Approving cash token for settlement #${id}…`);
          const appTx = await cashTokenContract.approve(dvpAddr, s.cashAmount);
          await appTx.wait();
        } else {
          // We are not the buyer — cannot approve on their behalf
          const buyerShort = `${s.buyer.slice(0, 6)}…${s.buyer.slice(-4)}`;
          setTxStatus(`✗ Buyer (${buyerShort}) has not approved cash tokens to the DvP contract. The buyer must connect their wallet and approve before this settlement can be executed.`);
          setIsSubmitting(false);
          return;
        }
      }

      setTxStatus(`Executing settlement #${id}…`);
      const tx = await contracts.dvpSettlement.executeSettlement(id);
      const receipt = await tx.wait();

      // Pre-flight failures mark the settlement as Failed without reverting.
      // Check the tx receipt for a SettlementFailed event.
      const failedEvent = receipt.logs
        .map((log: any) => { try { return contracts.dvpSettlement.interface.parseLog(log); } catch { return null; } })
        .find((parsed: any) => parsed?.name === 'SettlementFailed');

      if (failedEvent) {
        const reason = failedEvent.args?.reason || 'Pre-flight check failed';
        setTxStatus(`✗ Settlement #${id} failed: ${reason}`);
      } else {
        setTxStatus(`✓ Settlement #${id} executed — DvP atomic swap complete`);
      }
      loadSettlements();
    } catch (e: any) {
      setTxStatus(`✗ ${parseSettlementError(e)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async (id: number) => {
    if (!contracts) return;
    setIsSubmitting(true);
    setTxStatus(`Cancelling settlement #${id}…`);
    try {
      const tx = await contracts.dvpSettlement.cancelSettlement(id);
      await tx.wait();
      setTxStatus(`✓ Settlement #${id} cancelled`);
      loadSettlements();
    } catch (e: any) {
      setTxStatus(`✗ ${parseSettlementError(e)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMarkFailed = async (id: number) => {
    if (!contracts) return;
    setIsSubmitting(true);
    setTxStatus(`Marking settlement #${id} as failed (deadline passed)…`);
    try {
      const tx = await contracts.dvpSettlement.markFailed(id);
      await tx.wait();
      setTxStatus(`✓ Settlement #${id} marked as Failed (deadline expired)`);
      loadSettlements();
    } catch (e: any) {
      setTxStatus(`✗ ${parseSettlementError(e)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Only seller and buyer can view their own settlements in history
  const visibleSettlements = settlements.filter((s) => {
    if (!account) return false;
    const me = account.toLowerCase();
    return s.seller.toLowerCase() === me || s.buyer.toLowerCase() === me;
  });

  const pendingIds = visibleSettlements.filter((s) => s.status === 0 && !isExpired(s, chainTime)).map((s) => s.id);

  const toggleSelectAll = () => {
    if (pendingIds.every((id) => selectedIds.has(id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingIds));
    }
  };

  const handleBatchExecute = async () => {
    if (!contracts || selectedIds.size === 0) return;
    setIsSubmitting(true);
    const ids = Array.from(selectedIds);
    setTxStatus(`Batch executing ${ids.length} settlement(s)… checking approvals…`);
    try {
      const dvpAddr = await contracts.dvpSettlement.getAddress();
      const signer = (contracts.dvpSettlement as any).runner as ethers.Signer;
      const me = (await signer.getAddress()).toLowerCase();
      const meChecksum = await signer.getAddress();

      // Aggregate total amounts needed per token across all selected settlements
      // Track both our own needs AND counterparty needs for pre-check
      const secNeeded: Record<string, bigint> = {};   // securityToken address → total (our side)
      const cashNeeded: Record<string, bigint> = {};   // cashToken address → total (our side)
      // Counterparty allowance tracking: { tokenAddr → { party → totalNeeded } }
      const sellerSecNeeded: Record<string, Record<string, bigint>> = {};
      const buyerCashNeeded: Record<string, Record<string, bigint>> = {};

      for (const id of ids) {
        const s = await contracts.dvpSettlement.settlements(id);
        // Creator cannot execute their own settlement — must be counterparty
        if (me === s.createdBy.toLowerCase()) {
          setTxStatus('✗ Only Counterparty can execute the DvP settlement.');
          setIsSubmitting(false);
          return;
        }

        // Track seller security token needs
        const secKey = s.securityToken.toLowerCase();
        const sellerKey = s.seller.toLowerCase();
        if (!sellerSecNeeded[secKey]) sellerSecNeeded[secKey] = {};
        sellerSecNeeded[secKey][sellerKey] = (sellerSecNeeded[secKey][sellerKey] ?? 0n) + s.tokenAmount;

        // Track buyer cash token needs
        const cashKey = s.cashToken.toLowerCase();
        const buyerKey = s.buyer.toLowerCase();
        if (!buyerCashNeeded[cashKey]) buyerCashNeeded[cashKey] = {};
        buyerCashNeeded[cashKey][buyerKey] = (buyerCashNeeded[cashKey][buyerKey] ?? 0n) + s.cashAmount;

        // Track our own approval needs
        if (me === sellerKey) {
          secNeeded[secKey] = (secNeeded[secKey] ?? 0n) + s.tokenAmount;
        }
        if (me === buyerKey) {
          cashNeeded[cashKey] = (cashNeeded[cashKey] ?? 0n) + s.cashAmount;
        }
      }

      // Pre-check: verify all counterparties have sufficient allowances
      for (const [tokenAddr, parties] of Object.entries(sellerSecNeeded)) {
        const secToken = new ethers.Contract(tokenAddr, SECURITY_TOKEN_ABI, signer);
        for (const [partyAddr, needed] of Object.entries(parties)) {
          if (partyAddr === me) continue; // we'll approve our own below
          const allowance: bigint = await secToken.allowance(partyAddr, dvpAddr);
          if (allowance < needed) {
            const short = `${partyAddr.slice(0, 6)}…${partyAddr.slice(-4)}`;
            setTxStatus(`✗ Seller (${short}) has not approved sufficient security tokens to the DvP contract. The seller must connect their wallet and approve before batch execution.`);
            setIsSubmitting(false);
            return;
          }
        }
      }
      for (const [tokenAddr, parties] of Object.entries(buyerCashNeeded)) {
        const cashToken = new ethers.Contract(tokenAddr, CASH_TOKEN_ABI, signer);
        for (const [partyAddr, needed] of Object.entries(parties)) {
          if (partyAddr === me) continue;
          const allowance: bigint = await cashToken.allowance(partyAddr, dvpAddr);
          if (allowance < needed) {
            const short = `${partyAddr.slice(0, 6)}…${partyAddr.slice(-4)}`;
            setTxStatus(`✗ Buyer (${short}) has not approved sufficient cash tokens to the DvP contract. The buyer must connect their wallet and approve before batch execution.`);
            setIsSubmitting(false);
            return;
          }
        }
      }

      setTxStatus(`Batch executing ${ids.length} settlement(s)… approving tokens…`);

      // Approve aggregated security token totals (our side)
      for (const [tokenAddr, totalNeeded] of Object.entries(secNeeded)) {
        const secToken = new ethers.Contract(tokenAddr, SECURITY_TOKEN_ABI, signer);
        const allowance: bigint = await secToken.allowance(meChecksum, dvpAddr);
        if (allowance < totalNeeded) {
          const appTx = await secToken.approve(dvpAddr, totalNeeded);
          await appTx.wait();
        }
      }

      // Approve aggregated cash token totals (our side)
      for (const [tokenAddr, totalNeeded] of Object.entries(cashNeeded)) {
        const cashToken = new ethers.Contract(tokenAddr, CASH_TOKEN_ABI, signer);
        const allowance: bigint = await cashToken.allowance(meChecksum, dvpAddr);
        if (allowance < totalNeeded) {
          const appTx = await cashToken.approve(dvpAddr, totalNeeded);
          await appTx.wait();
        }
      }

      setTxStatus(`Batch executing ${ids.length} settlement(s)…`);
      // Each settlement requires ~500-700k gas for identity verification,
      // compliance checks, and ERC20Votes checkpoint updates.
      // Ethers.js auto-estimate is too low because it simulates a partial-
      // success scenario. Override with a generous per-settlement allowance.
      const gasLimit = ids.length * 800_000 + 200_000;
      const tx = await contracts.dvpSettlement.executeBatchSettlement(ids, false, { gasLimit });
      const receipt = await tx.wait();
      setTxStatus(`✓ Batch execute complete — ${ids.length} settlement(s) processed`);
      setSelectedIds(new Set());
      loadSettlements();
    } catch (e: any) {
      setTxStatus(`✗ ${parseSettlementError(e)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!account) {
    return (
      <div className="glass-card p-6 md:p-12 text-center">
        <ArrowRightLeft size={48} className="mx-auto mb-4 text-purple-400" />
        <h2 className="text-xl md:text-2xl font-bold text-white mb-2">DvP Settlement</h2>
        <p className="text-gray-400">Connect your wallet to create and execute atomic DvP settlements.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xl md:text-2xl font-bold text-white">DvP Settlement</h2>
          <p className="text-gray-400 text-sm">Atomic delivery-versus-payment settlement of security tokens for cash.</p>
        </div>
        <button onClick={loadSettlements} className="p-2 hover:bg-white/10 rounded-lg transition-colors" title="Refresh">
          <RefreshCw size={18} className="text-gray-400" />
        </button>
      </header>

      {txStatus && (
        <div
          className={`glass-card px-4 py-3 text-sm font-medium ${
            txStatus.startsWith('✓') ? 'text-emerald-400' : txStatus.startsWith('✗') ? 'text-red-400' : 'text-purple-300'
          }`}
        >
          {txStatus}
        </div>
      )}

      {/* Create Settlement */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Plus size={20} className="text-purple-400" />
          <h3 className="font-bold text-white">Create Settlement</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Seller Address</label>
            <input
              type="text"
              value={seller}
              onChange={(e) => setSeller(e.target.value)}
              placeholder="0x…"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Buyer Address</label>
            <input
              type="text"
              value={buyer}
              onChange={(e) => setBuyer(e.target.value)}
              placeholder="0x…"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Security Token</label>
            <select
              value={selectedSecurityToken}
              onChange={(e) => setSelectedSecurityToken(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
            >
              {tokenOptions.length === 0 && <option value="">Loading tokens…</option>}
              {tokenOptions.map((t) => (
                <option key={t.address} value={t.address} className="bg-gray-900">
                  {t.symbol} — {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Security Token Amount</label>
            <input
              type="text"
              value={tokenAmount}
              onChange={(e) => setTokenAmount(e.target.value)}
              placeholder="100"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Cash Amount (THKD)</label>
            <input
              type="text"
              value={cashAmount}
              onChange={(e) => setCashAmount(e.target.value)}
              placeholder="50000"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Deadline (hours from now)</label>
            <input
              type="text"
              value={deadlineHours}
              onChange={(e) => setDeadlineHours(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
            />
          </div>
          <div className="flex items-end">
            {(() => {
              const me = account?.toLowerCase() ?? '';
              const isPartyMatch =
                !!me &&
                ((!!seller && me === seller.toLowerCase()) ||
                  (!!buyer && me === buyer.toLowerCase()));
              const partiesEntered = !!seller && !!buyer;
              return (
                <button
                  onClick={handleCreate}
                  disabled={
                    isSubmitting ||
                    !seller ||
                    !buyer ||
                    !tokenAmount ||
                    !cashAmount ||
                    !selectedSecurityToken ||
                    (partiesEntered && !isPartyMatch)
                  }
                  title={
                    partiesEntered && !isPartyMatch
                      ? 'Only the seller or buyer can place a DvP settlement instruction.'
                      : ''
                  }
                  className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-2.5 px-4 rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-purple-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSubmitting && <Loader2 size={16} className="animate-spin" />}
                  Create Settlement
                </button>
              );
            })()}
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Note: only the seller or buyer can place a DvP settlement instruction. Third parties cannot
          create settlements on their behalf.
        </p>
      </div>

      {/* Batch Execute Bar */}
      {pendingIds.length > 0 && (
        <div className="glass-card px-4 md:px-6 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <CheckSquare size={18} className="text-purple-400" />
            <span className="text-sm text-gray-300">
              {selectedIds.size} of {pendingIds.length} pending settlement(s) selected
            </span>
          </div>
          <button
            onClick={handleBatchExecute}
            disabled={isSubmitting || selectedIds.size === 0}
            className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white py-2 px-5 rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-emerald-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSubmitting && <Loader2 size={14} className="animate-spin" />}
            <Play size={14} />
            Batch Execute ({selectedIds.size})
          </button>
        </div>
      )}

      {/* Settlements List */}
      <div className="glass-card overflow-hidden">
        <div className="p-6 border-b border-white/10">
          <h3 className="font-bold text-white">Settlement History</h3>
        </div>
        {visibleSettlements.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            No settlements found. Only the seller or buyer can view their own DvP settlement history.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-white/5 text-xs text-gray-400 text-left">
                <tr>
                  <th className="px-3 md:px-6 py-3 font-medium w-10">
                    {pendingIds.length > 0 && (
                      <input
                        type="checkbox"
                        checked={pendingIds.length > 0 && pendingIds.every((id) => selectedIds.has(id))}
                        onChange={toggleSelectAll}
                        className="accent-purple-500 w-4 h-4 cursor-pointer"
                        title="Select all pending"
                      />
                    )}
                  </th>
                  <th className="px-6 py-3 font-medium">ID</th>
                  <th className="px-6 py-3 font-medium">Seller</th>
                  <th className="px-6 py-3 font-medium">Buyer</th>
                  <th className="px-6 py-3 font-medium">Security Token</th>
                  <th className="px-6 py-3 font-medium">Amount</th>
                  <th className="px-6 py-3 font-medium">Cash Token</th>
                  <th className="px-6 py-3 font-medium">Cash Amt</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Created By</th>
                  <th className="px-6 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {visibleSettlements.map((s) => (
                  <tr key={s.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-4 py-4">
                      {s.status === 0 && !isExpired(s, chainTime) && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(s.id)}
                          onChange={() => toggleSelect(s.id)}
                          className="accent-purple-500 w-4 h-4 cursor-pointer"
                        />
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-gray-300">#{s.id}</td>
                    <td className="px-6 py-4 text-sm font-mono text-gray-300">{s.seller.slice(0, 8)}…</td>
                    <td className="px-6 py-4 text-sm font-mono text-gray-300">{s.buyer.slice(0, 8)}…</td>
                    <td className="px-6 py-4 text-sm">
                      <span className="text-purple-300 font-medium">{s.securitySymbol}</span>
                      <span className="block text-[10px] font-mono text-gray-500" title={s.securityToken}>{s.securityToken.slice(0, 6)}…{s.securityToken.slice(-4)}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-white">{Number(s.tokenAmount).toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className="text-emerald-300 font-medium">{s.cashSymbol}</span>
                      <span className="block text-[10px] font-mono text-gray-500" title={s.cashToken}>{s.cashToken.slice(0, 6)}…{s.cashToken.slice(-4)}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-white">{Number(s.cashAmount).toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${isExpired(s, chainTime) ? EXPIRED_COLOR : STATUS_COLORS[s.status]}`}>
                        {isExpired(s, chainTime) ? 'Expired' : STATUS_LABELS[s.status]}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-gray-300" title={s.createdBy}>
                      {s.createdBy.slice(0, 8)}…
                      {account && s.createdBy.toLowerCase() === account.toLowerCase() && (
                        <span className="block text-[10px] text-amber-400">(you)</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {s.status === 0 && (
                        <div className="flex gap-2">
                          {isExpired(s, chainTime) ? (
                            <button
                              onClick={() => handleMarkFailed(s.id)}
                              className="text-xs bg-orange-500/20 text-orange-400 px-3 py-1 rounded-lg hover:bg-orange-500/30 transition-colors border border-orange-500/20"
                            >
                              <XCircle size={12} className="inline mr-1" />
                              Mark Failed
                            </button>
                          ) : account && s.createdBy.toLowerCase() === account.toLowerCase() ? (
                            <span className="text-xs text-gray-500 italic">Awaiting counterparty</span>
                          ) : (
                            <>
                              <button
                                onClick={() => handleExecute(s.id)}
                                className="text-xs bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-lg hover:bg-emerald-500/30 transition-colors border border-emerald-500/20"
                              >
                                <Play size={12} className="inline mr-1" />
                                Execute
                              </button>
                              <button
                                onClick={() => handleCancel(s.id)}
                                className="text-xs bg-red-500/20 text-red-400 px-3 py-1 rounded-lg hover:bg-red-500/30 transition-colors border border-red-500/20"
                              >
                                <XCircle size={12} className="inline mr-1" />
                                Cancel
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Settlement;
