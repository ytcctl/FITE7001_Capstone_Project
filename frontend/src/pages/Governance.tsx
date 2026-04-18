import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../context/Web3Context';
import { CONTRACT_ADDRESSES, SECURITY_TOKEN_ABI, GOVERNOR_ABI, TIMELOCK_ABI, rpcUrlForBrowser } from '../config/contracts';
import { Vote, Clock, CheckCircle, XCircle, AlertTriangle, Users, Shield, Loader2, ChevronDown, ChevronUp, RefreshCw, Plus, Play, FileText, Timer, Rocket } from 'lucide-react';

// ─── Human-readable error decoder for Governor / Timelock custom errors ───
function decodeGovernanceError(e: any): string {
  // ethers v6 sometimes populates e.reason
  if (e.reason && !e.reason.includes('unknown custom error')) return e.reason;

  // Hunt for revert data in various places ethers v6 may stash it
  const revertData: string | undefined =
    e.data ?? e.error?.data ?? e.info?.error?.data?.data ?? e.info?.error?.data ?? e.revert?.data;

  if (revertData && typeof revertData === 'string' && revertData.startsWith('0x') && revertData.length >= 10) {
    const sel = revertData.slice(0, 10);
    try {
      // GovernorInsufficientProposerVotes(address proposer, uint256 votes, uint256 threshold)
      if (sel === '0xc242ee16') {
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
          ['address', 'uint256', 'uint256'], '0x' + revertData.slice(10));
        const votes = Number(ethers.formatUnits(decoded[1], 18));
        const threshold = Number(ethers.formatUnits(decoded[2], 18));
        return `Insufficient voting power to propose. You have ${votes.toLocaleString()} votes but need at least ${threshold.toLocaleString()}.`;
      }
      // GovernorUnexpectedProposalState(uint256 proposalId, ProposalState current, bytes32 expected)
      if (sel === '0x5765a514') {
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
          ['uint256', 'uint8', 'bytes32'], '0x' + revertData.slice(10));
        const STATES = ['Pending','Active','Canceled','Defeated','Succeeded','Queued','Expired','Executed'];
        return `Proposal is currently "${STATES[Number(decoded[1])] || decoded[1]}" — cannot perform this action.`;
      }
      // GovernorAlreadyCastVote(address voter)
      if (sel === '0x45c4b9e6') {
        return 'You have already voted on this proposal.';
      }
      // GovernorNonexistentProposal(uint256 proposalId)
      if (sel === '0xa8f42a59') {
        return 'This proposal does not exist.';
      }
      // GovernorRestrictedProposer(address proposer)
      if (sel === '0x3d523170') {
        return 'You are not authorized to submit proposals.';
      }
      // TimelockUnexpectedOperationState(bytes32 operationId, bytes32 expectedStates)
      if (sel === '0x7a3c4c17') {
        return 'Timelock operation is not ready. Click "⏩ Skip Timelock" first to advance time past the delay, then try Execute again.';
      }
      // TimelockInsufficientDelay(uint256 delay, uint256 minDelay)
      if (sel === '0x547f2829') {
        return 'Timelock delay has not been met. Click "⏩ Skip Timelock" to advance time.';
      }
    } catch { /* ignore decode failures */ }
  }

  // Dig into nested RPC error objects (ethers v6 UNKNOWN_ERROR wraps the
  // real node message inside e.error or e.info.error)
  const nested: string | undefined =
    (typeof e.error?.data?.message === 'string' && e.error.data.message) ||
    (typeof e.error?.message === 'string' && e.error.message) ||
    (typeof e.info?.error?.message === 'string' && e.info.error.message);
  if (nested && nested !== 'Internal JSON-RPC error.' && nested !== 'Internal JSON-RPC error') {
    return nested;
  }

  // Fallback: clean up the message
  const msg: string = e.shortMessage || e.message || 'Transaction failed';
  if (msg.includes('could not coalesce error')) {
    return 'Transaction rejected by the node. Please check your wallet connection and try again.';
  }
  return msg.replace(/\(data="0x[0-9a-fA-F]+"/g, '(data=…').replace(/transaction=\{[^}]+\}/g, '').trim();
}

