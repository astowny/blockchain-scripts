const { ethers } = require('ethers');
const { Wallet, Mnemonic } = require('ethers');
const axios = require('axios');
require('dotenv').config();

// Ajouter cette configuration des RPC publics après les imports
const PUBLIC_RPC_URLS = {
    1: [ // Ethereum
        'https://eth.public-rpc.com',
        'https://rpc.ankr.com/eth',
        'https://ethereum.publicnode.com',
    ],
    137: [ // Polygon
        'https://polygon-rpc.com',
        'https://rpc.ankr.com/polygon',
        'https://polygon.publicnode.com',
    ],
    56: [ // BSC
        'https://bsc-dataseed1.binance.org',
        'https://bsc-dataseed2.binance.org',
        'https://bsc.publicnode.com',
    ],
    42161: [ // Arbitrum
        'https://arb1.arbitrum.io/rpc',
        'https://arbitrum.publicnode.com',
    ],
    10: [ // Optimism
        'https://mainnet.optimism.io',
        'https://optimism.publicnode.com',
    ],
    43114: [ // Avalanche
        'https://api.avax.network/ext/bc/C/rpc',
        'https://avalanche.public-rpc.com',
    ]
};

// Ajout des adresses des tokens courants
const COMMON_TOKENS = {
    1: [ // Ethereum
        '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
        '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // WBTC
        '0x514910771af9ca656af840dff83e8264ecf986ca', // LINK
        '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'  // UNI
    ],
    137: [ // Polygon
        '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC
        '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', // USDT
        '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', // WBTC
        '0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39'  // LINK
    ],
    56: [ // BSC
        '0x55d398326f99059ff775485246999027b3197955', // USDT
        '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC
        '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c'  // WBTC
    ]
};

// Modification de l'ABI pour inclure toutes les fonctions nécessaires
const ERC20_ABI = [
    // Read-Only Functions
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function name() view returns (string)',
    // Optional but common
    'function totalSupply() view returns (uint256)',
    'function allowance(address, address) view returns (uint256)'
];

// Ajout d'une fonction pour tester différents RPC jusqu'à ce qu'un fonctionne
async function getWorkingProvider(chainId) {
    const rpcs = PUBLIC_RPC_URLS[chainId];
    for (const rpc of rpcs) {
        try {
            const provider = new ethers.JsonRpcProvider(rpc);
            await provider.getBlockNumber(); // Test de connexion
            return provider;
        } catch (error) {
            console.warn(`RPC ${rpc} ne répond pas, essai suivant...`);
            continue;
        }
    }
    throw new Error(`Aucun RPC disponible pour la chaîne ${chainId}`);
}

/**
 * Récupère tous les tokens d'un wallet sur une chaîne spécifique
 * @param {string} address - Adresse du wallet
 * @param {number} chainId - ID de la chaîne (1 = Ethereum, 137 = Polygon, etc.)
 */
async function getWalletTokens(address, chainId = 1) {
    const results = {
        address,
        chainId,
        nativeBalance: '0',
        tokens: []
    };

    try {
        const provider = await getWorkingProvider(chainId);
        results.nativeBalance = (await provider.getBalance(address)).toString();

        for (const tokenAddress of COMMON_TOKENS[chainId]) {
            try {
                const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
                
                // Récupération des informations du token
                const balance = await tokenContract.balanceOf(address);
                
                if (balance > 0) {
                    let tokenInfo = {
                        address: tokenAddress,
                        balance: balance.toString()
                    };

                    // Récupération des métadonnées avec gestion d'erreur pour chaque appel
                    try {
                        tokenInfo.decimals = await tokenContract.decimals();
                    } catch (e) {
                        tokenInfo.decimals = 18; // Valeur par défaut
                    }

                    try {
                        tokenInfo.symbol = await tokenContract.symbol();
                    } catch (e) {
                        tokenInfo.symbol = 'UNKNOWN';
                    }

                    try {
                        tokenInfo.name = await tokenContract.name();
                    } catch (e) {
                        tokenInfo.name = 'Unknown Token';
                    }

                    tokenInfo.formattedBalance = ethers.formatUnits(balance, tokenInfo.decimals);
                    results.tokens.push(tokenInfo);
                }
            } catch (error) {
                console.warn(`Erreur pour le token ${tokenAddress}: ${error.message}`);
                continue;
            }
        }
    } catch (error) {
        console.error(`Erreur lors de la récupération des tokens:`, error);
        throw error;
    }

    return results;
}

