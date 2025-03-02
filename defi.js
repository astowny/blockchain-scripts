// multi-chain-liquidity-scanner.js
const { ethers } = require('ethers');
const axios = require('axios');
const NodeCache = require('node-cache');
require('dotenv').config();

// Configuration du système de logging
let logLevel = process.env.LOG_LEVEL || 'info';
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

// Chaînes supportées avec leurs identifiants
const SUPPORTED_CHAINS = {
    1: 'ETHEREUM',
    137: 'POLYGON',
    56: 'BINANCE_SMART_CHAIN',
    43114: 'AVALANCHE',
    42161: 'ARBITRUM',
    10: 'OPTIMISM',
    0: 'BITCOIN', // Pour THORChain et Maya
    // Cosmos Ecosystem
    'cosmos': 'COSMOS_HUB',
    'osmosis': 'OSMOSIS',
    'juno': 'JUNO',
    'thor': 'THORCHAIN',
    'maya': 'MAYACHAIN',
    'evmos': 'EVMOS',
    'injective': 'INJECTIVE'
};

// Cache pour stocker les résultats des requêtes avec une durée de vie limitée
const defaultCacheTTL = parseInt(process.env.CACHE_TTL) || 300; // 5 minutes par défaut
const cache = new NodeCache({ stdTTL: defaultCacheTTL });

// Configuration des RPC URLs avec fallbacks
const RPC_URLS = {
    1: [
        process.env.ETH_RPC_1 || 'https://eth-mainnet.g.alchemy.com/v2/your-api-key',
        process.env.ETH_RPC_2 || 'https://mainnet.infura.io/v3/your-api-key',
        process.env.ETH_RPC_3 || 'https://rpc.ankr.com/eth'
    ],
    137: [
        process.env.POLYGON_RPC_1 || 'https://polygon-mainnet.g.alchemy.com/v2/your-api-key',
        process.env.POLYGON_RPC_2 || 'https://polygon-rpc.com',
        process.env.POLYGON_RPC_3 || 'https://rpc.ankr.com/polygon'
    ],
    56: [
        process.env.BSC_RPC_1 || 'https://bsc-dataseed.binance.org/',
        process.env.BSC_RPC_2 || 'https://bsc-dataseed1.defibit.io/',
        process.env.BSC_RPC_3 || 'https://rpc.ankr.com/bsc'
    ],
    43114: [
        process.env.AVAX_RPC_1 || 'https://api.avax.network/ext/bc/C/rpc',
        process.env.AVAX_RPC_2 || 'https://rpc.ankr.com/avalanche',
        process.env.AVAX_RPC_3 || 'https://avalanche-c-chain.publicnode.com'
    ],
    42161: [
        process.env.ARBITRUM_RPC_1 || 'https://arb1.arbitrum.io/rpc',
        process.env.ARBITRUM_RPC_2 || 'https://rpc.ankr.com/arbitrum',
        process.env.ARBITRUM_RPC_3 || 'https://arbitrum-one.publicnode.com'
    ],
    10: [
        process.env.OPTIMISM_RPC_1 || 'https://mainnet.optimism.io',
        process.env.OPTIMISM_RPC_2 || 'https://rpc.ankr.com/optimism',
        process.env.OPTIMISM_RPC_3 || 'https://optimism.publicnode.com'
    ]
};

// URLs des APIs pour THORChain et Maya
const THORCHAIN_API = process.env.THORCHAIN_API || 'https://midgard.thorchain.info/v2';
const THORCHAIN_NODE_API = process.env.THORCHAIN_NODE_API || 'https://thornode.ninerealms.com/thorchain';
const MAYA_API = process.env.MAYA_API || 'https://midgard.mayachain.info/v2';
const MAYA_NODE_API = process.env.MAYA_NODE_API || 'https://mayanode.mayachain.info/mayachain';

// APIs Cosmos pour chaque chaîne
const COSMOS_APIS = {
    'cosmos': process.env.COSMOS_API || 'https://api.cosmos.network',
    'osmosis': process.env.OSMOSIS_API || 'https://lcd.osmosis.zone',
    'juno': process.env.JUNO_API || 'https://lcd-juno.keplr.app',
    'thor': process.env.THOR_API || 'https://thornode.ninerealms.com',
    'maya': process.env.MAYA_NODE_API || 'https://mayanode.mayachain.info',
    'evmos': process.env.EVMOS_API || 'https://rest.evmos.org',
    'injective': process.env.INJECTIVE_API || 'https://lcd.injective.network'
};

