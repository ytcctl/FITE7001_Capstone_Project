export enum KycStatus {
  NOT_STARTED = 'NOT_STARTED',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

export interface User {
  id: string;
  name: string;
  email: string;
  kycStatus: KycStatus;
  walletAddress?: string;
  cashBalance: number; // HKD Tokenized
  portfolioValue: number;
}

export interface Startup {
  id: string;
  name: string;
  ticker: string;
  industry: string;
  description: string;
  valuation: number;
  sharePrice: number;
  change24h: number;
  logoUrl: string;
}

export interface Order {
  id: string;
  type: 'BUY' | 'SELL';
  price: number;
  amount: number;
  total: number;
  timestamp: string;
}

export interface Transaction {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE_BUY' | 'TRADE_SELL';
  asset: string;
  amount: number;
  status: 'COMPLETED' | 'PENDING' | 'FAILED';
  date: string;
}

export interface PortfolioItem {
  assetId: string;
  ticker: string;
  amount: number;
  avgPrice: number;
  currentPrice: number;
}

export interface Ipo {
  id: string;
  name: string;
  symbol: string;
  logo: string;
  sector: string;
  price: number;
  minInvestment: number;
  targetRaise: number;
  currentRaise: number;
  startDate: string;
  endDate: string;
  status: 'upcoming' | 'live' | 'ended';
  description: string;
  highlights: string[];
  investors: number;
}

export interface ListedIpo {
  id: string;
  name: string;
  symbol: string;
  logo: string;
  sector: string;
  ipoPrice: number;
  currentPrice: number;
  change: number;
  listingDate: string;
  raised: number;
}