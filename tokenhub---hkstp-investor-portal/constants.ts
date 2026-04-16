import { Startup, Order, PortfolioItem, Transaction, Ipo, ListedIpo } from './types';

export const MOCK_STARTUPS: Startup[] = [
  {
    id: '1',
    name: 'BioGenetics HK',
    ticker: 'BGHK',
    industry: 'Biotech',
    description: 'Advanced gene editing solutions for sustainable agriculture.',
    valuation: 50000000,
    sharePrice: 12.50,
    change24h: 2.4,
    logoUrl: 'https://picsum.photos/64/64?random=1'
  },
  {
    id: '2',
    name: 'RoboPort Logistics',
    ticker: 'RPL',
    industry: 'Robotics',
    description: 'Autonomous drone delivery network for the Greater Bay Area.',
    valuation: 120000000,
    sharePrice: 45.20,
    change24h: -1.2,
    logoUrl: 'https://picsum.photos/64/64?random=2'
  },
  {
    id: '3',
    name: 'GreenCity Energy',
    ticker: 'GCEN',
    industry: 'CleanTech',
    description: 'Next-gen solar storage films for high-density urban environments.',
    valuation: 35000000,
    sharePrice: 8.75,
    change24h: 5.1,
    logoUrl: 'https://picsum.photos/64/64?random=3'
  },
  {
    id: '4',
    name: 'FinSecure AI',
    ticker: 'FSAI',
    industry: 'Fintech',
    description: 'AI-driven fraud detection for decentralized finance protocols.',
    valuation: 80000000,
    sharePrice: 22.10,
    change24h: 0.8,
    logoUrl: 'https://picsum.photos/64/64?random=4'
  }
];

export const MOCK_ORDERS: Order[] = [
  { id: '101', type: 'SELL', price: 12.55, amount: 500, total: 6275, timestamp: '10:00:01' },
  { id: '102', type: 'SELL', price: 12.52, amount: 1200, total: 15024, timestamp: '10:00:05' },
  { id: '103', type: 'SELL', price: 12.50, amount: 300, total: 3750, timestamp: '10:01:20' },
  { id: '104', type: 'BUY', price: 12.48, amount: 800, total: 9984, timestamp: '10:02:15' },
  { id: '105', type: 'BUY', price: 12.45, amount: 2000, total: 24900, timestamp: '10:03:00' },
];

export const MOCK_PORTFOLIO: PortfolioItem[] = [
  { assetId: '2', ticker: 'RPL', amount: 1000, avgPrice: 40.00, currentPrice: 45.20 },
  { assetId: '3', ticker: 'GCEN', amount: 2500, avgPrice: 7.50, currentPrice: 8.75 },
];

export const MOCK_TRANSACTIONS: Transaction[] = [
  { id: 'tx1', type: 'DEPOSIT', asset: 'HKD', amount: 50000, status: 'COMPLETED', date: '2023-10-25' },
  { id: 'tx2', type: 'TRADE_BUY', asset: 'RPL', amount: 40000, status: 'COMPLETED', date: '2023-10-26' },
  { id: 'tx3', type: 'TRADE_BUY', asset: 'GCEN', amount: 18750, status: 'COMPLETED', date: '2023-10-27' },
];

export const MOCK_IPOS: Ipo[] = [
  {
    id: 'ipo1',
    name: 'NanoTech Materials',
    symbol: 'NANO',
    logo: '⚡',
    sector: 'Materials Science',
    price: 1500,
    minInvestment: 1000,
    targetRaise: 4500000,
    currentRaise: 0,
    startDate: '2025-12-01',
    endDate: '2025-12-15',
    status: 'upcoming',
    description: 'Revolutionary nanomaterial solutions for next-generation electronics and sustainable energy applications.',
    highlights: ['Pre-revenue: HK$ 2M', 'Team: 15 PhDs', 'Patents: 8 filed'],
    investors: 0
  },
  {
    id: 'ipo2',
    name: 'AgriTech Solutions',
    symbol: 'AGRI',
    logo: '🌾',
    sector: 'AgriTech',
    price: 800,
    minInvestment: 800,
    targetRaise: 4000000,
    currentRaise: 2800000,
    startDate: '2025-11-20',
    endDate: '2025-12-05',
    status: 'live',
    description: 'Smart farming platform using AI and IoT for crop optimization, helping farmers increase yields by 40%.',
    highlights: ['Revenue: HK$ 5M', 'Users: 2,000+ farms', 'Growth: 300% YoY'],
    investors: 456
  },
  {
    id: 'ipo3',
    name: 'CyberSec Pro',
    symbol: 'CSEC',
    logo: '🛡️',
    sector: 'Cybersecurity',
    price: 2000,
    minInvestment: 2000,
    targetRaise: 5000000,
    currentRaise: 4200000,
    startDate: '2025-11-15',
    endDate: '2025-11-30',
    status: 'live',
    description: 'Enterprise-grade cybersecurity solutions powered by machine learning, protecting 50+ major corporations.',
    highlights: ['Clients: 50+ enterprises', 'ARR: HK$ 8M', 'Backed by top VCs'],
    investors: 234
  }
];

export const MOCK_LISTED_IPOS: ListedIpo[] = [
  { id: 'listed1', name: 'AI Tech Solutions', symbol: 'AITS', logo: '🤖', sector: 'AI', ipoPrice: 1000, currentPrice: 1180, change: 18.0, listingDate: '2025-06-15', raised: 10000000 },
  { id: 'listed2', name: 'BioMed Innovations', symbol: 'BMED', logo: '🧬', sector: 'BioTech', ipoPrice: 2000, currentPrice: 2200, change: 10.0, listingDate: '2025-08-20', raised: 15000000 },
  { id: 'listed3', name: 'Green Energy Labs', symbol: 'GENL', logo: '🌱', sector: 'CleanTech', ipoPrice: 900, currentPrice: 850, change: -5.6, listingDate: '2025-09-10', raised: 8000000 }
];