// Adresses des factory contracts pour les DEXs sur différentes chaînes
const DEX_FACTORIES = {
    // Ethereum
    1: {
        uniswap: {
            v2: process.env.UNISWAP_V2_FACTORY || '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
            v3: process.env.UNISWAP_V3_FACTORY || '0x1F98431c8aD98523631AE4a59f267346ea31F984'
        },
        sushiswap: {
            v2: process.env.SUSHI_FACTORY || '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac'
        },
        curve: {
            registry: process.env.CURVE_REGISTRY || '0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5'
        }
    },
    // Polygon
    137: {
        quickswap: {
            v2: process.env.QUICKSWAP_FACTORY || '0x5757371414417b8C6CAad45bAeF941aBc7A6Ed7d'
        },
        sushiswap: {
            v2: process.env.SUSHI_POLYGON_FACTORY || '0xc35DADB65012eC5796536bD9864eD8773aBc74C4'
        },
        uniswap: {
            v3: process.env.UNISWAP_V3_POLYGON_FACTORY || '0x1F98431c8aD98523631AE4a59f267346ea31F984'
        }
    },
    // Les autres chaînes suivent le même modèle...
};

// ABIs pour les contracts
const UNISWAP_V2_FACTORY_ABI = [
    'function getPair(address tokenA, address tokenB) external view returns (address pair)'
];

const UNISWAP_V3_FACTORY_ABI = [
    'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)'
];

const UNISWAP_V2_PAIR_ABI = [
    'function token0() external view returns (address)',
    'function token1() external view returns (address)',
    'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)'
];

// Classe pour gérer les rate limits
class RateLimiter {
    constructor(maxRequests, timeWindowMs) {
        this.maxRequests = maxRequests;
        this.timeWindowMs = timeWindowMs;
        this.requestTimestamps = [];
    }

    async throttle() {
        const now = Date.now();
        // Remove expired timestamps
        this.requestTimestamps = this.requestTimestamps.filter(
            timestamp => now - timestamp < this.timeWindowMs
        );

        if (this.requestTimestamps.length >= this.maxRequests) {
            const oldestRequest = this.requestTimestamps[0];
            const timeToWait = this.timeWindowMs - (now - oldestRequest);
            await new Promise(resolve => setTimeout(resolve, timeToWait));
            return this.throttle(); // Retry after waiting
        }

        this.requestTimestamps.push(now);
        return true;
    }
}

// Créer des rate limiters pour différentes APIs
const rpcRateLimiters = {};
Object.keys(RPC_URLS).forEach(chainId => {
    rpcRateLimiters[chainId] = new RateLimiter(10, 1000); // 10 requests per second
});

const thorchainRateLimiter = new RateLimiter(10, 1000);
const mayaRateLimiter = new RateLimiter(10, 1000);

/**
 * Log un message avec un niveau de priorité
 */
function log(level, message, data = {}) {
    if (LOG_LEVELS[level] >= LOG_LEVELS[logLevel]) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
        if (Object.keys(data).length > 0) {
            console.log(JSON.stringify(data, null, 2));
        }
    }
}

/**
 * Fonction utilitaire pour obtenir un provider RPC
 */
async function getRpcProvider(chainId, attempt = 0) {
    const rpcUrls = RPC_URLS[chainId];
    if (!rpcUrls || attempt >= rpcUrls.length) {
        throw new Error(`No available RPC for chain ${chainId}`);
    }

    try {
        await rpcRateLimiters[chainId].throttle();
        const provider = new ethers.JsonRpcProvider(rpcUrls[attempt]);
        await provider.getBlockNumber(); // Test if the provider works
        log('debug', `Using RPC ${rpcUrls[attempt]} for chain ${chainId}`);
        return provider;
    } catch (error) {
        log('warn', `RPC ${rpcUrls[attempt]} failed: ${error.message}. Trying next RPC...`);
        return getRpcProvider(chainId, attempt + 1);
    }
}

/**
 * Fonction utilitaire pour effectuer des requêtes HTTP avec retry
 */
async function withRetry(requestFn, maxRetries = 3, initialDelay = 1000) {
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await requestFn();
        } catch (error) {
            lastError = error;
            
            if (attempt === maxRetries - 1) break;
            
            const delay = initialDelay * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
            log('debug', `Request failed. Retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`, {
                error: error.message
            });
            
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw lastError;
}

/**
 * Formatter les assets pour THORChain et Maya
 */
