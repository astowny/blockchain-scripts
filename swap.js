/**
 * Blockchain Swap Script Documentation
 * 
 * This script provides functionality for performing token swaps on various blockchain networks,
 * including same-chain swaps and cross-chain swaps using the Axelar network.
 * 
 * Key Features:
 * - Support for multiple blockchain networks (Ethereum, Binance Smart Chain, Polygon, Avalanche)
 * - Same-chain swaps: Native to Token, Token to Native, and Token to Token
 * - Cross-chain swaps using Axelar network
 * - Automatic slippage calculation and gas estimation
 * - Wallet generation from seed phrase
 * 
 * Main Functions:
 * - performSwap: Main entry point for executing swaps
 * - determineSwapType: Identifies the type of swap to be performed
 * - getChainInfo: Retrieves network-specific information
 * - swapNativeForTokens: Swaps native currency for tokens
 * - swapTokensForNative: Swaps tokens for native currency
 * - swapTokensForTokens: Swaps one token for another
 * - performCrossChainSwap: Executes cross-chain token transfers
 * 
 * Usage:
 * 1. Set up environment variables (WALLET_SEED_PHRASE)
 * 2. Configure swap parameters (see sameChainParams and crossChainParams examples)
 * 3. Call performSwap with the appropriate parameters
 * 
 * Note: Ensure proper security measures when handling private keys and seed phrases.
 */

const ethers = require('ethers');
const { AxelarQueryAPI, AxelarGMPRecoveryAPI, Environment } = require('@axelar-network/axelarjs-sdk');
const { GasToken } = require('@axelar-network/axelarjs-sdk');

// ABIs nécessaires pour les différents types de swaps
const ROUTER_ABI = [
    // Swaps sur la même chaîne
    'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
    'function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external payable returns (uint256[] memory amounts)',
    'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
    // Fonction getAmountsOut pour estimer les sorties
    'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)'
];

// ABI pour les tokens ERC20
const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) public returns (bool)',
    'function transfer(address to, uint256 amount) public returns (bool)',
    'function decimals() view returns (uint8)'
];

// ABI pour le Gateway Axelar
const AXELAR_GATEWAY_ABI = [
    'function sendToken(string calldata destinationChain, string calldata destinationAddress, string calldata symbol, uint256 amount) external',
    'function tokenAddresses(string calldata symbol) external view returns (address)'
];

// Fonction pour générer un wallet à partir de la seed phrase
function getWalletFromSeed(seedPhrase, provider) {
    const wallet = ethers.Wallet.fromPhrase(seedPhrase).connect(provider);
    console.log('=== Wallet Info ===');
    console.log(`Wallet Address: ${wallet.address}`);
    return wallet;
}

// Fonction pour déterminer le type de swap
async function determineSwapType(params) {
    const {
        tokenInAddress,
        tokenOutAddress,
        sourceChainId,
        destinationChainId,
        amountIn
    } = params;

    // Vérifier si c'est un cross-chain swap
    const isCrossChain = destinationChainId && sourceChainId !== destinationChainId;

    if (isCrossChain) {
        console.log("Cross-Chain Swap Detected");
        return "crossChainSwap";
    }

    // Déterminer quel type de swap sur la même chaîne
    const isNativeTokenIn = tokenInAddress === null || tokenInAddress === ethers.ZeroAddress;
    const isNativeTokenOut = tokenOutAddress === null || tokenOutAddress === ethers.ZeroAddress;

    if (isNativeTokenIn) {
        console.log("Native Coin → Token Swap");
        return "swapExactETHForTokens";
    } else if (isNativeTokenOut) {
        console.log("Token → Native Coin Swap");
        return "swapExactTokensForETH";
    } else {
        console.log("Token → Token Swap");
        return "swapExactTokensForTokens";
    }
}

