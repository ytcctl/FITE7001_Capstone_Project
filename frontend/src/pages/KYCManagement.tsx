import React, { useState, useEffect, useCallback } from 'react';
import { useWeb3 } from '../context/Web3Context';
import { CLAIM_TOPICS, CONTRACT_ADDRESSES, IDENTITY_ABI, ORDER_BOOK_ABI, GOVERNOR_ABI, GOVERNOR_FACTORY_ABI,
  DVP_SETTLEMENT_ABI, SECURITY_TOKEN_ABI, TOKEN_FACTORY_ABI, TOKEN_FACTORY_V2_ABI, CASH_TOKEN_ABI, rpcUrlForBrowser } from '../config/contracts';
import { ethers } from 'ethers';
import { ShieldCheck, UserPlus, CheckCircle, XCircle, Search, Loader2, Key, Fingerprint, AlertTriangle, ShieldAlert, ChevronDown, ChevronUp } from 'lucide-react';

const KYCManagement: React.FC = () => {
  const { account, signer, contracts, roles } = useWeb3();
  // Register Identity
  const [regAddress, setRegAddress] = useState('');
  const [regCountry, setRegCountry] = useState('HK');
  const [regMode, setRegMode] = useState<'onchainid' | 'boolean'>('onchainid');
  // Issue Signed Claim (ONCHAINID)
  const [claimAddress, setClaimAddress] = useState('');
  const [claimTopic, setClaimTopic] = useState(1);
  const [claimMode, setClaimMode] = useState<'signed' | 'boolean'>('signed');
  const [claimValue, setClaimValue] = useState(true);
  const [signedAction, setSignedAction] = useState<'issue' | 'revoke'>('issue');
  // Lookup
  const [lookupAddress, setLookupAddress] = useState('');
  const [lookupResult, setLookupResult] = useState<null | {
    registered: boolean;
    verified: boolean;
    country: string;
    identityContract: string;
    claims: Record<number, boolean>;
  }>(null);
  // Status
  const [txStatus, setTxStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ─── Compliance Force Cancel state ──
  const [forceCancelAddr, setForceCancelAddr] = useState('');
  const [forceCancelStatus, setForceCancelStatus] = useState('');
  const [forceCancelling, setForceCancelling] = useState(false);
  // Active governance proposals that target the non-compliant address (mint)
  const [pendingMintProposals, setPendingMintProposals] = useState<
    { id: string; govAddr: string; tokenName: string; description: string; targets: string[]; values: bigint[]; calldatas: string[] }[]
  >([]);
  // Outstanding trade orders on the order book for the non-compliant address
  const [pendingTradeOrders, setPendingTradeOrders] = useState<
    { orderId: number; marketName: string; obAddr: string; side: string; price: string; quantity: string; filled: string; status: string }[]
  >([]);
  // Pending DvP settlements involving the non-compliant address
  const [pendingSettlements, setPendingSettlements] = useState<
    { id: number; buyer: string; seller: string; tokenLabel: string; tokenAddr: string; tokenAmount: string; cashAmount: string }[]
  >([]);
  const [cancellingProposal, setCancellingProposal] = useState<string | null>(null);
  const [cancellingSettlement, setCancellingSettlement] = useState<number | null>(null);
  const [cancellingTradeOrder, setCancellingTradeOrder] = useState<number | null>(null);

  // ─── History / Audit Trail state ──
  const [showHistory, setShowHistory] = useState(false);
  const [historyTransfers, setHistoryTransfers] = useState<
    { tokenLabel: string; from: string; to: string; amount: string; block: number; date: string; status: string }[]
  >([]);
  const [historyOrders, setHistoryOrders] = useState<
    { orderId: number; marketName: string; side: string; price: string; quantity: string; filled: string; status: string; block: number; date: string }[]
  >([]);
  const [historySettlements, setHistorySettlements] = useState<
    { id: number; buyer: string; seller: string; tokenLabel: string; tokenAmount: string; cashAmount: string; status: string; block: number; date: string }[]
  >([]);
  const [historyProposals, setHistoryProposals] = useState<
    { id: string; tokenName: string; description: string; state: string; block: number; date: string }[]
  >([]);

  // ─── Force Cancel: scan for non-compliant investor ──
  const handleScanNonCompliant = useCallback(async () => {
    if (!contracts || !forceCancelAddr.trim()) return;
    let addr: string;
    try { addr = ethers.getAddress(forceCancelAddr.trim()); } catch { setForceCancelStatus('✗ Invalid Ethereum address'); return; }
    setForceCancelling(true);
    setForceCancelStatus('Scanning orders, governance proposals, and settlements…');
    setPendingMintProposals([]);
    setPendingTradeOrders([]);
    setPendingSettlements([]);
    setHistoryTransfers([]);
    setHistoryOrders([]);
    setHistorySettlements([]);
    setHistoryProposals([]);
    setShowHistory(false);

    try {
      // 1. Scan all orders across all markets (pending + history)
      const tradeOrders: typeof pendingTradeOrders = [];
      const completedOrders: typeof historyOrders = [];
      try {
        const markets = await contracts.orderBookFactory.activeMarkets();
        for (const mkt of markets) {
          const ob = new ethers.Contract(mkt.orderBook, ORDER_BOOK_ABI, contracts.securityToken.runner);
          try {
            const orderIds: bigint[] = await ob.getTraderOrders(addr);
            if (orderIds.length === 0) continue;
            const orders = await ob.getOrdersBatch([...orderIds]);
            // Query OrderPlaced events for block numbers
            const placedEvents = await ob.queryFilter(ob.filters.OrderPlaced(null, addr), 0, 'latest');
            const orderBlockMap = new Map<number, number>();
            for (const ev of placedEvents) orderBlockMap.set(Number((ev as ethers.EventLog).args[0]), ev.blockNumber);
            const STATUS_LABELS = ['Open', 'PartiallyFilled', 'Filled', 'Cancelled'];
            for (const o of orders) {
              const status = Number(o.status);
              const row = {
                orderId: Number(o.id),
                marketName: `${mkt.name} (${mkt.symbol})`,
                obAddr: mkt.orderBook,
                side: Number(o.side) === 0 ? 'BUY' : 'SELL',
                price: Number(ethers.formatUnits(o.price, 6)).toLocaleString(),
                quantity: Number(ethers.formatEther(o.quantity)).toLocaleString(),
                filled: Number(ethers.formatEther(o.filled)).toLocaleString(),
                status: STATUS_LABELS[status] || String(status),
                block: orderBlockMap.get(Number(o.id)) || 0,
                date: '',
              };
              if (status === 0 || status === 1) {
                tradeOrders.push(row);
              } else {
                completedOrders.push(row);
              }
            }
          } catch (e) { console.warn(`Order scan for ${mkt.symbol}:`, e); }
        }
      } catch (e) { console.warn('Order scan:', e); }
      setPendingTradeOrders(tradeOrders);
      setHistoryOrders(completedOrders);

      // 2. Scan governance proposals for mint proposals targeting this address (pending + history)
      const mintProposals: typeof pendingMintProposals = [];
      const completedProposals: typeof historyProposals = [];
      const GOV_STATE_LABELS: Record<number, string> = { 0: 'Pending', 1: 'Active', 2: 'Canceled', 3: 'Defeated', 4: 'Succeeded', 5: 'Queued', 6: 'Expired', 7: 'Executed' };
      try {
        const freshProvider = new ethers.JsonRpcProvider(rpcUrlForBrowser());
        const suites = await contracts.governorFactory.allGovernanceSuites();
        const iface = new ethers.Interface(SECURITY_TOKEN_ABI);
        for (const suite of suites) {
          const gov = new ethers.Contract(suite.governor, GOVERNOR_ABI, freshProvider);
          const events = await gov.queryFilter(gov.filters.ProposalCreated(), 0, 'latest');
          for (const event of events) {
            const log = event as ethers.EventLog;
            const args = log.args;
            const proposalId = args[0].toString();
            const calldatas: string[] = args[5];
            const description: string = args[8];
            const stateNum = Number(await gov.state(proposalId));
            // Check if it's a mint targeting the address
            if (calldatas?.length === 1 && calldatas[0].length >= 10 && calldatas[0].slice(0, 10) === '0x40c10f19') {
              try {
                const decoded = iface.decodeFunctionData('mint', calldatas[0]);
                if (decoded[0].toLowerCase() === addr.toLowerCase()) {
                  let tokenName = suite.token.slice(0, 10) + '…';
                  try {
                    const token = new ethers.Contract(suite.token, SECURITY_TOKEN_ABI, freshProvider);
                    const [n, s] = await Promise.all([token.name(), token.symbol()]);
                    tokenName = `${n} (${s})`;
                  } catch {}
                  if (stateNum === 0 || stateNum === 1 || stateNum === 4 || stateNum === 5) {
                    // Pending/Active/Succeeded/Queued — actionable
                    mintProposals.push({
                      id: proposalId,
                      govAddr: suite.governor,
                      tokenName,
                      description,
                      targets: args[2],
                      values: args[3],
                      calldatas,
                    });
                  } else {
                    // Canceled(2)/Defeated(3)/Expired(6)/Executed(7) — history
                    completedProposals.push({
                      id: proposalId,
                      tokenName,
                      description,
                      state: GOV_STATE_LABELS[stateNum] || String(stateNum),
                      block: log.blockNumber,
                      date: '',
                    });
                  }
                }
              } catch {}
            }
          }
        }
        freshProvider.destroy();
      } catch (e) { console.warn('Governance scan:', e); }
      setPendingMintProposals(mintProposals);
      setHistoryProposals(completedProposals);

      // 3. Scan DvP settlements involving this address (pending + history)
      const settlements: typeof pendingSettlements = [];
      const completedSettlements: typeof historySettlements = [];
      const DVP_STATUS_LABELS: Record<number, string> = { 0: 'Pending', 1: 'Settled', 2: 'Failed', 3: 'Cancelled' };
      try {
        const dvp = contracts.dvpSettlement;
        const count = Number(await dvp.settlementCount());
        // Query all SettlementCreated events for block numbers
        const settleCreatedEvents = await dvp.queryFilter(dvp.filters.SettlementCreated(), 0, 'latest');
        const settleBlockMap = new Map<number, number>();
        for (const ev of settleCreatedEvents) settleBlockMap.set(Number((ev as ethers.EventLog).args[0]), ev.blockNumber);
        for (let i = 1; i <= count; i++) {
          try {
            const s = await dvp.settlements(i);
            if (s.buyer.toLowerCase() !== addr.toLowerCase() && s.seller.toLowerCase() !== addr.toLowerCase()) continue;
            let tokenLabel = s.securityToken.slice(0, 6) + '…' + s.securityToken.slice(-4);
            try {
              const tok = new ethers.Contract(s.securityToken, SECURITY_TOKEN_ABI, contracts.securityToken.runner);
              const [n, sym] = await Promise.all([tok.name(), tok.symbol()]);
              tokenLabel = `${n} (${sym})`;
            } catch {}
            const statusNum = Number(s.status);
            if (statusNum === 0) {
              settlements.push({
                id: i,
                buyer: s.buyer,
                seller: s.seller,
                tokenLabel,
                tokenAddr: s.securityToken,
                tokenAmount: Number(ethers.formatEther(s.tokenAmount)).toLocaleString(),
                cashAmount: Number(ethers.formatUnits(s.cashAmount, 6)).toLocaleString(),
              });
            } else {
              completedSettlements.push({
                id: i,
                buyer: s.buyer,
                seller: s.seller,
                tokenLabel,
                tokenAmount: Number(ethers.formatEther(s.tokenAmount)).toLocaleString(),
                cashAmount: Number(ethers.formatUnits(s.cashAmount, 6)).toLocaleString(),
                status: DVP_STATUS_LABELS[statusNum] || String(statusNum),
                block: settleBlockMap.get(i) || 0,
                date: '',
              });
            }
          } catch {}
        }
      } catch (e) { console.warn('Settlement scan:', e); }
      setPendingSettlements(settlements);
      setHistorySettlements(completedSettlements);

      // 4. Scan token transfer history involving this address
      const transfers: typeof historyTransfers = [];
      try {
        const tokenAddrs: { addr: string; label: string }[] = [];
        // Gather all security tokens from both factories
        try {
          const v1Tokens = await contracts.tokenFactory.allTokens();
          for (const t of v1Tokens) tokenAddrs.push({ addr: t.tokenAddress, label: `${t.name} (${t.symbol})` });
        } catch {}
        try {
          const v2Tokens = await contracts.tokenFactoryV2.allTokens();
          for (const t of v2Tokens) tokenAddrs.push({ addr: t.proxyAddress, label: `${t.name} (${t.symbol})` });
        } catch {}
        // Add default security token if not already included
        const secAddr = await contracts.securityToken.getAddress();
        if (!tokenAddrs.some(t => t.addr.toLowerCase() === secAddr.toLowerCase())) {
          try {
            const [n, sym] = await Promise.all([contracts.securityToken.name(), contracts.securityToken.symbol()]);
            tokenAddrs.push({ addr: secAddr, label: `${n} (${sym})` });
          } catch {}
        }
        // Add cash token
        const cashAddr = await contracts.cashToken.getAddress();
        try {
          const [n, sym] = await Promise.all([contracts.cashToken.name(), contracts.cashToken.symbol()]);
          tokenAddrs.push({ addr: cashAddr, label: `${n} (${sym})` });
        } catch { tokenAddrs.push({ addr: cashAddr, label: 'THKD' }); }

        for (const { addr: tAddr, label } of tokenAddrs) {
          try {
            const tok = new ethers.Contract(tAddr, SECURITY_TOKEN_ABI, contracts.securityToken.runner);
            const [sentLogs, recvLogs] = await Promise.all([
              tok.queryFilter(tok.filters.Transfer(addr, null), 0, 'latest'),
              tok.queryFilter(tok.filters.Transfer(null, addr), 0, 'latest'),
            ]);
            const all = [...sentLogs, ...recvLogs];
            // deduplicate by tx hash + log index
            const seen = new Set<string>();
            for (const log of all) {
              const key = `${log.transactionHash}-${log.index}`;
              if (seen.has(key)) continue;
              seen.add(key);
              const parsed = tok.interface.parseLog({ topics: [...log.topics], data: log.data });
              if (!parsed) continue;
              const decimals = label.includes('THKD') || tAddr.toLowerCase() === cashAddr.toLowerCase() ? 6 : 18;
              const fromAddr = parsed.args.from as string;
              const toAddr = parsed.args.to as string;
              transfers.push({
                tokenLabel: label,
                from: fromAddr,
                to: toAddr,
                amount: Number(ethers.formatUnits(parsed.args.value, decimals)).toLocaleString(),
                block: log.blockNumber,
                date: '',
                status: fromAddr.toLowerCase() === addr.toLowerCase() ? 'Sent' : 'Received',
              });
            }
          } catch (e) { console.warn(`Transfer scan for ${label}:`, e); }
        }
        transfers.sort((a, b) => b.block - a.block);
      } catch (e) { console.warn('Transfer history scan:', e); }

      // 5. Batch-resolve block timestamps to dates
      const allBlockNums = new Set<number>();
      for (const t of transfers) if (t.block) allBlockNums.add(t.block);
      for (const o of completedOrders) if (o.block) allBlockNums.add(o.block);
      for (const s of completedSettlements) if (s.block) allBlockNums.add(s.block);
      for (const p of completedProposals) if (p.block) allBlockNums.add(p.block);
      const blockDateMap = new Map<number, string>();
      try {
        const provider = contracts.securityToken.runner?.provider;
        if (provider) {
          await Promise.all([...allBlockNums].map(async (bn) => {
            try {
              const b = await (provider as ethers.Provider).getBlock(bn);
              if (b) blockDateMap.set(bn, new Date(Number(b.timestamp) * 1000).toLocaleString());
            } catch {}
          }));
        }
      } catch {}
      for (const t of transfers) t.date = blockDateMap.get(t.block) || '—';
      for (const o of completedOrders) o.date = blockDateMap.get(o.block) || '—';
      for (const s of completedSettlements) s.date = blockDateMap.get(s.block) || '—';
      for (const p of completedProposals) p.date = blockDateMap.get(p.block) || '—';

      setHistoryTransfers(transfers);

      const parts: string[] = [];
      if (tradeOrders.length > 0) parts.push(`Found ${tradeOrders.length} outstanding trade order(s) — cancel below`);
      if (mintProposals.length > 0) parts.push(`Found ${mintProposals.length} pending mint proposal(s) — cancel below`);
      if (settlements.length > 0) parts.push(`Found ${settlements.length} pending settlement(s) — cancel below`);
      if (parts.length === 0) parts.push('✓ No outstanding orders, mint proposals, or settlements found.');
      const histParts: string[] = [];
      if (transfers.length > 0) histParts.push(`${transfers.length} transfer(s)`);
      if (completedOrders.length > 0) histParts.push(`${completedOrders.length} completed order(s)`);
      if (completedSettlements.length > 0) histParts.push(`${completedSettlements.length} completed settlement(s)`);
      if (completedProposals.length > 0) histParts.push(`${completedProposals.length} completed proposal(s)`);
      if (histParts.length > 0) parts.push(`History: ${histParts.join(', ')}`);
      setForceCancelStatus(parts.join('. '));
    } catch (e: any) {
      setForceCancelStatus(`✗ ${e?.reason || e?.message || 'Scan failed'}`);
    } finally {
      setForceCancelling(false);
    }
  }, [contracts, forceCancelAddr]);

  // Cancel a specific governance proposal
  const handleCancelProposal = async (proposal: typeof pendingMintProposals[0]) => {
    if (!contracts) return;
    setCancellingProposal(proposal.id);
    try {
      const gov = new ethers.Contract(proposal.govAddr, GOVERNOR_ABI, contracts.securityToken.runner);
      const descHash = ethers.keccak256(ethers.toUtf8Bytes(proposal.description));
      const tx = await gov.cancel(
        [...proposal.targets],
        [...proposal.values],
        [...proposal.calldatas],
        descHash
      );
      await tx.wait();
      setPendingMintProposals((prev) => prev.filter((p) => p.id !== proposal.id));
      setForceCancelStatus((prev) => prev + ` | Proposal #${proposal.id.slice(0, 8)}… cancelled.`);
    } catch (e: any) {
      setForceCancelStatus(`✗ Cancel proposal failed: ${e?.reason || e?.message || 'Unknown error'}`);
    } finally {
      setCancellingProposal(null);
    }
  };

  // Cancel a specific DvP settlement
  const handleCancelSettlement = async (settlementId: number) => {
    if (!contracts) return;
    setCancellingSettlement(settlementId);
    try {
      const tx = await contracts.dvpSettlement.cancelSettlement(settlementId);
      await tx.wait();
      setPendingSettlements((prev) => prev.filter((s) => s.id !== settlementId));
      setForceCancelStatus((prev) => prev + ` | Settlement #${settlementId} cancelled.`);
    } catch (e: any) {
      setForceCancelStatus(`✗ Cancel settlement failed: ${e?.reason || e?.message || 'Unknown error'}`);
    } finally {
      setCancellingSettlement(null);
    }
  };

  // Force-cancel a specific trade order
  const handleCancelTradeOrder = async (order: typeof pendingTradeOrders[0]) => {
    if (!contracts) return;
    setCancellingTradeOrder(order.orderId);
    try {
      const ob = new ethers.Contract(order.obAddr, ORDER_BOOK_ABI, contracts.securityToken.runner);
      const tx = await ob.forceCancelOrder(order.orderId, 'Non-compliant investor force cancel');
      await tx.wait();
      setPendingTradeOrders((prev) => prev.filter((o) => o.orderId !== order.orderId));
      setForceCancelStatus((prev) => prev + ` | Order #${order.orderId} cancelled.`);
    } catch (e: any) {
      setForceCancelStatus(`✗ Cancel order #${order.orderId} failed: ${e?.reason || e?.message || 'Unknown error'}`);
    } finally {
      setCancellingTradeOrder(null);
    }
  };

  const handleRegister = async () => {
    if (!contracts || !regAddress) return;
    let addr: string;
    try { addr = ethers.getAddress(regAddress.trim()); } catch { setTxStatus('✗ Invalid Ethereum address'); return; }
    setIsSubmitting(true);

    if (regMode === 'onchainid') {
      setTxStatus('Registering identity (auto-deploying ONCHAINID contract)…');
      try {
        const tx = await contracts.identityRegistry.registerIdentity(
          addr,
          ethers.ZeroAddress,  // auto-deploy via factory
          regCountry
        );
        setTxStatus('Transaction submitted. Waiting for confirmation…');
        await tx.wait();
        const identityAddr = await contracts.identityRegistry.identity(addr);
        setTxStatus(`✓ Identity registered. ONCHAINID: ${identityAddr}`);
        setRegAddress('');
      } catch (e: any) {
        setTxStatus(`✗ ${e?.reason || e?.message || 'Transaction failed'}`);
      } finally {
        setIsSubmitting(false);
      }
    } else {
      // Boolean path: temporarily clear IdentityFactory → register → restore
      try {
        const savedFactory = await contracts.identityRegistry.identityFactory();
        if (savedFactory !== ethers.ZeroAddress) {
          setTxStatus('Step 1/3 — Temporarily clearing IdentityFactory…');
          const tx1 = await contracts.identityRegistry.setIdentityFactory(ethers.ZeroAddress);
          await tx1.wait();
        }
        setTxStatus('Step 2/3 — Registering identity (Boolean mode, no ONCHAINID)…');
        const tx2 = await contracts.identityRegistry.registerIdentity(
          addr,
          ethers.ZeroAddress,
          regCountry
        );
        await tx2.wait();
        if (savedFactory !== ethers.ZeroAddress) {
          setTxStatus('Step 3/3 — Restoring IdentityFactory…');
          const tx3 = await contracts.identityRegistry.setIdentityFactory(savedFactory);
          await tx3.wait();
        }
        setTxStatus('✓ Identity registered (Boolean mode — no ONCHAINID). Use "Set Boolean Claim" to verify.');
        setRegAddress('');
      } catch (e: any) {
        setTxStatus(`✗ ${e?.reason || e?.message || 'Transaction failed'}`);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  /** Issue a cryptographically signed ERC-735 claim via ClaimIssuer */
  const handleIssueSignedClaim = async () => {
    if (!contracts || !signer || !claimAddress) return;
    let addr: string;
    try { addr = ethers.getAddress(claimAddress.trim()); } catch { setTxStatus('✗ Invalid Ethereum address'); return; }
    setIsSubmitting(true);
    setTxStatus(`Signing claim "${CLAIM_TOPICS[claimTopic]}" off-chain…`);
    try {
      const identityAddr = await contracts.identityRegistry.identity(addr);
      if (identityAddr === ethers.ZeroAddress) {
        setTxStatus('✗ Investor has no ONCHAINID contract. Register first.');
        setIsSubmitting(false);
        return;
      }

      // Build claim data: abi.encode(identityContract, topic, expiryTimestamp)
      // expiry 0 = no expiry
      const coder = ethers.AbiCoder.defaultAbiCoder();
      const data = coder.encode(
        ['address', 'uint256', 'uint256'],
        [identityAddr, claimTopic, 0]
      );

      // Hash that the ClaimIssuer expects: keccak256(abi.encode(identity, topic, data))
      const dataHash = ethers.keccak256(
        coder.encode(['address', 'uint256', 'bytes'], [identityAddr, claimTopic, data])
      );

      // Sign using the connected wallet (must be the ClaimIssuer's signing key)
      setTxStatus('Please sign the claim in MetaMask…');
      const signature = await signer.signMessage(ethers.getBytes(dataHash));

      // Call issueClaim on the IdentityRegistry
      setTxStatus('Submitting signed claim to blockchain…');
      const tx = await contracts.identityRegistry.issueClaim(
        addr,
        claimTopic,
        CONTRACT_ADDRESSES.claimIssuer,
        signature,
        data
      );
      setTxStatus('Transaction submitted. Waiting for confirmation…');
      await tx.wait();
      setTxStatus(`✓ Signed claim "${CLAIM_TOPICS[claimTopic]}" issued for ${addr.slice(0, 10)}…`);
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'Transaction failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  /** Simple boolean setClaim (backward-compatible) */
  const handleSetBooleanClaim = async () => {
    if (!contracts || !claimAddress) return;
    let addr: string;
    try { addr = ethers.getAddress(claimAddress.trim()); } catch { setTxStatus('✗ Invalid Ethereum address'); return; }
    setIsSubmitting(true);

    // Warn if the investor has ONCHAINID — boolean claims won't affect verification
    try {
      const identityAddr = await contracts.identityRegistry.identity(addr);
      const trustedIssuers = await contracts.identityRegistry.getTrustedIssuers();
      if (identityAddr !== ethers.ZeroAddress && trustedIssuers.length > 0) {
        setTxStatus('⚠ Warning: This investor has an ONCHAINID contract and trusted issuers are configured. Boolean claims will NOT affect their verification status. Use "Signed (ONCHAINID ERC-735)" mode instead.');
        setIsSubmitting(false);
        return;
      }
    } catch { /* proceed if check fails */ }

    setTxStatus(`Setting boolean claim ${CLAIM_TOPICS[claimTopic]}…`);
    try {
      const tx = await contracts.identityRegistry.setClaim(addr, claimTopic, claimValue);
      setTxStatus('Transaction submitted. Waiting for confirmation…');
      await tx.wait();
      setTxStatus(`✓ Claim "${CLAIM_TOPICS[claimTopic]}" ${claimValue ? 'set' : 'revoked'} for ${addr.slice(0, 10)}…`);
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'Transaction failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  /** Revoke an ONCHAINID ERC-735 claim by overwriting it with an already-expired claim */
  const handleRevokeSignedClaim = async () => {
    if (!contracts || !signer || !claimAddress) return;
    let addr: string;
    try { addr = ethers.getAddress(claimAddress.trim()); } catch { setTxStatus('✗ Invalid Ethereum address'); return; }
    setIsSubmitting(true);
    setTxStatus(`Revoking signed claim "${CLAIM_TOPICS[claimTopic]}"…`);
    try {
      const identityAddr = await contracts.identityRegistry.identity(addr);
      if (identityAddr === ethers.ZeroAddress) {
        setTxStatus('✗ Investor has no ONCHAINID contract.');
        setIsSubmitting(false);
        return;
      }

      // Overwrite the claim with expiry=1 (already expired in the past)
      // _hasValidClaimForTopic checks: if expiry != 0 && block.timestamp > expiry → skip
      const coder = ethers.AbiCoder.defaultAbiCoder();
      const data = coder.encode(
        ['address', 'uint256', 'uint256'],
        [identityAddr, claimTopic, 1]  // expiry = 1 (epoch second 1 — long expired)
      );

      // Sign the expired claim data
      const dataHash = ethers.keccak256(
        coder.encode(['address', 'uint256', 'bytes'], [identityAddr, claimTopic, data])
      );
      setTxStatus('Please sign the revocation in MetaMask…');
      const signature = await signer.signMessage(ethers.getBytes(dataHash));

      // Overwrite the claim on-chain via issueClaim (which calls Identity.addClaim)
      setTxStatus('Submitting revocation to blockchain…');
      const tx = await contracts.identityRegistry.issueClaim(
        addr,
        claimTopic,
        CONTRACT_ADDRESSES.claimIssuer,
        signature,
        data
      );
      await tx.wait();

      // Also revoke the boolean claim for consistency
      try {
        const tx2 = await contracts.identityRegistry.setClaim(addr, claimTopic, false);
        await tx2.wait();
      } catch { /* ignore if boolean revoke fails */ }

      setTxStatus(`✓ Signed claim "${CLAIM_TOPICS[claimTopic]}" revoked for ${addr.slice(0, 10)}…`);
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.data?.message || e?.message || 'Revocation failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLookup = async () => {
    if (!contracts || !lookupAddress) return;
    let addr: string;
    try {
      addr = ethers.getAddress(lookupAddress.trim());
    } catch {
      setTxStatus('✗ Invalid Ethereum address');
      return;
    }
    try {
      const [registered, verified, country, identityContract] = await Promise.all([
        contracts.identityRegistry.contains(addr),
        contracts.identityRegistry.isVerified(addr),
        contracts.identityRegistry.investorCountry(addr),
        contracts.identityRegistry.identity(addr),
      ]);

      // Check claims — for ONCHAINID investors, query the Identity contract directly
      const claims: Record<number, boolean> = {};
      const hasOnchainId = identityContract && identityContract !== ethers.ZeroAddress;
      let trustedIssuersExist = false;
      try {
        const issuers = await contracts.identityRegistry.getTrustedIssuers();
        trustedIssuersExist = issuers.length > 0;
      } catch {}

      if (hasOnchainId && trustedIssuersExist) {
        // Use the same validation path as isVerified: check if ClaimIssuer validates each topic
        const provider = (contracts.identityRegistry as any).runner?.provider ?? contracts.identityRegistry.runner;
        const identityAbi = [
          'function getClaimIdsByTopic(uint256 topic) view returns (bytes32[])',
          'function getClaim(bytes32 claimId) view returns (uint256 topic, uint256 scheme, address issuer, bytes signature, bytes data, string uri)',
        ];
        const idContract = new ethers.Contract(identityContract, identityAbi, provider);

        for (const t of Object.keys(CLAIM_TOPICS).map(Number)) {
          try {
            const claimIds = await idContract.getClaimIdsByTopic(t);
            let topicValid = false;
            for (const cid of claimIds) {
              const claim = await idContract.getClaim(cid);
              // Check via ClaimIssuer.isClaimValid
              try {
                const valid = await contracts.claimIssuer.isClaimValid(
                  identityContract, t, claim.signature, claim.data
                );
                if (!valid) continue;
                // Check revocation
                const revoked = await contracts.claimIssuer.isClaimRevoked(cid);
                if (revoked) continue;
                // Check expiry
                if (claim.data.length >= 194) { // 0x + 3*64 hex chars
                  try {
                    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                      ['address', 'uint256', 'uint256'], claim.data
                    );
                    const expiry = decoded[2];
                    if (expiry > 0n && BigInt(Math.floor(Date.now() / 1000)) > expiry) continue;
                  } catch {}
                }
                topicValid = true;
                break;
              } catch { continue; }
            }
            claims[t] = topicValid;
          } catch {
            claims[t] = false;
          }
          // Fallback: if ONCHAINID validation did not find a valid signed claim,
          // also check the boolean claim flag (e.g. topic set via setClaim but
          // never issued as a signed ERC-735 claim on the Identity contract).
          if (!claims[t]) {
            try { claims[t] = await contracts.identityRegistry.hasClaim(addr, t); } catch {}
          }
        }
      } else {
        // Fallback: boolean claim check
        for (const t of Object.keys(CLAIM_TOPICS).map(Number)) {
          claims[t] = await contracts.identityRegistry.hasClaim(addr, t);
        }
      }

      setLookupResult({ registered, verified, country, identityContract, claims });
    } catch (e: any) {
      setLookupResult(null);
      setTxStatus(`✗ Lookup failed: ${e?.reason || e?.message}`);
    }
  };

  if (!account) {
    return (
      <div className="glass-card p-12 text-center">
        <ShieldCheck size={48} className="mx-auto mb-4 text-purple-400" />
        <h2 className="text-2xl font-bold text-white mb-2">KYC Management</h2>
        <p className="text-gray-400">Connect your wallet to manage investor identities and KYC claims.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-bold text-white">KYC Management</h2>
        <p className="text-gray-400">Register identities and manage KYC/AML claims on the Identity Registry.</p>
      </header>

      {/* Status bar */}
      {txStatus && (
        <div
          className={`glass-card px-4 py-3 text-sm font-medium ${
            txStatus.startsWith('✓') ? 'text-emerald-400' : txStatus.startsWith('✗') ? 'text-red-400' : 'text-purple-300'
          }`}
        >
          {txStatus}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Register Identity ── */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus size={20} className="text-purple-400" />
            <h3 className="font-bold text-white">Register Identity</h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Investor Address</label>
              <input
                type="text"
                value={regAddress}
                onChange={(e) => setRegAddress(e.target.value)}
                placeholder="0x…"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Country Code (ISO-3166)</label>
              <input
                type="text"
                value={regCountry}
                onChange={(e) => setRegCountry(e.target.value.toUpperCase())}
                maxLength={2}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Identity Mode</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRegMode('onchainid')}
                  className={`flex-1 py-2 px-3 rounded-xl text-sm font-semibold transition-all ${
                    regMode === 'onchainid'
                      ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/25'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  ONCHAINID (ERC-735)
                </button>
                <button
                  type="button"
                  onClick={() => setRegMode('boolean')}
                  className={`flex-1 py-2 px-3 rounded-xl text-sm font-semibold transition-all ${
                    regMode === 'boolean'
                      ? 'bg-amber-600 text-white shadow-lg shadow-amber-500/25'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  Boolean (Simple)
                </button>
              </div>
              {regMode === 'boolean' && (
                <p className="text-xs text-amber-400/80 mt-2">
                  No Identity contract will be deployed. Verification uses simple on/off claim flags.
                  Set boolean claims after registration to complete KYC.
                </p>
              )}
            </div>
            <button
              onClick={handleRegister}
              disabled={isSubmitting || !regAddress}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-2.5 px-4 rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-purple-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting && <Loader2 size={16} className="animate-spin" />}
              Register Identity
            </button>
          </div>
        </div>

        {/* ── Issue Claim (Signed or Boolean) ── */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Key size={20} className="text-emerald-400" />
            <h3 className="font-bold text-white">Issue Claim</h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Investor Address</label>
              <input
                type="text"
                value={claimAddress}
                onChange={(e) => setClaimAddress(e.target.value)}
                placeholder="0x…"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Claim Topic</label>
              <select
                value={claimTopic}
                onChange={(e) => setClaimTopic(Number(e.target.value))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
              >
                {Object.entries(CLAIM_TOPICS).map(([id, name]) => (
                  <option key={id} value={id} className="bg-slate-800">
                    {id} — {name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Claim Mode</label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input
                    type="radio"
                    checked={claimMode === 'signed'}
                    onChange={() => setClaimMode('signed')}
                    className="accent-purple-500"
                  />
                  <Fingerprint size={14} /> Signed (ONCHAINID ERC-735)
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input
                    type="radio"
                    checked={claimMode === 'boolean'}
                    onChange={() => setClaimMode('boolean')}
                    className="accent-cyan-500"
                  />
                  Boolean (simple)
                </label>
              </div>
            </div>
            {claimMode === 'boolean' && (
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input type="radio" checked={claimValue} onChange={() => setClaimValue(true)} className="accent-emerald-500" />
                  Set (active)
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input type="radio" checked={!claimValue} onChange={() => setClaimValue(false)} className="accent-red-500" />
                  Revoke
                </label>
              </div>
            )}
            {claimMode === 'signed' && (
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input type="radio" checked={signedAction === 'issue'} onChange={() => setSignedAction('issue')} className="accent-emerald-500" />
                  Issue Claim
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input type="radio" checked={signedAction === 'revoke'} onChange={() => setSignedAction('revoke')} className="accent-red-500" />
                  Revoke Claim
                </label>
              </div>
            )}
            {claimMode === 'signed' ? (
              signedAction === 'issue' ? (
                <button
                  onClick={handleIssueSignedClaim}
                  disabled={isSubmitting || !claimAddress}
                  className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-2.5 px-4 rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-purple-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSubmitting && <Loader2 size={16} className="animate-spin" />}
                  <Fingerprint size={16} />
                  Sign &amp; Issue Claim
                </button>
              ) : (
                <button
                  onClick={handleRevokeSignedClaim}
                  disabled={isSubmitting || !claimAddress}
                  className="w-full bg-gradient-to-r from-red-600 to-orange-600 text-white py-2.5 px-4 rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-red-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSubmitting && <Loader2 size={16} className="animate-spin" />}
                  <XCircle size={16} />
                  Revoke Signed Claim
                </button>
              )
            ) : (
              <button
                onClick={handleSetBooleanClaim}
                disabled={isSubmitting || !claimAddress}
                className="w-full bg-gradient-to-r from-emerald-600 to-cyan-600 text-white py-2.5 px-4 rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-emerald-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSubmitting && <Loader2 size={16} className="animate-spin" />}
                {claimValue ? 'Set Claim' : 'Revoke Claim'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Lookup ── */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Search size={20} className="text-cyan-400" />
          <h3 className="font-bold text-white">Identity Lookup</h3>
        </div>
        <div className="flex gap-3 mb-4">
          <input
            type="text"
            value={lookupAddress}
            onChange={(e) => setLookupAddress(e.target.value)}
            placeholder="Investor address 0x…"
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
          />
          <button
            onClick={handleLookup}
            className="bg-white/10 hover:bg-white/15 border border-white/10 text-white px-6 py-2.5 rounded-xl font-medium text-sm transition-colors"
          >
            Look Up
          </button>
        </div>
        {lookupResult && (
          <div className="bg-white/5 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap gap-6 text-sm">
              <span className="text-gray-400">
                Registered:{' '}
                <span className={lookupResult.registered ? 'text-emerald-400' : 'text-red-400'}>
                  {lookupResult.registered ? 'Yes' : 'No'}
                </span>
              </span>
              <span className="text-gray-400">
                Verified:{' '}
                <span className={lookupResult.verified ? 'text-emerald-400' : 'text-red-400'}>
                  {lookupResult.verified ? 'Yes' : 'No'}
                </span>
              </span>
              <span className="text-gray-400">
                Country: <span className="text-white font-medium">{lookupResult.country || '—'}</span>
              </span>
            </div>
            {lookupResult.identityContract && lookupResult.identityContract !== ethers.ZeroAddress && (
              <>
                <div className="text-sm text-gray-400">
                  <Fingerprint size={14} className="inline mr-1 text-purple-400" />
                  ONCHAINID: <span className="text-purple-300 font-mono text-xs">{lookupResult.identityContract}</span>
                </div>
                <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-sm text-amber-300">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <span>This investor uses ONCHAINID verification. Boolean (simple) claims have <strong>no effect</strong> on their verified status. Use <strong>Signed (ONCHAINID ERC-735)</strong> mode to issue or revoke claims.</span>
                </div>
              </>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.entries(CLAIM_TOPICS).map(([id, name]) => (
                <div key={id} className="flex items-center gap-2 text-sm">
                  {lookupResult.claims[Number(id)] ? (
                    <CheckCircle size={14} className="text-emerald-400" />
                  ) : (
                    <XCircle size={14} className="text-red-400" />
                  )}
                  <span className="text-gray-300">{name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Compliance — Force Cancel (Admin/Agent only) ── */}
      {(roles.isAdmin || roles.isAgent) && (
        <div className="bg-red-950/30 rounded-2xl border border-red-500/30 p-6">
          <h2 className="text-lg font-semibold text-red-400 mb-2 flex items-center gap-2">
            <ShieldAlert size={20} />
            Compliance — Force Cancel
          </h2>
          <p className="text-gray-400 text-sm mb-4">
            Enter an investor address to scan for outstanding trade orders, pending governance mint proposals, and DvP settlements. Review and cancel individually below.
          </p>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">Investor Address</label>
              <input
                type="text"
                value={forceCancelAddr}
                onChange={(e) => { setForceCancelAddr(e.target.value); setForceCancelStatus(''); }}
                placeholder="0x…"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white font-mono text-sm focus:ring-2 focus:ring-red-500/50 focus:border-red-500/50"
              />
            </div>
            <button
              onClick={handleScanNonCompliant}
              disabled={!forceCancelAddr.trim() || forceCancelling}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-40 transition-colors whitespace-nowrap flex items-center gap-2"
            >
              {forceCancelling && <Loader2 size={14} className="animate-spin" />}
              Scan
            </button>
          </div>
          {forceCancelStatus && (
            <p className={`mt-3 text-sm ${forceCancelStatus.startsWith('✓') ? 'text-green-400' : forceCancelStatus.startsWith('✗') ? 'text-red-400' : 'text-amber-300'}`}>
              {forceCancelStatus}
            </p>
          )}

          {/* Outstanding Trade Orders */}
          {pendingTradeOrders.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-red-300 mb-2">Outstanding Trade Orders</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs border-b border-white/10">
                      <th className="text-left py-1 px-2">ID</th>
                      <th className="text-left py-1 px-2">Market</th>
                      <th className="text-left py-1 px-2">Side</th>
                      <th className="text-right py-1 px-2">Price</th>
                      <th className="text-right py-1 px-2">Qty</th>
                      <th className="text-right py-1 px-2">Filled</th>
                      <th className="text-left py-1 px-2">Status</th>
                      <th className="text-center py-1 px-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingTradeOrders.map((o) => (
                      <tr key={`${o.obAddr}-${o.orderId}`} className="border-b border-white/5 hover:bg-white/5">
                        <td className="py-1 px-2 text-gray-300 font-mono">#{o.orderId}</td>
                        <td className="py-1 px-2 text-gray-400 text-xs">{o.marketName}</td>
                        <td className={`py-1 px-2 font-semibold text-xs ${o.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{o.side}</td>
                        <td className="py-1 px-2 text-right text-white">{o.price}</td>
                        <td className="py-1 px-2 text-right text-white">{o.quantity}</td>
                        <td className="py-1 px-2 text-right text-gray-400">{o.filled}</td>
                        <td className="py-1 px-2 text-amber-300 text-xs">{o.status}</td>
                        <td className="py-1 px-2 text-center">
                          <button
                            onClick={() => handleCancelTradeOrder(o)}
                            disabled={cancellingTradeOrder !== null || cancellingSettlement !== null || cancellingProposal !== null}
                            className="text-red-400 hover:text-red-300 text-xs font-semibold disabled:opacity-50"
                          >
                            {cancellingTradeOrder === o.orderId ? <Loader2 size={12} className="animate-spin inline" /> : 'Cancel'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Pending Mint Proposals */}
          {pendingMintProposals.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-red-300 mb-2">Pending Mint Proposals (Governance)</h3>
              <div className="space-y-2">
                {pendingMintProposals.map((p) => (
                  <div key={p.id} className="flex items-center justify-between bg-black/30 rounded-lg px-4 py-3 border border-white/5">
                    <div className="min-w-0 flex-1 mr-3">
                      <div className="text-xs text-gray-500 font-mono">#{p.id.slice(0, 16)}…</div>
                      <div className="text-sm text-white truncate">{p.description}</div>
                      <div className="text-xs text-gray-400">{p.tokenName}</div>
                    </div>
                    <button
                      onClick={() => handleCancelProposal(p)}
                      disabled={cancellingProposal !== null || cancellingSettlement !== null || cancellingTradeOrder !== null}
                      className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center gap-1 shrink-0"
                    >
                      {cancellingProposal === p.id ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                      Cancel Proposal
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending DvP Settlements */}
          {pendingSettlements.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-red-300 mb-2">Pending DvP Settlements</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs border-b border-white/10">
                      <th className="text-left py-1 px-2">ID</th>
                      <th className="text-left py-1 px-2">Token</th>
                      <th className="text-left py-1 px-2">Buyer</th>
                      <th className="text-left py-1 px-2">Seller</th>
                      <th className="text-right py-1 px-2">Tokens</th>
                      <th className="text-right py-1 px-2">Cash</th>
                      <th className="text-center py-1 px-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingSettlements.map((s) => (
                      <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="py-1 px-2 text-gray-300 font-mono">#{s.id}</td>
                        <td className="py-1 px-2 text-gray-400 text-xs" title={s.tokenAddr}>{s.tokenLabel}</td>
                        <td className="py-1 px-2 text-gray-400 font-mono text-xs">{s.buyer.slice(0, 6)}…{s.buyer.slice(-4)}</td>
                        <td className="py-1 px-2 text-gray-400 font-mono text-xs">{s.seller.slice(0, 6)}…{s.seller.slice(-4)}</td>
                        <td className="py-1 px-2 text-right text-white">{s.tokenAmount}</td>
                        <td className="py-1 px-2 text-right text-gray-300">{s.cashAmount}</td>
                        <td className="py-1 px-2 text-center">
                          <button
                            onClick={() => handleCancelSettlement(s.id)}
                            disabled={cancellingSettlement !== null || cancellingTradeOrder !== null || cancellingProposal !== null}
                            className="text-red-400 hover:text-red-300 text-xs font-semibold disabled:opacity-50"
                          >
                            {cancellingSettlement === s.id ? <Loader2 size={12} className="animate-spin inline" /> : 'Cancel'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* History / Audit Trail (collapsible) */}
          {(historyTransfers.length > 0 || historyOrders.length > 0 || historySettlements.length > 0 || historyProposals.length > 0) && (
            <div className="mt-6 border-t border-white/10 pt-4">
              <button
                onClick={() => setShowHistory((p) => !p)}
                className="flex items-center gap-2 text-sm font-semibold text-gray-400 hover:text-gray-200 transition"
              >
                {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                History / Audit Trail
              </button>

              {showHistory && (
                <div className="mt-3 space-y-4">
                  {/* Completed Token Transfers */}
                  {historyTransfers.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-400 mb-2">Token Transfers ({historyTransfers.length})</h3>
                      <div className="overflow-x-auto max-h-64 overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-[#1e1e2f]">
                            <tr className="text-gray-500 text-xs border-b border-white/10">
                              <th className="text-left py-1 px-2">Token</th>
                              <th className="text-left py-1 px-2">From</th>
                              <th className="text-left py-1 px-2">To</th>
                              <th className="text-right py-1 px-2">Amount</th>
                              <th className="text-right py-1 px-2">Block</th>
                              <th className="text-left py-1 px-2">Date</th>
                              <th className="text-center py-1 px-2">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {historyTransfers.map((t, i) => (
                              <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                                <td className="py-1 px-2 text-gray-400 text-xs">{t.tokenLabel}</td>
                                <td className="py-1 px-2 text-gray-400 font-mono text-xs">{t.from.slice(0, 6)}…{t.from.slice(-4)}</td>
                                <td className="py-1 px-2 text-gray-400 font-mono text-xs">{t.to.slice(0, 6)}…{t.to.slice(-4)}</td>
                                <td className="py-1 px-2 text-right text-gray-300">{t.amount}</td>
                                <td className="py-1 px-2 text-right text-gray-500 font-mono text-xs">{t.block}</td>
                                <td className="py-1 px-2 text-gray-500 text-xs">{t.date}</td>
                                <td className={`py-1 px-2 text-center text-xs font-semibold ${t.status === 'Received' ? 'text-green-400' : 'text-red-400'}`}>{t.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Completed Trade Orders */}
                  {historyOrders.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-400 mb-2">Completed / Cancelled Trade Orders ({historyOrders.length})</h3>
                      <div className="overflow-x-auto max-h-64 overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-[#1e1e2f]">
                            <tr className="text-gray-500 text-xs border-b border-white/10">
                              <th className="text-left py-1 px-2">Order #</th>
                              <th className="text-left py-1 px-2">Market</th>
                              <th className="text-center py-1 px-2">Side</th>
                              <th className="text-right py-1 px-2">Price</th>
                              <th className="text-right py-1 px-2">Qty</th>
                              <th className="text-right py-1 px-2">Filled</th>
                              <th className="text-right py-1 px-2">Block</th>
                              <th className="text-left py-1 px-2">Date</th>
                              <th className="text-center py-1 px-2">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {historyOrders.map((o) => (
                              <tr key={o.orderId} className="border-b border-white/5 hover:bg-white/5">
                                <td className="py-1 px-2 text-gray-300 font-mono">#{o.orderId}</td>
                                <td className="py-1 px-2 text-gray-400">{o.marketName}</td>
                                <td className={`py-1 px-2 text-center ${o.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{o.side}</td>
                                <td className="py-1 px-2 text-right text-gray-300">{o.price}</td>
                                <td className="py-1 px-2 text-right text-gray-300">{o.quantity}</td>
                                <td className="py-1 px-2 text-right text-gray-300">{o.filled}</td>
                                <td className="py-1 px-2 text-right text-gray-500 font-mono text-xs">{o.block}</td>
                                <td className="py-1 px-2 text-gray-500 text-xs">{o.date}</td>
                                <td className={`py-1 px-2 text-center text-xs font-semibold ${o.status === 'Filled' ? 'text-green-400' : 'text-gray-500'}`}>{o.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Completed DvP Settlements */}
                  {historySettlements.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-400 mb-2">Completed DvP Settlements ({historySettlements.length})</h3>
                      <div className="overflow-x-auto max-h-64 overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-[#1e1e2f]">
                            <tr className="text-gray-500 text-xs border-b border-white/10">
                              <th className="text-left py-1 px-2">ID</th>
                              <th className="text-left py-1 px-2">Token</th>
                              <th className="text-left py-1 px-2">Buyer</th>
                              <th className="text-left py-1 px-2">Seller</th>
                              <th className="text-right py-1 px-2">Tokens</th>
                              <th className="text-right py-1 px-2">Cash</th>
                              <th className="text-right py-1 px-2">Block</th>
                              <th className="text-left py-1 px-2">Date</th>
                              <th className="text-center py-1 px-2">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {historySettlements.map((s) => (
                              <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                                <td className="py-1 px-2 text-gray-300 font-mono">#{s.id}</td>
                                <td className="py-1 px-2 text-gray-400 text-xs">{s.tokenLabel}</td>
                                <td className="py-1 px-2 text-gray-400 font-mono text-xs">{s.buyer.slice(0, 6)}…{s.buyer.slice(-4)}</td>
                                <td className="py-1 px-2 text-gray-400 font-mono text-xs">{s.seller.slice(0, 6)}…{s.seller.slice(-4)}</td>
                                <td className="py-1 px-2 text-right text-gray-300">{s.tokenAmount}</td>
                                <td className="py-1 px-2 text-right text-gray-300">{s.cashAmount}</td>
                                <td className="py-1 px-2 text-right text-gray-500 font-mono text-xs">{s.block}</td>
                                <td className="py-1 px-2 text-gray-500 text-xs">{s.date}</td>
                                <td className={`py-1 px-2 text-center text-xs font-semibold ${s.status === 'Settled' ? 'text-green-400' : s.status === 'Failed' ? 'text-red-400' : 'text-gray-500'}`}>{s.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Completed Governance Mint Proposals */}
                  {historyProposals.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-400 mb-2">Completed Governance Mint Proposals ({historyProposals.length})</h3>
                      <div className="overflow-x-auto max-h-64 overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-[#1e1e2f]">
                            <tr className="text-gray-500 text-xs border-b border-white/10">
                              <th className="text-left py-1 px-2">Proposal ID</th>
                              <th className="text-left py-1 px-2">Token</th>
                              <th className="text-left py-1 px-2">Description</th>
                              <th className="text-right py-1 px-2">Block</th>
                              <th className="text-left py-1 px-2">Date</th>
                              <th className="text-center py-1 px-2">State</th>
                            </tr>
                          </thead>
                          <tbody>
                            {historyProposals.map((p) => (
                              <tr key={p.id} className="border-b border-white/5 hover:bg-white/5">
                                <td className="py-1 px-2 text-gray-300 font-mono text-xs">{p.id.slice(0, 10)}…</td>
                                <td className="py-1 px-2 text-gray-400 text-xs">{p.tokenName}</td>
                                <td className="py-1 px-2 text-gray-400 text-xs truncate max-w-[200px]" title={p.description}>{p.description}</td>
                                <td className="py-1 px-2 text-right text-gray-500 font-mono text-xs">{p.block}</td>
                                <td className="py-1 px-2 text-gray-500 text-xs">{p.date}</td>
                                <td className={`py-1 px-2 text-center text-xs font-semibold ${p.state === 'Executed' ? 'text-green-400' : p.state === 'Canceled' ? 'text-yellow-400' : 'text-gray-500'}`}>{p.state}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default KYCManagement;