function formatAsset(token, chainId) {
    // Cas spéciaux pour les tokens natifs
    if (chainId === 0) {
        return 'BTC.BTC';
    } else if (chainId === 1) {
        if (token.toLowerCase() === '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2') {
            return 'ETH.ETH'; // WETH -> ETH
        } else if (token.toLowerCase() === 'eth' || token === 'ethereum') {
            return 'ETH.ETH';
        } else if (token.toLowerCase() === '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599') {
            return 'BTC.BTC'; // WBTC -> BTC
        } else if (token.toLowerCase() === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48') {
            return 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48';
        } else if (token.startsWith('0x')) {
            return `ETH.${token.toUpperCase()}`;
        }
    } else if (chainId === 56) {
        if (token.toLowerCase() === '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c') {
            return 'BNB.BNB'; // WBNB -> BNB
        } else if (token.startsWith('0x')) {
            return `BNB.${token.toUpperCase()}`;
        }
    }

    throw new Error(`Unsupported chain ID for asset formatting: ${chainId}`);
}

/**
 * Vérifier les pools Uniswap V2 et compatibles
 */
async function checkV2Pool(chainId, dex, tokenA, tokenB) {
    const cacheKey = `v2pool-${chainId}-${dex}-${tokenA}-${tokenB}`;
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) return cachedResult;

    try {
        const provider = await getRpcProvider(chainId);
        const factoryAddress = DEX_FACTORIES[chainId]?.[dex]?.v2;
        
        if (!factoryAddress) {
            throw new Error(`No ${dex} factory found for chain ${chainId}`);
        }

        const factory = new ethers.Contract(factoryAddress, UNISWAP_V2_FACTORY_ABI, provider);
        const pairAddress = await factory.getPair(tokenA, tokenB);

        if (pairAddress === '0x0000000000000000000000000000000000000000') {
            const result = { exists: false, dex, chainId };
            cache.set(cacheKey, result);
            return result;
        }

        const pair = new ethers.Contract(pairAddress, UNISWAP_V2_PAIR_ABI, provider);
        const [reserves, token0, token1] = await Promise.all([
            pair.getReserves(),
            pair.token0(),
            pair.token1()
        ]);

        const result = {
            exists: true,
            dex,
            chainId,
            address: pairAddress,
            tokens: {
                [token0]: {
                    address: token0,
                    reserve: reserves[0].toString()
                },
                [token1]: {
                    address: token1,
                    reserve: reserves[1].toString()
                }
            }
        };

        cache.set(cacheKey, result);
        log('info', `Found ${dex} V2 pool on chain ${chainId} for ${tokenA}/${tokenB}`);
        return result;
    } catch (error) {
        log('error', `Error checking ${dex} V2 pool on chain ${chainId}`, { error: error.message });
        return { exists: false, dex, chainId, error: error.message };
    }
}

/**
 * Vérifier les pools Uniswap V3 et compatibles
 */
async function checkV3Pool(chainId, dex, tokenA, tokenB) {
    const cacheKey = `v3pool-${chainId}-${dex}-${tokenA}-${tokenB}`;
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) return cachedResult;

    try {
        const provider = await getRpcProvider(chainId);
        const factoryAddress = DEX_FACTORIES[chainId]?.[dex]?.v3;
        
        if (!factoryAddress) {
            throw new Error(`No ${dex} V3 factory found for chain ${chainId}`);
        }

        const factory = new ethers.Contract(factoryAddress, UNISWAP_V3_FACTORY_ABI, provider);
        
        // Vérifier différents niveaux de frais
        const feeTiers = [100, 500, 3000, 10000];
        const pools = [];

        for (const fee of feeTiers) {
            try {
                const poolAddress = await factory.getPool(tokenA, tokenB, fee);
                if (poolAddress !== '0x0000000000000000000000000000000000000000') {
                    pools.push({
                        address: poolAddress,
                        fee
                    });
                }
            } catch (error) {
                log('debug', `No ${dex} V3 pool found for fee ${fee}bps on chain ${chainId}`);
            }
        }

        const result = {
            exists: pools.length > 0,
            dex,
            chainId,
            pools
        };

        cache.set(cacheKey, result);
        
        if (pools.length > 0) {
            log('info', `Found ${pools.length} ${dex} V3 pools on chain ${chainId} for ${tokenA}/${tokenB}`);
        }
        
        return result;
    } catch (error) {
        log('error', `Error checking ${dex} V3 pool on chain ${chainId}`, { error: error.message });
        return { exists: false, dex, chainId, error: error.message };
    }
}