/**
 * Vérifie la balance d'un token spécifique
 * @param {string} walletAddress - Adresse du wallet
 * @param {string} tokenAddress - Adresse du contrat du token
 * @param {number} chainId - ID de la chaîne
 */
async function checkTokenBalance(walletAddress, tokenAddress, chainId = 1) {
    // Utilise le premier RPC disponible avec fallback
    const provider = new ethers.JsonRpcProvider(PUBLIC_RPC_URLS[chainId][0]);
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

    try {
        const [balance, decimals, symbol] = await Promise.all([
            tokenContract.balanceOf(walletAddress),
            tokenContract.decimals(),
            tokenContract.symbol()
        ]);

        return {
            address: tokenAddress,
            symbol,
            decimals,
            balance: balance.toString(),
            formatted: ethers.formatUnits(balance, decimals)
        };
    } catch (error) {
        console.error(`Erreur lors de la vérification du token ${tokenAddress}:`, error);
        throw error;
    }
}

/**
 * Génère un wallet à partir d'une seed phrase
 * @param {string} mnemonic - La phrase mnémonique (12 ou 24 mots)
 * @param {number} index - Index du compte à dériver (défaut: 0)
 * @returns {Object} Wallet object
 */
async function getWalletFromSeed(mnemonic, index = 0) {
    try {
        // Vérifie si la seed phrase est valide
        if (!Mnemonic.isValidMnemonic(mnemonic)) {
            throw new Error('Phrase mnémonique invalide');
        }

        // Initialise le wallet directement depuis la seed phrase
        const wallet = ethers.Wallet.fromPhrase(mnemonic);

        return {
            address: wallet.address,
            wallet: wallet,
            path: `m/44'/60'/0'/0/${index}`
        };
    } catch (error) {
        console.error('Erreur lors de la génération du wallet:', error);
        throw error;
    }
}

// Export des fonctions
module.exports = {
    getWalletTokens,
    checkTokenBalance
};

// Ajouter cette fonction utilitaire en haut du fichier
function serializeBigInt(obj) {
    return JSON.stringify(obj, (key, value) => 
        typeof value === 'bigint' 
            ? value.toString() 
            : value
    );
}

// Modifier la fonction main pour scanner plusieurs chaînes
async function main() {
    try {
        const mnemonic = process.env.WALLET_SEED_PHRASE;
        if (!mnemonic) {
            throw new Error('WALLET_SEED_PHRASE non défini dans .env');
        }

        const walletInfo = await getWalletFromSeed(mnemonic);
        console.log('Wallet généré:', {
            address: walletInfo.address,
            path: walletInfo.path
        });

        // Scanner plusieurs chaînes
        const chains = [1, 137, 56]; // Ethereum, Polygon, BSC
        
        for (const chainId of chains) {
            console.log(`\nScanning chaîne ${chainId}...`);
            const tokens = await getWalletTokens(walletInfo.address, chainId);
            
            // Formater les résultats
            const formattedTokens = {
                ...tokens,
                nativeBalance: tokens.nativeBalance.toString(),
                tokens: tokens.tokens.map(token => ({
                    ...token,
                    balance: token.balance.toString(),
                    formattedBalance: ethers.formatUnits(token.balance, token.decimals)
                }))
            };

            // Utiliser la fonction personnalisée pour la sérialisation
            console.log(serializeBigInt(formattedTokens));
        }
    } catch (error) {
        console.error('Erreur:', error);
    }
}

main();