// Fonction pour récupérer les informations de chaîne
function getChainInfo(chainId) {
    const chainConfigs = {
        1: {
            name: "Ethereum",
            rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY",
            wrappedNativeToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
            axelarGateway: "0x4F4495243837681061C4743b74B3eEdf548D56A5",
            axelarGasService: "0x2d5d7d31F671F86C782533cc367F14109a082712",
            axelarTokenSymbol: "ETH"
        },
        56: {
            name: "Binance Smart Chain",
            rpcUrl: "https://bsc-dataseed1.binance.org/",
            wrappedNativeToken: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB
            axelarGateway: "0x304acf330bbE08d1e512eefaa92F6a57871fD895",
            axelarGasService: "0x2d5d7d31F671F86C782533cc367F14109a082712",
            axelarTokenSymbol: "BNB"
        },
        137: {
            name: "Polygon",
            rpcUrl: "https://polygon-rpc.com",
            wrappedNativeToken: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WMATIC
            axelarGateway: "0x6f015F16De9fC8791b234eF68D486d2bF203FBA8",
            axelarGasService: "0x2d5d7d31F671F86C782533cc367F14109a082712",
            axelarTokenSymbol: "MATIC"
        },
        43114: {
            name: "Avalanche",
            rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
            wrappedNativeToken: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", // WAVAX
            axelarGateway: "0x5029C0EFf6C34351a0CEc334542cDb22c7928f78",
            axelarGasService: "0x2d5d7d31F671F86C782533cc367F14109a082712",
            axelarTokenSymbol: "AVAX"
        }
    };

    return chainConfigs[chainId] || null;
}

// Fonction pour obtenir le décimal d'un token
async function getTokenDecimals(tokenAddress, provider) {
    if (!tokenAddress || tokenAddress === ethers.ZeroAddress) {
        return 18; // Décimales par défaut pour les tokens natifs
    }

    try {
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        const decimals = await tokenContract.decimals();
        return decimals;
    } catch (error) {
        console.warn(`Erreur lors de la récupération des décimales du token: ${error.message}`);
        return 18; // Valeur par défaut
    }
}

// Fonction pour formater les montants
async function formatAmount(amount, tokenAddress, provider, operation = 'parse') {
    const decimals = await getTokenDecimals(tokenAddress, provider);

    if (operation === 'parse') {
        return ethers.parseUnits(amount.toString(), decimals);
    } else if (operation === 'format') {
        return ethers.formatUnits(amount, decimals);
    }
}

// Fonction principale pour effectuer les swaps
async function performSwap(params) {
    console.log('\n=== Starting Swap Process ===');

    const {
        seedPhrase,
        sourceChainId,
        destinationChainId,
        routerAddress,
        tokenInAddress,
        tokenOutAddress,
        amountIn,
        slippageTolerance = 0.5, // 0.5% par défaut
        destinationAddress = null,
        axelarGatewayAddress = null,
        axelarGasServiceAddress = null,
    } = params;

    // Récupérer les informations de chaîne source
    const sourceChainInfo = getChainInfo(sourceChainId);
    if (!sourceChainInfo) {
        throw new Error(`ChainId ${sourceChainId} non supporté`);
    }

    console.log(`Source Chain: ${sourceChainInfo.name} (${sourceChainId})`);
    const provider = new ethers.JsonRpcProvider(params.rpcUrl || sourceChainInfo.rpcUrl);
    const wallet = getWalletFromSeed(seedPhrase, provider);

    // Vérifier le solde en natif (ETH, BNB, etc.)
    const nativeBalance = await provider.getBalance(wallet.address);
    console.log(`Native Balance: ${ethers.formatEther(nativeBalance)} ${sourceChainInfo.axelarTokenSymbol}`);

    // Déterminer le type de swap
    const swapType = await determineSwapType({
        tokenInAddress,
        tokenOutAddress,
        sourceChainId,
        destinationChainId,
        amountIn
    });

    // Gérer les swaps cross-chain
    if (swapType === "crossChainSwap") {
        await performCrossChainSwap({
            ...params,
            wallet,
            provider,
            sourceChainInfo,
            destinationChainInfo: getChainInfo(destinationChainId)
        });
        return;
    }

    // Gérer les swaps sur la même chaîne
    console.log('\n=== Contract Initialization ===');
    const router = new ethers.Contract(routerAddress, ROUTER_ABI, wallet);

    // Préparer les paramètres généraux du swap
    const to = destinationAddress || wallet.address;
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes

    // Gérer les différents types de swaps sur la même chaîne
    switch (swapType) {
        case "swapExactETHForTokens":
            await swapNativeForTokens(router, {
                tokenOutAddress,
                amountIn,
                to,
                deadline,
                wallet,
                provider,
                slippageTolerance,
                wrappedNativeToken: sourceChainInfo.wrappedNativeToken
            });
            break;

        case "swapExactTokensForETH":
            await swapTokensForNative(router, {
                tokenInAddress,
                amountIn,
                to,
                deadline,
                wallet,
                provider,
                slippageTolerance,
                wrappedNativeToken: sourceChainInfo.wrappedNativeToken
            });
            break;

        case "swapExactTokensForTokens":
            await swapTokensForTokens(router, {
                tokenInAddress,
                tokenOutAddress,
                amountIn,
                to,
                deadline,
                wallet,
                provider,
                slippageTolerance
            });
            break;

        default:
            throw new Error(`Type de swap inconnu: ${swapType}`);
    }
}