/**
 * Vérifier la liquidité sur THORChain
 */
async function checkThorchainPool(asset) {
    const cacheKey = `thorchain-${asset}`;
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) return cachedResult;

    try {
        await thorchainRateLimiter.throttle();
        
        const response = await withRetry(
            () => axios.get(`${THORCHAIN_API}/pool/${asset}`, {
                timeout: 5000
            })
        );
        
        const result = {
            exists: true,
            protocol: 'thorchain',
            asset,
            details: {
                assetDepth: response.data.assetDepth,
                runeDepth: response.data.runeDepth,
                assetPrice: response.data.assetPriceUSD,
                status: response.data.status
            }
        };
        
        cache.set(cacheKey, result);
        log('info', `Found THORChain pool for ${asset}`);
        return result;
    } catch (error) {
        if (error.response && error.response.status === 404) {
            log('debug', `No THORChain pool found for ${asset}`);
            return { exists: false, protocol: 'thorchain', asset };
        }
        
        log('error', `Error checking THORChain pool for ${asset}`, {
            error: error.message
        });
        return { exists: false, protocol: 'thorchain', asset, error: error.message };
    }
}

/**
 * Vérifier la liquidité sur Maya Protocol
 */
async function checkMayaPool(asset) {
    const cacheKey = `maya-${asset}`;
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) return cachedResult;

    try {
        await mayaRateLimiter.throttle();
        
        const response = await withRetry(
            () => axios.get(`${MAYA_NODE_API}/pools/${asset}`, {
                timeout: 5000
            })
        );
        
        const result = {
            exists: true,
            protocol: 'maya',
            asset,
            details: {
                assetDepth: response.data.asset_depth || response.data.balance_asset,
                cacaoDepth: response.data.cacao_depth || response.data.balance_cacao,
                status: response.data.status
            }
        };
        
        cache.set(cacheKey, result);
        log('info', `Found Maya pool for ${asset}`);
        return result;
    } catch (error) {
        if (error.response && error.response.status === 404) {
            log('debug', `No Maya pool found for ${asset}`);
            return { exists: false, protocol: 'maya', asset };
        }
        
        log('error', `Error checking Maya pool for ${asset}`, {
            error: error.message
        });
        return { exists: false, protocol: 'maya', asset, error: error.message };
    }
}

/**
 * Fonction principale pour vérifier la liquidité d'un token sur différentes plateformes
 */
async function checkTokenLiquidity(token, chainId, options = {}) {
    log('debug', `Checking liquidity for token ${token} on chain ${chainId || 'unknown'}`);
    
    const results = {
        token,
        chainId,
        chainName: SUPPORTED_CHAINS[chainId] || 'UNKNOWN',
        timestamp: new Date().toISOString(),
        protocols: {}
    };

    try {
        // Vérifications pour chaines EVM
        if (typeof chainId === 'number') {
            const baseToken = options.baseToken || getBaseToken(chainId);
            
            // Uniswap V2 or compatible DEXes
            if ([1, 137, 56, 43114, 42161].includes(chainId)) {
                const dexesV2 = {
                    1: ['uniswap', 'sushiswap'],
                    137: ['quickswap', 'sushiswap'],
                    56: ['pancakeswap'],
                    43114: ['traderjoe', 'pangolin'],
                    42161: ['sushiswap', 'camelot']
                };
                
                for (const dex of dexesV2[chainId] || []) {
                    if (DEX_FACTORIES[chainId]?.[dex]?.v2) {
                        const v2Result = await checkV2Pool(chainId, dex, token, baseToken);
                        results.protocols[dex] = {
                            ...(results.protocols[dex] || {}),
                            v2: v2Result
                        };
                    }
                }
            }
            
            // Uniswap V3 or compatible DEXes
            if ([1, 137, 42161, 10].includes(chainId)) {
                const dexesV3 = {
                    1: ['uniswap'],
                    137: ['uniswap'],
                    42161: ['uniswap'],
                    10: ['uniswap']
                };
                
                for (const dex of dexesV3[chainId] || []) {
                    if (DEX_FACTORIES[chainId]?.[dex]?.v3) {
                        const v3Result = await checkV3Pool(chainId, dex, token, baseToken);
                        results.protocols[dex] = {
                            ...(results.protocols[dex] || {}),
                            v3: v3Result
                        };
                    }
                }
            }
            
            // THORChain (pour les chains EVM supportées)
            if ([0, 1, 56].includes(chainId)) {
                try {
                    const thorAsset = formatAsset(token, chainId);
                    const thorResult = await checkThorchainPool(thorAsset);
                    results.protocols.thorchain = thorResult;
                } catch (error) {
                    log('warn', `Error formatting THORChain asset for ${token} on chain ${chainId}`);
                }
            }
            
            // Maya Protocol (pour les chains EVM supportées)
            if ([0, 1, 56].includes(chainId)) {
                try {
                    const mayaAsset = formatAsset(token, chainId);
                    const mayaResult = await checkMayaPool(mayaAsset);
                    results.protocols.maya = mayaResult;
                } catch (error) {
                    log('warn', `Error formatting Maya asset for ${token} on chain ${chainId}`);
                }
            }
        } 
        // Vérifications pour chaînes Cosmos
        else if (typeof chainId === 'string') {
            // THORChain (pour RUNE natif)
            if (chainId === 'thor') {
                const thorAsset = 'THOR.RUNE';
                const thorResult = await checkThorchainPool(thorAsset);
                results.protocols.thorchain = thorResult;
            }
            
            // Maya Protocol (pour CACAO natif)
            if (chainId === 'maya') {
                const mayaAsset = 'MAYA.CACAO';
                const mayaResult = await checkMayaPool(mayaAsset);
                results.protocols.maya = mayaResult;
            }
        }
    } catch (error) {
        log('error', `Error checking liquidity for ${token} on chain ${chainId}`, {
            error: error.message
        });
        results.error = error.message;
    }

    return results;
}