/** Format a raw wei bigint as a clean token string (no trailing decimals). */
function formatTokenAmount(wei: bigint): string {
  const raw = ethers.formatEther(wei);
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return raw;
  // Show up to 4 decimal places, but strip trailing zeros
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

// Proposal state enum (matches GovernorCountingSimple)
const PROPOSAL_STATES = [
  'Pending',    // 0
  'Active',     // 1
  'Canceled',   // 2
  'Defeated',   // 3
  'Succeeded',  // 4
  'Queued',     // 5
  'Expired',    // 6
  'Executed',   // 7
];

const STATE_COLORS: string[] = [
  'bg-amber-500/20 text-amber-400 border-amber-500/30',     // Pending
  'bg-blue-500/20 text-blue-400 border-blue-500/30',        // Active
  'bg-gray-500/20 text-gray-400 border-gray-500/30',        // Canceled
  'bg-red-500/20 text-red-400 border-red-500/30',           // Defeated
  'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', // Succeeded
  'bg-purple-500/20 text-purple-400 border-purple-500/30',  // Queued
  'bg-gray-500/20 text-gray-400 border-gray-500/30',        // Expired
  'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',        // Executed
];

interface ProposalInfo {
  id: string;
  proposer: string;
  state: number;
  stateName: string;
  snapshot: bigint;
  deadline: bigint;
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
  description: string;
  targets: string[];
  values: bigint[];
  calldatas: string[];
}

interface GovernanceSuite {
  token: string;
  governor: string;
  timelock: string;
  deployedAt: bigint;
}

const Governance: React.FC = () => {
  const { contracts, account, roles } = useWeb3();

  // ─── Token selector ───────────────────────────────────────
  const [governanceSuites, setGovernanceSuites] = useState<GovernanceSuite[]>([]);
  const [selectedToken, setSelectedToken] = useState<string>('');
  const [tokenNames, setTokenNames] = useState<Record<string, string>>({});

  // ─── Dynamic governor / timelock / token contracts ────────
  const [activeGovernor, setActiveGovernor] = useState<ethers.Contract | null>(null);
  const [activeTimelock, setActiveTimelock] = useState<ethers.Contract | null>(null);
  const [activeToken, setActiveToken] = useState<ethers.Contract | null>(null);

  // ─── Governor info ────────────────────────────────────────
  const [govName, setGovName] = useState('');
  const [votingDelay, setVotingDelay] = useState<bigint>(0n);
  const [votingPeriod, setVotingPeriod] = useState<bigint>(0n);
  const [quorumPct, setQuorumPct] = useState<bigint>(0n);
  const [proposalThresholdVal, setProposalThresholdVal] = useState<bigint>(0n);
  const [timelockDelay, setTimelockDelay] = useState<bigint>(0n);

  // ─── KYC verification status ──────────────────────────────
  const [kycVerified, setKycVerified] = useState<boolean | null>(null);

  // ─── Voting power ─────────────────────────────────────────
  const [votingPower, setVotingPower] = useState<bigint>(0n);
  const [delegatee, setDelegatee] = useState('');
  const [tokenBalance, setTokenBalance] = useState<bigint>(0n);

  // ─── Delegation ───────────────────────────────────────────
  const [delegateAddr, setDelegateAddr] = useState('');
  const [delegating, setDelegating] = useState(false);

  // ─── Proposals ────────────────────────────────────────────
  const [proposals, setProposals] = useState<ProposalInfo[]>([]);
  const [expandedProposal, setExpandedProposal] = useState<string | null>(null);

  // ─── New proposal form ────────────────────────────────────
  const [proposalDescription, setProposalDescription] = useState('');
  const [proposalTarget, setProposalTarget] = useState('');
  const [proposing, setProposing] = useState(false);
  const [proposalType, setProposalType] = useState<'signaling' | 'executable'>('signaling');
  const [proposalAction, setProposalAction] = useState('mint');
  const [actionParam1, setActionParam1] = useState('');
  const [actionParam2, setActionParam2] = useState('');

  // ─── Voting ───────────────────────────────────────────────
  const [voting, setVoting] = useState<string | null>(null);

  // ─── Status ───────────────────────────────────────────────
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // ─── Track which tokens have no governance yet ─────────
  const [noGovTokens, setNoGovTokens] = useState<Set<string>>(new Set());
  const [deployingGov, setDeployingGov] = useState(false);

  // ─── Load governed tokens from GovernorFactory + both TokenFactories ──
  const loadGovernanceSuites = useCallback(async () => {
    if (!contracts) return;
    try {
      // 1. Fetch tokens that already have governance
      let suites: GovernanceSuite[] = [];
      try {
        suites = await contracts.governorFactory.allGovernanceSuites();
      } catch { /* factory may be empty */ }

      let allSuites = [...suites];

      // 2. Also include legacy single governor if not already in factory
      try {
        const legacyGovAddr = await contracts.governor.getAddress();
        const legacyToken = await contracts.governor.token();
        const legacyTimelock = await contracts.timelock.getAddress();
        const hasLegacy = !suites.some(
          (s: GovernanceSuite) => s.governor.toLowerCase() === legacyGovAddr.toLowerCase()
        );
        if (hasLegacy && legacyGovAddr !== ethers.ZeroAddress) {
          allSuites = [{ token: legacyToken, governor: legacyGovAddr, timelock: legacyTimelock, deployedAt: 0n }, ...allSuites];
        }
      } catch (e) { console.warn('Legacy governor lookup:', e); }

      // 3. Discover tokens from TokenFactory (EIP-1167) and TokenFactoryV2 (ERC-1967)
      const governedAddrs = new Set(allSuites.map((s) => s.token.toLowerCase()));
      const ungoverned = new Set<string>();

      // EIP-1167 factory
      try {
        const v1Tokens = await contracts.tokenFactory.allTokens();
        for (const t of v1Tokens) {
          const addr = (t.tokenAddress || t[2]).toLowerCase();
          if (t.active !== false && !governedAddrs.has(addr)) {
            allSuites.push({ token: addr, governor: ethers.ZeroAddress, timelock: ethers.ZeroAddress, deployedAt: 0n });
            governedAddrs.add(addr);
            ungoverned.add(addr);
          }
        }
      } catch (e) { console.warn('TokenFactory v1 allTokens:', e); }

      // ERC-1967 factory
      try {
        const v2Tokens = await contracts.tokenFactoryV2.allTokens();
        for (const t of v2Tokens) {
          const addr = (t.proxyAddress || t[2]).toLowerCase();
          if (t.active !== false && !governedAddrs.has(addr) && !ungoverned.has(addr)) {
            allSuites.push({ token: addr, governor: ethers.ZeroAddress, timelock: ethers.ZeroAddress, deployedAt: 0n });
            ungoverned.add(addr);
          }
        }
      } catch (e) { console.warn('TokenFactory v2 allTokens:', e); }

      // 4. Also detect tokens the connected user holds (by balance)
      //    This catches tokens not from any factory but held by this investor
      if (account && allSuites.length === 0) {
        // Last resort — check the default securityToken
        try {
          const bal = await contracts.securityToken.balanceOf(account);
          if (bal > 0n) {
            const tokenAddr = await contracts.securityToken.getAddress();
            if (!governedAddrs.has(tokenAddr.toLowerCase())) {
              allSuites.push({ token: tokenAddr, governor: ethers.ZeroAddress, timelock: ethers.ZeroAddress, deployedAt: 0n });
              ungoverned.add(tokenAddr.toLowerCase());
            }
          }
        } catch { /* ignore */ }
      }

      setNoGovTokens(ungoverned);
      setGovernanceSuites(allSuites);

      // Load token names for display
      const names: Record<string, string> = {};
      for (const suite of allSuites) {
        try {
          const tokenContract = new ethers.Contract(suite.token, SECURITY_TOKEN_ABI, contracts.securityToken.runner);
          const [name, symbol] = await Promise.all([tokenContract.name(), tokenContract.symbol()]);
          names[suite.token.toLowerCase()] = `${name} (${symbol})`;
          names[suite.token] = `${name} (${symbol})`;
        } catch {
          names[suite.token] = suite.token.slice(0, 10) + '…';
        }
      }
      setTokenNames(names);

      // Auto-select first token if none selected
      if (!selectedToken && allSuites.length > 0) {
        setSelectedToken(allSuites[0].token);
      }
    } catch (e) {
      console.error('Failed to load governance suites:', e);
    }
  }, [contracts, account]);

  // ─── Build dynamic contract instances when token selection changes ──
  useEffect(() => {
    if (!contracts || !selectedToken || governanceSuites.length === 0) return;
    const suite = governanceSuites.find((s) => s.token.toLowerCase() === selectedToken.toLowerCase());
    if (!suite) return;

    // Token without governance yet — clear governor/timelock
    if (suite.governor === ethers.ZeroAddress) {
      setActiveGovernor(null);
      setActiveTimelock(null);
      setActiveToken(new ethers.Contract(suite.token, SECURITY_TOKEN_ABI, contracts.securityToken.runner));
      return;
    }

    const runner = contracts.securityToken.runner;
    setActiveGovernor(new ethers.Contract(suite.governor, GOVERNOR_ABI, runner));
    setActiveTimelock(new ethers.Contract(suite.timelock, TIMELOCK_ABI, runner));
    setActiveToken(new ethers.Contract(suite.token, SECURITY_TOKEN_ABI, runner));
  }, [contracts, selectedToken, governanceSuites]);

  // ─── Load governor configuration ─────────────────────────
  const loadGovernorInfo = useCallback(async () => {
    if (!activeGovernor || !activeTimelock) return;
    try {
      const [name, delay, period, qNum, pThresh, tlDelay] = await Promise.all([
        activeGovernor.name(),
        activeGovernor.votingDelay(),
        activeGovernor.votingPeriod(),
        activeGovernor.quorumNumerator(),
        activeGovernor.proposalThreshold(),
        activeTimelock.getMinDelay(),
      ]);
      setGovName(name);
      setVotingDelay(delay);
      setVotingPeriod(period);
      setQuorumPct(qNum);
      setProposalThresholdVal(pThresh);
      setTimelockDelay(tlDelay);
    } catch (e) {
      console.error('Failed to load governor info:', e);
    }
  }, [activeGovernor, activeTimelock]);

  // ─── Load user voting info ────────────────────────────────
  const loadVotingInfo = useCallback(async () => {
    if (!activeToken || !account) return;
    try {
      const [power, del, bal] = await Promise.all([
        activeToken.getVotes(account),
        activeToken.delegates(account),
        activeToken.balanceOf(account),
      ]);
      setVotingPower(power);
      setDelegatee(del);
      setTokenBalance(bal);
      // Check KYC status
      try {
        const verified = await contracts!.identityRegistry.isVerified(account);
        setKycVerified(verified);
      } catch { setKycVerified(null); }
    } catch (e) {
      console.error('Failed to load voting info:', e);
    }
  }, [activeToken, account, contracts]);

  // ─── Load proposals from events ───────────────────────────
  /**
   * Fetch all proposals from a governor contract instance.
   * Extracted so handleFastForward can pass a fresh-provider governor
   * to avoid stale MetaMask / ethers caching after mining.
   */
  const fetchProposals = async (gov: ethers.Contract): Promise<ProposalInfo[]> => {
    const filter = gov.filters.ProposalCreated();
    const events = await gov.queryFilter(filter, 0, 'latest');
    const proposalInfos: ProposalInfo[] = [];

    for (const event of events) {
      const log = event as ethers.EventLog;
      const args = log.args;
      const proposalId = args[0].toString();
      const proposer = args[1];
      const targets = args[2];
      const values = args[3];
      const calldatas = args[5];
      const description = args[8];

      try {
        const [stateNum, snapshot, deadline, votes] = await Promise.all([
          gov.state(proposalId),
          gov.proposalSnapshot(proposalId),
          gov.proposalDeadline(proposalId),
          gov.proposalVotes(proposalId),
        ]);

        proposalInfos.push({
          id: proposalId,
          proposer,
          state: Number(stateNum),
          stateName: PROPOSAL_STATES[Number(stateNum)] || 'Unknown',
          snapshot,
          deadline,
          forVotes: votes[1],
          againstVotes: votes[0],
          abstainVotes: votes[2],
          description,
          targets,
          values,
          calldatas,
        });
      } catch {
        // Skip proposals that can't be queried
      }
    }

    return proposalInfos.reverse(); // newest first
  };

  const loadProposals = useCallback(async () => {
    if (!activeGovernor) return;
    try {
      setProposals(await fetchProposals(activeGovernor));
    } catch (e) {
      console.error('Failed to load proposals:', e);
    }
  }, [activeGovernor]);

  // ─── Load governance suites on mount ──────────────────────
  useEffect(() => {
    if (contracts) {
      loadGovernanceSuites().finally(() => setLoading(false));
    }
  }, [contracts, loadGovernanceSuites]);

  // ─── Reload governor data when active contracts change ────
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([loadGovernorInfo(), loadVotingInfo(), loadProposals()]);
      setLoading(false);
    };
    if (activeGovernor) {
      load();
    } else {
      // No governor for this token — stop loading
      setLoading(false);
    }
  }, [activeGovernor, activeTimelock, activeToken, loadGovernorInfo, loadVotingInfo, loadProposals]);

  // ─── Clear banner on wallet disconnect / account change ───
  useEffect(() => {
    setStatus(null);
  }, [account]);

  // ─── Delegate ─────────────────────────────────────────────
  const handleDelegate = async () => {
    if (!activeToken || !delegateAddr || !account) return;
    setDelegating(true);
    setStatus(null);
    try {
      const raw = delegateAddr.trim().toLowerCase() === 'self' ? account : delegateAddr.trim();
      const addr = ethers.getAddress(raw); // validates checksum / format
      const tx = await activeToken.delegate(addr);
      await tx.wait();
      setStatus({ type: 'success', message: `Delegated voting power to ${addr.slice(0, 10)}...` });
      setDelegateAddr('');
      await loadVotingInfo();
    } catch (e: any) {
      setStatus({ type: 'error', message: decodeGovernanceError(e) });
    } finally {
      setDelegating(false);
    }
  };

  // ─── Create proposal ─────────────────────────────────────
  const handlePropose = async () => {
    if (!activeGovernor || !proposalDescription) return;
    if (proposalType === 'executable' && !roles.isAdmin && !roles.isAgent) return;
    setProposing(true);
    setStatus(null);
    try {
      let target: string;
      let value = 0n;
      let calldata: string;

      if (proposalType === 'executable') {
        const iface = new ethers.Interface(SECURITY_TOKEN_ABI);
        target = selectedToken;

        switch (proposalAction) {
          case 'mint': {
            if (!actionParam1 || !actionParam2) throw new Error('Recipient address and amount are required');
            const to = ethers.getAddress(actionParam1.trim());
            const amount = ethers.parseEther(actionParam2);
            calldata = iface.encodeFunctionData('mint', [to, amount]);
            break;
          }
          case 'burn': {
            if (!actionParam1 || !actionParam2) throw new Error('Address and amount are required');
            const from = ethers.getAddress(actionParam1.trim());
            const amount = ethers.parseEther(actionParam2);
            calldata = iface.encodeFunctionData('burn', [from, amount]);
            break;
          }
          case 'setMaxSupply': {
            if (!actionParam1) throw new Error('Max supply value is required');
            const cap = ethers.parseEther(actionParam1);
            calldata = iface.encodeFunctionData('setMaxSupply', [cap]);
            break;
          }
          case 'setMintThreshold': {
            if (!actionParam1) throw new Error('Threshold value is required');
            const threshold = ethers.parseEther(actionParam1);
            calldata = iface.encodeFunctionData('setMintThreshold', [threshold]);
            break;
          }
          case 'pause': {
            calldata = iface.encodeFunctionData('pause');
            break;
          }
          case 'unpause': {
            calldata = iface.encodeFunctionData('unpause');
            break;
          }
          default:
            throw new Error('Unknown action');
        }
      } else {
        // Signaling proposal: no on-chain action — target the Timelock (which can receive empty calls)
        target = activeTimelock ? await activeTimelock.getAddress() : await activeGovernor!.getAddress();
        calldata = '0x';
        value = 0n;
      }

      const tx = await activeGovernor!.propose(
        [target],
        [value],
        [calldata],
        proposalDescription
      );
      await tx.wait();
      setStatus({ type: 'success', message: 'Proposal created successfully!' });
      setProposalDescription('');
      setProposalTarget('');
      setActionParam1('');
      setActionParam2('');
      await loadProposals();
    } catch (e: any) {
      setStatus({ type: 'error', message: decodeGovernanceError(e) });
    } finally {
      setProposing(false);
    }
  };

  // ─── Cast vote ────────────────────────────────────────────
  const handleVote = async (proposalId: string, support: number) => {
    if (!activeGovernor || !activeToken || !account) return;
    setVoting(proposalId);
    setStatus(null);
    try {
      // Governor checks voting power at the proposal's snapshot block.
      // If the user hasn't delegated at all, block the vote to avoid a
      // silent 0-weight cast.  If they *have* delegated (currentVotes > 0)
      // let the vote proceed — on dev chains the snapshot may lag behind.
      const proposal = proposals.find((p) => p.id === proposalId);
      if (proposal) {
        const weightAtSnapshot: bigint = await activeToken.getPastVotes(account, proposal.snapshot);
        if (weightAtSnapshot === 0n) {
          const currentVotes: bigint = await activeToken.getVotes(account);
          if (currentVotes === 0n) {
            // Never delegated — block
            setStatus({
              type: 'error',
              message: 'You have zero voting power. Delegate your tokens to yourself first (enter "self" above and click Delegate), then try voting again.',
            });
            setVoting(null);
            return;
          }
          // Delegated but after snapshot — warn, don't block
        }
      }

      const tx = await activeGovernor.castVote(proposalId, support);
      await tx.wait();
      const voteLabel = support === 1 ? 'For' : support === 0 ? 'Against' : 'Abstain';
      setStatus({ type: 'success', message: `Vote cast: ${voteLabel}` });
      // Use a fresh provider to bypass ethers / MetaMask caching so
      // updated vote tallies are returned immediately.
      const freshProvider = new ethers.JsonRpcProvider(rpcUrlForBrowser());
      const freshGov = new ethers.Contract(
        activeGovernor.target as string, GOVERNOR_ABI, freshProvider);
      try {
        setProposals(await fetchProposals(freshGov));
      } finally {
        freshProvider.destroy();
      }
    } catch (e: any) {
      setStatus({ type: 'error', message: decodeGovernanceError(e) });
    } finally {
      setVoting(null);
    }
  };

  // ─── Queue proposal ───────────────────────────────────────
  const handleQueue = async (proposal: ProposalInfo) => {
    if (!activeGovernor) return;
    setStatus(null);
    try {
      const descHash = ethers.keccak256(ethers.toUtf8Bytes(proposal.description));
      const tx = await activeGovernor.queue(
        [...proposal.targets],
        [...proposal.values],
        [...proposal.calldatas],
        descHash
      );
      await tx.wait();
      setStatus({ type: 'success', message: 'Proposal queued in Timelock!' });
      await loadProposals();
    } catch (e: any) {
      setStatus({ type: 'error', message: decodeGovernanceError(e) });
    }
  };

  // ─── Execute proposal ─────────────────────────────────────
  const handleExecute = async (proposal: ProposalInfo) => {
    if (!activeGovernor) return;
    setStatus(null);
    try {
      const descHash = ethers.keccak256(ethers.toUtf8Bytes(proposal.description));
      const tx = await activeGovernor.execute(
        [...proposal.targets],
        [...proposal.values],
        [...proposal.calldatas],
        descHash
      );
      await tx.wait();
      setStatus({ type: 'success', message: 'Proposal executed!' });
      await loadProposals();
    } catch (e: any) {
      setStatus({ type: 'error', message: decodeGovernanceError(e) });
    }
  };

  // ─── Fast-forward blocks (dev only – Hardhat / Anvil) ──────
  const [fastForwarding, setFastForwarding] = useState(false);

  /**
   * Send a raw JSON-RPC call directly to Anvil / Hardhat, bypassing
   * both MetaMask and the ethers provider cache.
   */
  const rawRpc = async (method: string, params: any[] = []) => {
    const rpcUrl = rpcUrlForBrowser();
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    return json.result;
  };

  const handleFastForward = async (blocks: number, label: string, alsoAdvanceTime?: number, targetBlock?: bigint) => {
    if (!activeGovernor) return;
    setFastForwarding(true);
    setStatus(null);
    try {
      // If a target block (snapshot / deadline) is provided, compute the
      // exact number of blocks we still need instead of the caller's guess.
      let toMine = blocks;
      if (targetBlock !== undefined) {
        const freshReader = new ethers.JsonRpcProvider(rpcUrlForBrowser());
        const freshGovReader = new ethers.Contract(
          activeGovernor.target as string, GOVERNOR_ABI, freshReader);
        const currentClock = BigInt(await freshGovReader.clock());
        freshReader.destroy();
        const remaining = Number(targetBlock - currentClock) + 1; // +1 to pass it
        toMine = remaining > 0 ? remaining : 1;
      }

      // 1. Mine / time-travel via raw fetch so the RPC bypasses MetaMask
      //    and ethers' internal request queue entirely.
      //    Pass interval=0 so Anvil doesn't generate unique timestamps per
      //    block, making large batch mining significantly faster.
      if (alsoAdvanceTime) {
        await rawRpc('evm_increaseTime', ['0x' + alsoAdvanceTime.toString(16)]);
      }
      await rawRpc('hardhat_mine', ['0x' + toMine.toString(16), '0x0']);

      setStatus({ type: 'success', message: `⏩ Mined ${toMine.toLocaleString()} blocks (${label}). Refreshing…` });

      // 2. Query updated proposal state through a FRESH provider so we
      //    avoid any stale cache in the existing provider / MetaMask.
      const freshProvider = new ethers.JsonRpcProvider(rpcUrlForBrowser());
      const govAddr = activeGovernor.target as string;
      const freshGov = new ethers.Contract(govAddr, GOVERNOR_ABI, freshProvider);
      try {
        setProposals(await fetchProposals(freshGov));
      } finally {
        freshProvider.destroy();
      }
    } catch (e: any) {
      setStatus({ type: 'error', message: 'Fast-forward failed: ' + (e.message || e) });
    } finally {
      setFastForwarding(false);
    }
  };

  if (loading) {
    return (
      <div className="glass-card p-6 md:p-12 text-center">
        <Loader2 size={48} className="mx-auto mb-4 text-purple-400 animate-spin" />
        <h2 className="text-xl md:text-2xl font-bold text-white mb-2">Governance</h2>
        <p className="text-gray-400">Loading governance data…</p>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="glass-card p-6 md:p-12 text-center">
        <Shield size={48} className="mx-auto mb-4 text-purple-400" />
        <h2 className="text-xl md:text-2xl font-bold text-white mb-2">Governance</h2>
        <p className="text-gray-400">Connect your wallet to participate in on-chain governance.</p>
      </div>
    );
  }

  // ─── Deploy Governor + Timelock for a token without governance ──
  const handleDeployGovernance = async () => {
    if (!contracts || !selectedToken || !roles.isAdmin) return;
    setDeployingGov(true);
    setStatus(null);
    try {
      const signer = contracts.securityToken.runner as ethers.Signer;
      const adminAddr = await signer.getAddress();
      const tokenAddr = ethers.getAddress(selectedToken); // checksummed

      // Fetch compiled artifacts from Vite dev server
      const [timelockArtifact, governorArtifact] = await Promise.all([
        fetch('/artifacts/HKSTPTimelock.json').then((r) => r.json()),
        fetch('/artifacts/HKSTPGovernor.json').then((r) => r.json()),
      ]);

      // Get current nonce to manage sequential deploys
      let nonce = await signer.getNonce();

      // 1. Deploy HKSTPTimelock(minDelay, proposers[], executors[], admin)
      const timelockFactory = new ethers.ContractFactory(
        timelockArtifact.abi,
        timelockArtifact.bytecode,
        signer
      );
      setStatus({ type: 'info', message: 'Deploying Timelock… (1/4)' });
      const timelock = await timelockFactory.deploy(
        1,                                  // minDelay = 1s (dev mode)
        [],                                 // proposers — will be granted to Governor after
        [ethers.ZeroAddress],               // executors — anyone can execute
        adminAddr,                          // admin for bootstrapping
        { nonce: nonce++ }
      );
      await timelock.waitForDeployment();
      const timelockAddr = await timelock.getAddress();

      // 2. Deploy HKSTPGovernor(token, timelock, identityRegistry, votingDelay, votingPeriod, proposalThreshold, quorumPercent)
      const identityRegistryAddr = CONTRACT_ADDRESSES.identityRegistry;
      const governorFactory = new ethers.ContractFactory(
        governorArtifact.abi,
        governorArtifact.bytecode,
        signer
      );
      setStatus({ type: 'info', message: 'Deploying Governor… (2/4)' });
      const governor = await governorFactory.deploy(
        tokenAddr,                          // token (IVotes) — checksummed
        timelockAddr,                       // timelock
        identityRegistryAddr,               // identityRegistry
        10,                                 // votingDelay = 10 blocks (dev); prod: 14400
        20,                                 // votingPeriod = 20 blocks (dev); prod: 50400
        ethers.parseEther('10000'),         // proposalThreshold = 1% of 1M supply
        10,                                 // quorum = 10% of supply
        { nonce: nonce++ }
      );
      await governor.waitForDeployment();
      const governorAddr = await governor.getAddress();

      // 3. Grant PROPOSER_ROLE + CANCELLER_ROLE to the Governor on the Timelock
      const timelockContract = new ethers.Contract(timelockAddr, timelockArtifact.abi, signer);
      const PROPOSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes('PROPOSER_ROLE'));
      const CANCELLER_ROLE = ethers.keccak256(ethers.toUtf8Bytes('CANCELLER_ROLE'));
      setStatus({ type: 'info', message: 'Granting Timelock roles… (3/5)' });
      await (await timelockContract.grantRole(PROPOSER_ROLE, governorAddr, { nonce: nonce++ })).wait();
      await (await timelockContract.grantRole(CANCELLER_ROLE, governorAddr, { nonce: nonce++ })).wait();

      // 4. Grant TIMELOCK_MINTER_ROLE to the Timelock on the security token
      //    so governance-approved large mints (above mintThreshold) can execute.
      const tokenContract = new ethers.Contract(tokenAddr, SECURITY_TOKEN_ABI, signer);
      const TIMELOCK_MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes('TIMELOCK_MINTER_ROLE'));
      setStatus({ type: 'info', message: 'Granting TIMELOCK_MINTER_ROLE on token… (4/5)' });
      await (await tokenContract.grantRole(TIMELOCK_MINTER_ROLE, timelockAddr, { nonce: nonce++ })).wait();

      // 5. Register in GovernorFactory
      setStatus({ type: 'info', message: 'Registering in GovernorFactory… (5/5)' });
      const tx = await contracts.governorFactory.registerGovernance(
        tokenAddr,
        governorAddr,
        timelockAddr,
        { nonce: nonce++ }
      );
      await tx.wait();

      setStatus({ type: 'success', message: `✓ Governance deployed! Governor: ${governorAddr.slice(0, 10)}… Timelock: ${timelockAddr.slice(0, 10)}…` });
      setNoGovTokens((prev) => {
        const next = new Set(prev);
        next.delete(selectedToken.toLowerCase());
        return next;
      });
      await loadGovernanceSuites();
    } catch (e: any) {
      console.error('Deploy governance failed:', e);
      setStatus({ type: 'error', message: decodeGovernanceError(e) });
    } finally {
      setDeployingGov(false);
    }
  };

  const refreshAll = async () => {
    setLoading(true);
    await Promise.all([loadGovernorInfo(), loadVotingInfo(), loadProposals()]);
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xl md:text-2xl font-bold text-white">Governance</h2>
          <p className="text-gray-400">On-chain voting with snapshot-based governance ({govName}).</p>
        </div>
        <button onClick={refreshAll} className="p-2 hover:bg-white/10 rounded-lg transition-colors" title="Refresh">
          <RefreshCw size={18} className="text-gray-400" />
        </button>
      </header>

      {/* Token Selector — show even if only ungoverned tokens */}
      {governanceSuites.length >= 1 && (
        <div className="glass-card p-4">
          <label className="block text-sm text-gray-400 mb-2 font-medium">Select Token for Governance</label>
          <select
            value={selectedToken}
            onChange={(e) => setSelectedToken(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm appearance-none cursor-pointer"
          >
            {governanceSuites.map((suite) => (
              <option key={suite.token} value={suite.token} className="bg-gray-900">
                {tokenNames[suite.token] || tokenNames[suite.token.toLowerCase()] || suite.token.slice(0, 10) + '…'}
                {noGovTokens.has(suite.token.toLowerCase()) ? ' ⚠ No governance' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Deploy Governance banner for tokens without governor */}
      {selectedToken && noGovTokens.has(selectedToken.toLowerCase()) && (
        <div className="glass-card p-6 border border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle size={24} className="text-amber-400" />
            <h3 className="font-bold text-white text-lg">No Governance Suite</h3>
          </div>
          <p className="text-gray-400 text-sm mb-4">
            This token (<span className="font-mono text-amber-300">{selectedToken.slice(0, 10)}…{selectedToken.slice(-4)}</span>)
            does not have a Governor + Timelock deployed yet. Deploy one to enable on-chain voting.
          </p>
          {roles.isAdmin ? (
            <button
              onClick={handleDeployGovernance}
              disabled={deployingGov}
              className="bg-gradient-to-r from-amber-500 to-orange-600 text-white py-2.5 px-6 rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-amber-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {deployingGov ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />}
              {deployingGov ? 'Deploying…' : 'Deploy Governor + Timelock'}
            </button>
          ) : (
            <p className="text-xs text-gray-500">Only the platform admin can deploy governance.</p>
          )}
        </div>
      )}

      {/* Status banner */}
      {status && (
        <div
          className={`glass-card px-4 py-3 text-sm font-medium ${
            status.type === 'success' ? 'text-emerald-400' : status.type === 'error' ? 'text-red-400' : 'text-purple-300'
          }`}
        >
          {status.type === 'success' ? '✓ ' : status.type === 'error' ? '✗ ' : ''}{status.message}
        </div>
      )}

      {/* Governor Config Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={<Shield size={20} />} label="Governor" value={govName || '—'} accent="purple" />
        <StatCard icon={<Clock size={20} />} label="Voting Delay" value={`${votingDelay.toString()} blocks`} accent="cyan" />
        <StatCard icon={<Timer size={20} />} label="Voting Period" value={`${votingPeriod.toString()} blocks`} accent="amber" />
        <StatCard icon={<Users size={20} />} label="Quorum" value={`${quorumPct.toString()}% of supply`} accent="emerald" />
        <StatCard icon={<Vote size={20} />} label="Proposal Threshold" value={`${formatTokenAmount(proposalThresholdVal)} tokens`} accent="purple" />
        <StatCard icon={<Shield size={20} />} label="Identity-Locked" value={kycVerified === null ? 'Checking…' : kycVerified ? '✓ KYC Verified' : '✗ KYC Required'} accent={kycVerified ? 'emerald' : 'red'} />
      </div>

      {/* Voting Power + Delegation */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Your Voting Power */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Vote size={20} className="text-purple-400" />
            <h3 className="font-bold text-white">Your Voting Power</h3>
          </div>
          <dl className="space-y-3">
            <InfoRow label="Token Balance" value={formatTokenAmount(tokenBalance)} />
            <InfoRow label="Voting Power" value={formatTokenAmount(votingPower)} highlight />
            <InfoRow
              label="Delegated To"
              value={
                delegatee === ethers.ZeroAddress
                  ? '(none — delegate to activate!)'
                  : delegatee === account
                  ? '(self)'
                  : `${delegatee.slice(0, 8)}…${delegatee.slice(-6)}`
              }
            />
          </dl>
          {delegatee === ethers.ZeroAddress && tokenBalance > 0n && (
            <div className="mt-4 glass-card px-4 py-3 text-sm text-amber-400 flex items-center gap-2">
              <AlertTriangle size={16} />
              You must self-delegate to activate voting power!
            </div>
          )}
        </div>

        {/* Delegation */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Users size={20} className="text-purple-400" />
            <h3 className="font-bold text-white">Delegate Votes</h3>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Delegate to address</label>
              <input
                type="text"
                value={delegateAddr}
                onChange={(e) => setDelegateAddr(e.target.value)}
                placeholder="0x… or 'self'"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setDelegateAddr('self')}
                className="px-4 py-2.5 text-sm bg-white/5 border border-white/10 text-gray-300 rounded-xl hover:bg-white/10 transition-colors"
              >
                Self
              </button>
              <button
                onClick={handleDelegate}
                disabled={delegating || !delegateAddr || !account || !activeToken}
                className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 text-white py-2.5 px-4 rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-purple-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {delegating && <Loader2 size={16} className="animate-spin" />}
                Delegate
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Create Proposal */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Plus size={20} className="text-purple-400" />
          <h3 className="font-bold text-white">Create Proposal</h3>
        </div>
        <div className="space-y-3">
          {/* Proposal Type */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Proposal Type</label>
            <div className="flex gap-2">
              <button
                onClick={() => setProposalType('signaling')}
                className={`px-4 py-2 text-sm rounded-xl border transition-colors ${
                  proposalType === 'signaling'
                    ? 'bg-purple-600/30 border-purple-500/50 text-purple-300'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                }`}
              >
                Signaling
              </button>
              {(roles.isAdmin || roles.isAgent) && (
                <button
                  onClick={() => setProposalType('executable')}
                  className={`px-4 py-2 text-sm rounded-xl border transition-colors ${
                    proposalType === 'executable'
                      ? 'bg-purple-600/30 border-purple-500/50 text-purple-300'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  Executable Action
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Description</label>
            <textarea
              value={proposalDescription}
              onChange={(e) => setProposalDescription(e.target.value)}
              placeholder="Describe the governance proposal…"
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm resize-none"
            />
          </div>

          {proposalType === 'signaling' && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Target address (optional)</label>
              <input
                type="text"
                value={proposalTarget}
                onChange={(e) => setProposalTarget(e.target.value)}
                placeholder="0x… (leave empty for signaling proposal)"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
              />
            </div>
          )}

          {proposalType === 'executable' && (
            <>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Action</label>
                <select
                  value={proposalAction}
                  onChange={(e) => { setProposalAction(e.target.value); setActionParam1(''); setActionParam2(''); }}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm appearance-none cursor-pointer"
                >
                  <option value="mint" className="bg-gray-900">Mint tokens (large mint via Timelock)</option>
                  <option value="burn" className="bg-gray-900">Burn tokens</option>
                  <option value="setMaxSupply" className="bg-gray-900">Set max supply cap</option>
                  <option value="setMintThreshold" className="bg-gray-900">Set mint threshold</option>
                  <option value="pause" className="bg-gray-900">Pause token transfers</option>
                  <option value="unpause" className="bg-gray-900">Unpause token transfers</option>
                </select>
              </div>

              <div className="text-xs text-gray-500 bg-white/5 rounded-xl px-4 py-2">
                Target: <span className="font-mono text-gray-400">{selectedToken.slice(0, 10)}…{selectedToken.slice(-4)}</span>
                <span className="ml-2">({tokenNames[selectedToken] || 'Security Token'})</span>
              </div>

              {(proposalAction === 'mint' || proposalAction === 'burn') && (
                <>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      {proposalAction === 'mint' ? 'Recipient address' : 'Address to burn from'}
                    </label>
                    <input
                      type="text"
                      value={actionParam1}
                      onChange={(e) => setActionParam1(e.target.value)}
                      placeholder="0x…"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Amount (tokens)</label>
                    <input
                      type="text"
                      value={actionParam2}
                      onChange={(e) => setActionParam2(e.target.value)}
                      placeholder="e.g. 500000"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
                    />
                  </div>
                </>
              )}

              {(proposalAction === 'setMaxSupply' || proposalAction === 'setMintThreshold') && (
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    {proposalAction === 'setMaxSupply' ? 'Max supply (tokens, 0 = unlimited)' : 'Mint threshold (tokens, 0 = disabled)'}
                  </label>
                  <input
                    type="text"
                    value={actionParam1}
                    onChange={(e) => setActionParam1(e.target.value)}
                    placeholder="e.g. 1000000"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
                  />
                </div>
              )}
            </>
          )}

          <button
            onClick={handlePropose}
            disabled={proposing || !proposalDescription}
            className="bg-gradient-to-r from-purple-600 to-pink-600 text-white py-2.5 px-6 rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-purple-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {proposing && <Loader2 size={16} className="animate-spin" />}
            Submit Proposal
          </button>
        </div>
      </div>

      {/* Proposals List */}
      <div className="glass-card overflow-hidden">
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={20} className="text-purple-400" />
            <h3 className="font-bold text-white">Proposals ({proposals.length})</h3>
          </div>
        </div>
        {proposals.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No proposals yet.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {proposals.map((p) => {
              const totalVotes = p.forVotes + p.againstVotes + p.abstainVotes;
              const forPct = totalVotes > 0n ? Number((p.forVotes * 100n) / totalVotes) : 0;
              const againstPct = totalVotes > 0n ? Number((p.againstVotes * 100n) / totalVotes) : 0;
              const abstainPct = totalVotes > 0n ? Number((p.abstainVotes * 100n) / totalVotes) : 0;
              const isExpanded = expandedProposal === p.id;

              return (
                <div key={p.id} className="p-6 hover:bg-white/5 transition-colors">
                  {/* Header row */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${STATE_COLORS[p.state] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
                        {p.stateName}
                      </span>
                      <span className="text-sm text-gray-500 font-mono">
                        #{p.id.slice(0, 12)}…
                      </span>
                    </div>
                    <button
                      onClick={() => setExpandedProposal(isExpanded ? null : p.id)}
                      className="p-1 hover:bg-white/10 rounded-lg transition-colors text-gray-400"
                    >
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                  </div>

                  {/* Description */}
                  <p className="text-white font-medium mb-3 text-sm">{p.description}</p>

                  {/* Vote bars */}
                  <div className="space-y-2 mb-4">
                    <VoteBar label="For" pct={forPct} amount={formatTokenAmount(p.forVotes)} color="emerald" />
                    <VoteBar label="Against" pct={againstPct} amount={formatTokenAmount(p.againstVotes)} color="red" />
                    <VoteBar label="Abstain" pct={abstainPct} amount={formatTokenAmount(p.abstainVotes)} color="gray" />
                  </div>

                  {/* Action buttons based on state */}
                  <div className="flex gap-2 flex-wrap">
                    {p.state === 1 && ( /* Active */
                      <>
                        <button
                          onClick={() => handleVote(p.id, 1)}
                          disabled={voting === p.id}
                          className="text-xs bg-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-lg hover:bg-emerald-500/30 transition-colors border border-emerald-500/20 flex items-center gap-1"
                        >
                          {voting === p.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                          For
                        </button>
                        <button
                          onClick={() => handleVote(p.id, 0)}
                          disabled={voting === p.id}
                          className="text-xs bg-red-500/20 text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/30 transition-colors border border-red-500/20 flex items-center gap-1"
                        >
                          {voting === p.id ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                          Against
                        </button>
                        <button
                          onClick={() => handleVote(p.id, 2)}
                          disabled={voting === p.id}
                          className="text-xs bg-gray-500/20 text-gray-400 px-3 py-1.5 rounded-lg hover:bg-gray-500/30 transition-colors border border-gray-500/20 flex items-center gap-1"
                        >
                          {voting === p.id ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
                          Abstain
                        </button>
                      </>
                    )}
                    {p.state === 4 && ( /* Succeeded */
                      <button
                        onClick={() => handleQueue(p)}
                        className="text-xs bg-purple-500/20 text-purple-400 px-3 py-1.5 rounded-lg hover:bg-purple-500/30 transition-colors border border-purple-500/20 flex items-center gap-1"
                      >
                        <Clock size={12} />
                        Queue for Execution
                      </button>
                    )}
                    {p.state === 5 && ( /* Queued */
                      <>
                        <button
                          onClick={() => handleExecute(p)}
                          className="text-xs bg-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-lg hover:bg-emerald-500/30 transition-colors border border-emerald-500/20 flex items-center gap-1"
                        >
                          <Play size={12} />
                          Execute
                        </button>
                        <button
                          onClick={() => handleFastForward(1, 'skip timelock delay', 60)}
                          disabled={fastForwarding}
                          className="text-xs bg-orange-500/20 text-orange-400 px-3 py-1.5 rounded-lg hover:bg-orange-500/30 transition-colors border border-orange-500/20 flex items-center gap-1"
                        >
                          {fastForwarding ? <Loader2 size={12} className="animate-spin" /> : <Timer size={12} />}
                          ⏩ Skip Timelock
                        </button>
                      </>
                    )}
                    {/* Dev: fast-forward blocks for Pending / Active proposals */}
                    {p.state === 0 && ( /* Pending — skip voting delay */
                      <button
                        onClick={() => handleFastForward(50, 'skip voting delay', undefined, p.snapshot)}
                        disabled={fastForwarding}
                        className="text-xs bg-orange-500/20 text-orange-400 px-3 py-1.5 rounded-lg hover:bg-orange-500/30 transition-colors border border-orange-500/20 flex items-center gap-1"
                      >
                        {fastForwarding ? <Loader2 size={12} className="animate-spin" /> : <Timer size={12} />}
                        ⏩ Skip Voting Delay
                      </button>
                    )}
                    {p.state === 1 && ( /* Active — skip to deadline */
                      <button
                        onClick={() => handleFastForward(50, 'skip voting period', undefined, p.deadline)}
                        disabled={fastForwarding}
                        className="text-xs bg-orange-500/20 text-orange-400 px-3 py-1.5 rounded-lg hover:bg-orange-500/30 transition-colors border border-orange-500/20 flex items-center gap-1"
                      >
                        {fastForwarding ? <Loader2 size={12} className="animate-spin" /> : <Timer size={12} />}
                        ⏩ Skip Voting Period
                      </button>
                    )}
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-white/10 space-y-2">
                      <DetailRow label="Proposer" value={p.proposer} mono />
                      <DetailRow label="Snapshot Block" value={p.snapshot.toString()} />
                      <DetailRow label="Deadline Block" value={p.deadline.toString()} />
                      <DetailRow label="Target(s)" value={p.targets.join(', ')} mono />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Timelock Configuration */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Timer size={20} className="text-purple-400" />
          <h3 className="font-bold text-white">Timelock Configuration</h3>
        </div>
        <dl className="space-y-3">
          <InfoRow label="Timelock Delay" value={`${timelockDelay.toString()}s (${(Number(timelockDelay) / 3600).toFixed(1)}h)`} />
          <InfoRow label="Proposal Threshold" value={`${formatTokenAmount(proposalThresholdVal)} tokens (1%)`} />
          <InfoRow label="Identity Requirement" value="KYC verified (live check at vote time)" />
          <InfoRow label="Timelock Address" value={activeTimelock?.target?.toString() || '—'} mono />
          <InfoRow label="Governor Address" value={activeGovernor?.target?.toString() || '—'} mono />
        </dl>
      </div>
    </div>
  );
};

// ── Helper Components ──

const accentColors: Record<string, string> = {
  purple: 'text-purple-400',
  cyan: 'text-cyan-400',
  amber: 'text-amber-400',
  emerald: 'text-emerald-400',
  red: 'text-red-400',
};

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}> = ({ icon, label, value, accent }) => (
  <div className="glass-card p-6 hover:border-purple-500/30 transition-colors">
    <div className="flex items-center gap-2 mb-2">
      <span className={accentColors[accent] || 'text-gray-400'}>{icon}</span>
      <span className="text-sm text-gray-400 font-medium">{label}</span>
    </div>
    <p className="text-2xl font-bold text-white">{value}</p>
  </div>
);

const InfoRow: React.FC<{ label: string; value: string; highlight?: boolean; mono?: boolean }> = ({ label, value, highlight, mono }) => (
  <div className="flex justify-between items-center">
    <dt className="text-sm text-gray-400">{label}</dt>
    <dd className={`text-sm font-medium ${highlight ? 'text-purple-400' : 'text-white'} ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
  </div>
);

const DetailRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="flex justify-between items-start gap-4">
    <span className="text-xs text-gray-500 shrink-0">{label}</span>
    <span className={`text-xs text-gray-300 text-right break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
  </div>
);

const barColors: Record<string, { bg: string; fill: string }> = {
  emerald: { bg: 'bg-emerald-500/10', fill: 'bg-emerald-500' },
  red: { bg: 'bg-red-500/10', fill: 'bg-red-500' },
  gray: { bg: 'bg-gray-500/10', fill: 'bg-gray-500' },
};

const VoteBar: React.FC<{ label: string; pct: number; amount: string; color: string }> = ({ label, pct, amount, color }) => {
  const colors = barColors[color] || barColors.gray;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`w-14 text-xs ${color === 'emerald' ? 'text-emerald-400' : color === 'red' ? 'text-red-400' : 'text-gray-400'}`}>{label}</span>
      <div className={`flex-1 ${colors.bg} rounded-full h-2.5`}>
        <div className={`${colors.fill} h-2.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-28 text-right text-xs text-gray-500">
        {amount} ({pct}%)
      </span>
    </div>
  );
};

export default Governance;