// Fonction pour échanger des tokens natifs contre des tokens ERC20
async function swapNativeForTokens(router, params) {
    const {
        tokenOutAddress,
        amountIn,
        to,
        deadline,
        wallet,
        provider,
        slippageTolerance,
        wrappedNativeToken
    } = params;

    // Préparer les paramètres
    const amountInWei = ethers.parseEther(amountIn.toString());
    const path = [wrappedNativeToken, tokenOutAddress];

    console.log('\n=== Swap Details ===');
    console.log(`Swapping ${amountIn} Native Token for ${tokenOutAddress}`);

    // Vérifier le solde du wallet
    const nativeBalance = await provider.getBalance(wallet.address);
    console.log(`Native Balance: ${ethers.formatEther(nativeBalance)}`);

    if (nativeBalance < amountInWei) {
        throw new Error(`Solde insuffisant: ${ethers.formatEther(nativeBalance)}, nécessite ${amountIn}`);
    }

    // Estimer le montant à recevoir
    try {
        const amounts = await router.getAmountsOut(amountInWei, path);
        const expectedOutput = amounts[amounts.length - 1];
        console.log(`Expected Output: ${ethers.formatUnits(expectedOutput, 18)}`);

        // Calculer le minimum à recevoir avec le slippage
        const minOutput = expectedOutput * BigInt(Math.floor(10000 - slippageTolerance * 100)) / 10000n;
        console.log(`Minimum Output (with ${slippageTolerance}% slippage): ${ethers.formatUnits(minOutput, 18)}`);

        // Estimer le gaz
        const gasEstimate = await router.swapExactETHForTokens.estimateGas(
            minOutput,
            path,
            to,
            deadline,
            { value: amountInWei }
        );
        const gasLimit = (gasEstimate * 120n) / 100n; // +20% buffer

        // Exécuter le swap
        console.log('\n=== Executing Swap ===');
        const tx = await router.swapExactETHForTokens(
            minOutput,
            path,
            to,
            deadline,
            { value: amountInWei, gasLimit }
        );

        console.log(`Transaction Hash: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log('Transaction Status:', receipt.status === 1 ? 'SUCCESS' : 'FAILED');

    } catch (error) {
        console.error('\n=== Error Details ===');
        console.error('Error Message:', error.message);
        throw error;
    }
}

// Fonction pour échanger des tokens ERC20 contre des tokens natifs
async function swapTokensForNative(router, params) {
    const {
        tokenInAddress,
        amountIn,
        to,
        deadline,
        wallet,
        provider,
        slippageTolerance,
        wrappedNativeToken
    } = params;

    // Initialiser le contrat du token d'entrée
    const tokenIn = new ethers.Contract(tokenInAddress, ERC20_ABI, wallet);

    // Convertir le montant en wei avec le bon nombre de décimales
    const tokenDecimals = await getTokenDecimals(tokenInAddress, provider);
    const amountInWei = ethers.parseUnits(amountIn.toString(), tokenDecimals);

    console.log('\n=== Swap Details ===');
    console.log(`Swapping ${amountIn} ${tokenInAddress} for Native Token`);

    // Définir le chemin de swap
    const path = [tokenInAddress, wrappedNativeToken];

    // Vérifier le solde du token
    const balance = await tokenIn.balanceOf(wallet.address);
    console.log(`Token Balance: ${ethers.formatUnits(balance, tokenDecimals)}`);

    if (balance < amountInWei) {
        throw new Error(`Solde insuffisant: ${ethers.formatUnits(balance, tokenDecimals)}, nécessite ${amountIn}`);
    }

    // Vérifier et approuver l'allocation si nécessaire
    const currentAllowance = await tokenIn.allowance(wallet.address, router.target);
    console.log(`Current Allowance: ${ethers.formatUnits(currentAllowance, tokenDecimals)}`);

    if (currentAllowance < amountInWei) {
        console.log('Initiating approval transaction...');
        const approveTx = await tokenIn.approve(router.target, amountInWei);
        console.log(`Approval TX Hash: ${approveTx.hash}`);
        await approveTx.wait();
        console.log('Approval confirmed');
    }

    try {
        // Estimer le montant à recevoir
        const amounts = await router.getAmountsOut(amountInWei, path);
        const expectedOutput = amounts[amounts.length - 1];
        console.log(`Expected Output: ${ethers.formatEther(expectedOutput)} Native Token`);

        // Calculer le minimum à recevoir avec le slippage
        const minOutput = expectedOutput * BigInt(Math.floor(10000 - slippageTolerance * 100)) / 10000n;
        console.log(`Minimum Output (with ${slippageTolerance}% slippage): ${ethers.formatEther(minOutput)}`);

        // Estimer le gaz
        const gasEstimate = await router.swapExactTokensForETH.estimateGas(
            amountInWei,
            minOutput,
            path,
            to,
            deadline
        );
        const gasLimit = (gasEstimate * 120n) / 100n; // +20% buffer

        // Exécuter le swap
        console.log('\n=== Executing Swap ===');
        const tx = await router.swapExactTokensForETH(
            amountInWei,
            minOutput,
            path,
            to,
            deadline,
            { gasLimit }
        );

        console.log(`Transaction Hash: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log('Transaction Status:', receipt.status === 1 ? 'SUCCESS' : 'FAILED');

    } catch (error) {
        console.error('\n=== Error Details ===');
        console.error('Error Message:', error.message);
        throw error;
    }
}

// Fonction pour échanger des tokens ERC20 contre d'autres tokens ERC20
async function swapTokensForTokens(router, params) {
    const {
        tokenInAddress,
        tokenOutAddress,
        amountIn,
        to,
        deadline,
        wallet,
        provider,
        slippageTolerance
    } = params;

    // Initialiser le contrat du token d'entrée
    const tokenIn = new ethers.Contract(tokenInAddress, ERC20_ABI, wallet);

    // Convertir le montant en wei avec le bon nombre de décimales
    const tokenInDecimals = await getTokenDecimals(tokenInAddress, provider);
    const amountInWei = ethers.parseUnits(amountIn.toString(), tokenInDecimals);

    console.log('\n=== Swap Details ===');
    console.log(`Swapping ${amountIn} ${tokenInAddress} for ${tokenOutAddress}`);

    // Définir le chemin de swap
    const path = [tokenInAddress, tokenOutAddress];

    // Vérifier le solde du token
    const balance = await tokenIn.balanceOf(wallet.address);
    console.log(`Token Balance: ${ethers.formatUnits(balance, tokenInDecimals)}`);

    if (balance < amountInWei) {
        throw new Error(`Solde insuffisant: ${ethers.formatUnits(balance, tokenInDecimals)}, nécessite ${amountIn}`);
    }

    // Vérifier et approuver l'allocation si nécessaire
    const currentAllowance = await tokenIn.allowance(wallet.address, router.target);
    console.log(`Current Allowance: ${ethers.formatUnits(currentAllowance, tokenInDecimals)}`);

    if (currentAllowance < amountInWei) {
        console.log('Initiating approval transaction...');
        const approveTx = await tokenIn.approve(router.target, amountInWei);
        console.log(`Approval TX Hash: ${approveTx.hash}`);
        await approveTx.wait();
        console.log('Approval confirmed');
    }

    try {
        // Estimer le montant à recevoir
        const amounts = await router.getAmountsOut(amountInWei, path);
        const expectedOutput = amounts[amounts.length - 1];
        const tokenOutDecimals = await getTokenDecimals(tokenOutAddress, provider);
        console.log(`Expected Output: ${ethers.formatUnits(expectedOutput, tokenOutDecimals)} Token Out`);

        // Calculer le minimum à recevoir avec le slippage
        const minOutput = expectedOutput * BigInt(Math.floor(10000 - slippageTolerance * 100)) / 10000n;
        console.log(`Minimum Output (with ${slippageTolerance}% slippage): ${ethers.formatUnits(minOutput, tokenOutDecimals)}`);

        // Estimer le gaz
        const gasEstimate = await router.swapExactTokensForTokens.estimateGas(
            amountInWei,
            minOutput,
            path,
            to,
            deadline
        );
        const gasLimit = (gasEstimate * 120n) / 100n; // +20% buffer

        // Exécuter le swap
        console.log('\n=== Executing Swap ===');
        const tx = await router.swapExactTokensForTokens(
            amountInWei,
            minOutput,
            path,
            to,
            deadline,
            { gasLimit }
        );

        console.log(`Transaction Hash: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log('Transaction Status:', receipt.status === 1 ? 'SUCCESS' : 'FAILED');

    } catch (error) {
        console.error('\n=== Error Details ===');
        console.error('Error Message:', error.message);
        throw error;
    }
}

// Fonction pour effectuer des swaps cross-chain avec Axelar
async function performCrossChainSwap(params) {
    const {
        wallet,
        provider,
        sourceChainInfo,
        destinationChainInfo,
        tokenInAddress,
        tokenOutAddress,
        amountIn,
        destinationAddress,
        axelarGatewayAddress,
        axelarGasServiceAddress
    } = params;

    if (!destinationChainInfo) {
        throw new Error(`ChainId de destination non supporté`);
    }

    console.log('\n=== Cross-Chain Swap Details ===');
    console.log(`From: ${sourceChainInfo.name} -> To: ${destinationChainInfo.name}`);

    // Initialisation de l'API Axelar
    const axelarApi = new AxelarQueryAPI({
        environment: Environment.MAINNET
    });

    // Adresse du gateway Axelar (utiliser celle fournie ou celle par défaut)
    const gatewayAddress = axelarGatewayAddress || sourceChainInfo.axelarGateway;
    const gateway = new ethers.Contract(gatewayAddress, AXELAR_GATEWAY_ABI, wallet);

    // Déterminer si nous avons besoin de faire un swap avant le bridge
    const isNativeTokenIn = tokenInAddress === null || tokenInAddress === ethers.ZeroAddress;

    // Pour les tokens natifs, nous devons d'abord les wrapper
    if (isNativeTokenIn) {
        console.log(`Wrapping native ${sourceChainInfo.axelarTokenSymbol} before bridging`);
        // Code pour wrapper le token natif ici...
    }

    // Déterminer le symbol Axelar du token
    let axelarTokenSymbol;

    // Si c'est un token natif ou son wrapped version
    if (isNativeTokenIn || tokenInAddress.toLowerCase() === sourceChainInfo.wrappedNativeToken.toLowerCase()) {
        axelarTokenSymbol = sourceChainInfo.axelarTokenSymbol;
    } else {
        // Pour les autres tokens, il faudrait une liste de mapping
        // Voici quelques exemples (à compléter selon les besoins)
        const tokenMappings = {
            // USDC sur différentes chaînes
            "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": "USDC", // Ethereum
            "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d": "USDC", // BSC
            // USDT sur différentes chaînes
            "0xdAC17F958D2ee523a2206206994597C13D831ec7": "USDT", // Ethereum
            "0x55d398326f99059fF775485246999027B3197955": "USDT", // BSC
        };

        axelarTokenSymbol = tokenMappings[tokenInAddress.toLowerCase()];
        if (!axelarTokenSymbol) {
            throw new Error(`Token ${tokenInAddress} non supporté pour le bridge cross-chain`);
        }
    }

    console.log(`Using Axelar token symbol: ${axelarTokenSymbol}`);

    // Vérifier si le token est validé par Axelar
    const tokenAddress = await gateway.tokenAddresses(axelarTokenSymbol);
    console.log(`Axelar supported token address: ${tokenAddress}`);

    if (tokenAddress === ethers.ZeroAddress) {
        throw new Error(`Token ${axelarTokenSymbol} non supporté par Axelar sur ${sourceChainInfo.name}`);
    }

    // Convertir le montant en wei avec le bon nombre de décimales
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const tokenDecimals = await tokenContract.decimals();
    const amountInWei = ethers.parseUnits(amountIn.toString(), tokenDecimals);

    // Vérifier le solde
    const balance = await tokenContract.balanceOf(wallet.address);
    console.log(`Token Balance: ${ethers.formatUnits(balance, tokenDecimals)}`);

    if (balance < amountInWei) {
        throw new Error(`Solde insuffisant: ${ethers.formatUnits(balance, tokenDecimals)}, nécessite ${amountIn}`);
    }

    // Approuver le gateway pour dépenser les tokens
    const currentAllowance = await tokenContract.allowance(wallet.address, gateway.target);

    if (currentAllowance < amountInWei) {
        console.log('Approving Axelar Gateway...');
        const approveTx = await tokenContract.approve(gateway.target, amountInWei);
        console.log(`Approval TX Hash: ${approveTx.hash}`);
        await approveTx.wait();
        console.log('Approval confirmed');
    }

    // Estimer les frais de gaz pour le bridge
    const gasFee = await axelarApi.estimateGasFee(
        sourceChainInfo.name.toLowerCase(),
        destinationChainInfo.name.toLowerCase(),
        GasToken[sourceChainInfo.axelarTokenSymbol],
        700000, // Gas limit estimation
        1.2 // Gas multiplier
    );

    console.log(`Estimated Gas Fee: ${gasFee}`);

    // Exécuter le bridge
    console.log('\n=== Executing Cross-Chain Transfer ===');
    try {
        const tx = await gateway.sendToken(
            destinationChainInfo.name,
            destinationAddress || wallet.address,
            axelarTokenSymbol,
            amountInWei,
            { value: ethers.parseEther(gasFee) }
        );

        console.log(`Transaction Hash: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log('Transaction Status:', receipt.status === 1 ? 'SUCCESS' : 'FAILED');

        console.log('\n=== Cross-Chain Transfer Initiated ===');
        console.log(`Sent ${amountIn} ${axelarTokenSymbol} from ${sourceChainInfo.name} to ${destinationChainInfo.name}`);
        console.log(`Destination Address: ${destinationAddress || wallet.address}`);
        console.log(`It may take a few minutes for the funds to arrive on the destination chain.`);

        // Optionnel: Surveillance du statut du transfer via AxelarGMPRecoveryAPI
        const recoveryApi = new AxelarGMPRecoveryAPI({
            environment: Environment.MAINNET
        });

        console.log(`\nTransfer tracking link: https://axelarscan.io/tx/${tx.hash}`);

    } catch (error) {
        console.error('\n=== Error Details ===');
        console.error('Error Message:', error.message);
        throw error;
    }
}

// Exemple d'utilisation pour un swap sur la même chaîne
const sameChainParams = {
    seedPhrase: process.env.WALLET_SEED_PHRASE,
    sourceChainId: 56, // BSC
    routerAddress: '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap Router
    tokenInAddress: null, // WBNB
    tokenOutAddress: "0x55d398326f99059fF775485246999027B3197955", // usdt // Native BNB (null désigne le token natif)
    amountIn: '0.002',
    slippageTolerance: 0.5 // 0.5% slippage
};

// Exemple d'utilisation pour un swap cross-chain
const crossChainParams = {
    seedPhrase: process.env.WALLET_SEED_PHRASE,
    sourceChainId: 56, // BSC
    destinationChainId: 137, // Polygon // Ethereum
    tokenInAddress: "0x55d398326f99059fF775485246999027B3197955",// '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC sur BSC
    tokenOutAddress: null,//'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC sur Ethereum (pour information)
    amountIn: '1.1', // 1 environ USDt
    destinationAddress: null, // Utiliser la même adresse sur la chaîne de destination
    slippageTolerance: 0.5 // 0.5% slippage
};

// Export des fonctions
module.exports = {
    performSwap,
    determineSwapType,
    getChainInfo
};

// Pour exécuter un swap (décommentez une des lignes suivantes)
// performSwap(sameChainParams).catch(console.error);
// performSwap(crossChainParams).catch(console.error);