/**
 * Obtenir le token de base d'une chaîne (généralement WETH, WBNB, etc.)
 */
function getBaseToken(chainId) {
    const baseTokens = {
        1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
        137: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
        56: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
        43114: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // WAVAX
        42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH on Arbitrum
        10: '0x4200000000000000000000000000000000000006'  // WETH on Optimism
    };
    return baseTokens[chainId] || null;
}

/**
 * Configure le niveau de logging
 */
function configureLogging(level) {
    if (LOG_LEVELS[level.toLowerCase()] !== undefined) {
        logLevel = level.toLowerCase();
        log('info', `Logging level set to ${logLevel.toUpperCase()}`);
    } else {
        log('warn', `Invalid logging level: ${level}. Using default: INFO`);
    }
}

// Liste fusionnée des tokens natifs des 3 protocoles obligatoires
const ALL_TOKENS = [
    // Ethereum (Uniswap)
    { token: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', chainId: 1, name: 'Wrapped Ether' },
    { token: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', chainId: 1, name: 'USD Coin' },
    { token: '0xdac17f958d2ee523a2206206994597c13d831ec7', chainId: 1, name: 'Tether USD' },
    { token: '0x6b175474e89094c44da98b954eedeac495271d0f', chainId: 1, name: 'Dai Stablecoin' },
    { token: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', chainId: 1, name: 'Wrapped BTC' },
    { token: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', chainId: 1, name: 'Uniswap' },
    
    // Polygon (Uniswap)
    { token: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', chainId: 137, name: 'Wrapped Matic' },
    { token: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', chainId: 137, name: 'USD Coin (PoS)' },
    { token: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', chainId: 137, name: 'Wrapped Ether' },
    
    // THORChain
    { token: 'BTC', chainId: 0, name: 'Bitcoin' },
    { token: 'ETH', chainId: 1, name: 'Ethereum' },
    { token: 'BNB', chainId: 56, name: 'Binance Coin' },
    { token: 'rune', chainId: 'thor', name: 'RUNE' },
    
    // Maya Protocol
    { token: 'cacao', chainId: 'maya', name: 'CACAO' }
];

/**
 * Fonction principale pour utiliser le scanner de liquidité
 */
async function main() {
    configureLogging(process.env.LOG_LEVEL || 'info');
    
    log('info', 'Starting multi-chain liquidity scanner');
    
    for (const tokenInfo of ALL_TOKENS) {
        try {
            const result = await checkTokenLiquidity(tokenInfo.token, tokenInfo.chainId);
            log('info', `Results for ${tokenInfo.name}:`, result);
        } catch (error) {
            log('error', `Error checking ${tokenInfo.name}:`, { error: error.message });
        }
    }
}

// Exporter les fonctions pour une utilisation externe
module.exports = {
    checkTokenLiquidity,
    ALL_TOKENS,
    SUPPORTED_CHAINS,
    configureLogging
};

// Exécuter si lancé directement
if (require.main === module) {
    main().catch(error => {
        log('error', 'Fatal error in main', { error: error.message });
        process.exit(1);
    });
}
