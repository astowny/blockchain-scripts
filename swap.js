// multi-chain-router.js
import { createConfig, EVM, getQuote, convertQuoteToRoute, executeRoute, config } from '@lifi/sdk';
import { ethers } from 'ethers';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, arbitrum, optimism, polygon, bsc } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

// ABI for wrapped native tokens (WETH, WBNB, WMATIC, etc.)
const WRAPPED_TOKEN_ABI = [
  // Function to deposit (wrap) ETH
  {
    constant: false,
    inputs: [],
    name: 'deposit',
    outputs: [],
    payable: true,
    stateMutability: 'payable',
    type: 'function',
  },
  // Function to withdraw (unwrap) ETH
  {
    constant: false,
    inputs: [{ name: 'wad', type: 'uint256' }],
    name: 'withdraw',
    outputs: [],
    payable: false,
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // To check balance
  {
    constant: true,
    inputs: [{ name: '', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
];

// Known wrapped native token addresses by chain ID
const WRAPPED_NATIVE_TOKENS = {
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH on Ethereum
  56: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB on BSC
  137: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC on Polygon
  42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH on Arbitrum
  10: '0x4200000000000000000000000000000000000006', // WETH on Optimism
};

// RPC endpoints for different chains
const RPC_URLS = {
  1: 'https://ethereum.publicnode.com',
  56: 'https://bsc-dataseed.binance.org',
  137: 'https://polygon-rpc.com',
  42161: 'https://arb1.arbitrum.io/rpc',
  10: 'https://mainnet.optimism.io',
};

// Setup file logging
const setupLogging = () => {
  // Create logs directory if it doesn't exist
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
  }
  
  // Create log file with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFilePath = path.join(logsDir, `swap-${timestamp}.log`);
  
  // Initialize log file
  fs.writeFileSync(logFilePath, `=== Multi-Chain Swap Log Started at ${new Date().toISOString()} ===\n\n`);
  
  return {
    log: (message) => {
      // Log to console
      console.log(message);
      
      // Log to file
      fs.appendFileSync(logFilePath, `[${new Date().toISOString()}] ${message}\n`);
    },
    
    error: (message) => {
      // Log to console
      console.error(message);
      
      // Log to file
      fs.appendFileSync(logFilePath, `[${new Date().toISOString()}] ERROR: ${message}\n`);
    },
    
    filePath: logFilePath
  };
};

// Create logger
const logger = setupLogging();
logger.log(`Logging to: ${logger.filePath}`);

// Initialize the Li.Fi SDK
createConfig({
  integrator: 'MultiChainSwapRouter',
});

/**
 * Initialize wallet from seed phrase
 * @returns {ethers.Wallet} The initialized wallet
 */
const initializeWallet = () => {
  const seedPhrase = process.env.WALLET_SEED_PHRASE;
  
  if (!seedPhrase) {
    throw new Error('WALLET_SEED_PHRASE environment variable is not set');
  }
  
  // Create wallet from seed phrase
  const wallet = ethers.Wallet.fromPhrase(seedPhrase);
  logger.log(`Wallet initialized with address: ${wallet.address}`);
  return wallet;
};

/**
 * Configure SDK provider with wallet
 * @param {ethers.Wallet} wallet - The ethers.js wallet
 * @returns {Object} An object containing the viem account and original wallet
 */
const configureSDKProvider = (wallet) => {
  // Convert ethers private key to viem account
  const account = privateKeyToAccount(`0x${wallet.privateKey.slice(2)}`);
  
  // Define chains we'll support
  const chains = [mainnet, arbitrum, optimism, polygon, bsc];
  
  // Create a viem wallet client for initial chain (using BSC since that's what's in your example)
  const client = createWalletClient({
    account,
    chain: bsc,
    transport: http(),
  });
  
  // Configure EVM provider for Li.Fi SDK
  const evmProvider = EVM({
    getWalletClient: async () => client,
    switchChain: async (chainId) => {
      // Find the chain with matching chainId
      const chain = chains.find(chain => chain.id === chainId);
      if (!chain) {
        throw new Error(`Chain with ID ${chainId} not supported`);
      }
      
      logger.log(`Switching chain to ${chain.name} (${chainId})`);
      
      // Return a new wallet client for the specified chain
      return createWalletClient({
        account,
        chain,
        transport: http(),
      });
    },
  });
  
  // Update SDK configuration with the provider
  config.setProviders([evmProvider]);
  
  logger.log(`SDK provider configured with account: ${account.address}`);
  return { account, wallet };
};

/**
 * Check if the operation is a wrap/unwrap on the same chain
 */
const isWrapUnwrapOnSameChain = (params) => {
  const { fromChain, toChain, fromToken, toToken } = params;
  
  // Must be same chain
  if (fromChain !== toChain) return false;
  
  // Get wrapped native token address for this chain
  const wrappedNativeAddress = WRAPPED_NATIVE_TOKENS[fromChain];
  if (!wrappedNativeAddress) return false;
  
  // Native token (0x00) to wrapped native token = Wrap operation
  const isNativeToWrapped = 
    fromToken === '0x0000000000000000000000000000000000000000' && 
    toToken.toLowerCase() === wrappedNativeAddress.toLowerCase();
    
  // Wrapped native token to native token (0x00) = Unwrap operation
  const isWrappedToNative = 
    fromToken.toLowerCase() === wrappedNativeAddress.toLowerCase() && 
    toToken === '0x0000000000000000000000000000000000000000';
    
  return isNativeToWrapped || isWrappedToNative;
};

/**
 * Handle native token wrapping directly
 */
const handleDirectWrap = async (params, wallet) => {
  const { fromChain, fromAmount } = params;
  
  // Get the wrapped token contract address
  const wrappedTokenAddress = WRAPPED_NATIVE_TOKENS[fromChain];
  logger.log(`Directly wrapping ${ethers.formatEther(fromAmount)} native tokens to ${wrappedTokenAddress}`);
  
  try {
    // Get provider for this chain
    const provider = new ethers.JsonRpcProvider(RPC_URLS[fromChain]);
    const connectedWallet = wallet.connect(provider);
    
    // Create contract instance
    const wrappedContract = new ethers.Contract(
      wrappedTokenAddress, 
      WRAPPED_TOKEN_ABI, 
      connectedWallet
    );
    
    // Execute wrap transaction
    const tx = await wrappedContract.deposit({
      value: fromAmount
    });
    
    logger.log(`Wrap transaction sent: ${tx.hash}`);
    
    // Wait for confirmation
    const receipt = await tx.wait();
    
    logger.log(`
Wrap transaction confirmed!
- Transaction Hash: ${receipt.hash}
- Block Number: ${receipt.blockNumber}
- Gas Used: ${receipt.gasUsed}
    `);
    
    return {
      success: true,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber
    };
  } catch (error) {
    logger.error(`Failed to wrap native token: ${error.message}`);
    throw error;
  }
};

/**
 * Handle wrapped token unwrapping directly
 */
const handleDirectUnwrap = async (params, wallet) => {
  const { fromChain, fromAmount, fromToken } = params;
  
  // Get the wrapped token contract address
  const wrappedTokenAddress = WRAPPED_NATIVE_TOKENS[fromChain];
  logger.log(`Directly unwrapping ${ethers.formatEther(fromAmount)} ${fromToken} to native tokens`);
  
  try {
    // Get provider for this chain
    const provider = new ethers.JsonRpcProvider(RPC_URLS[fromChain]);
    const connectedWallet = wallet.connect(provider);
    
    // Create contract instance
    const wrappedContract = new ethers.Contract(
      wrappedTokenAddress, 
      WRAPPED_TOKEN_ABI, 
      connectedWallet
    );
    
    // Execute unwrap transaction
    const tx = await wrappedContract.withdraw(fromAmount);
    
    logger.log(`Unwrap transaction sent: ${tx.hash}`);
    
    // Wait for confirmation
    const receipt = await tx.wait();
    
    logger.log(`
Unwrap transaction confirmed!
- Transaction Hash: ${receipt.hash}
- Block Number: ${receipt.blockNumber}
- Gas Used: ${receipt.gasUsed}
    `);
    
    return {
      success: true,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber
    };
  } catch (error) {
    logger.error(`Failed to unwrap token: ${error.message}`);
    throw error;
  }
};

/**
 * Perform a cross-chain or same-chain swap with intelligent routing
 */
const performMultiChainSwap = async (params, options = {}) => {
  // Default options
  const maxTimeoutMinutes = options.maxTimeoutMinutes || 30;
  
  // Validate parameters
  if (!params.fromChain) throw new Error("fromChain is required");
  if (!params.toChain) throw new Error("toChain is required");
  if (!params.fromToken) throw new Error("fromToken is required");
  if (!params.toToken) throw new Error("toToken is required");
  if (!params.fromAmount) throw new Error("fromAmount is required");
  if (!params.fromAddress) throw new Error("fromAddress is required");
  
  logger.log(`
Multi-Chain Swap Request:
- From Chain: ${params.fromChain}
- To Chain: ${params.toChain}
- From Token: ${params.fromToken}
- To Token: ${params.toToken}
- Amount: ${params.fromAmount}
- Sender: ${params.fromAddress}
- Max timeout: ${maxTimeoutMinutes} minutes
  `);
  
  try {
    // Check if this is a wrap/unwrap on the same chain
    if (isWrapUnwrapOnSameChain(params)) {
      logger.log('Detected wrap/unwrap operation on the same chain - handling directly');
      
      const wallet = initializeWallet();
      
      // Is this wrapping or unwrapping?
      const isWrapping = params.fromToken === '0x0000000000000000000000000000000000000000';
      
      if (isWrapping) {
        return await handleDirectWrap(params, wallet);
      } else {
        return await handleDirectUnwrap(params, wallet);
      }
    }
    
    // Otherwise, proceed with Li.Fi for cross-chain or other swap types
    logger.log('Proceeding with Li.Fi for cross-chain swap');
    
    // Get a quote for the swap
    const quote = await getQuote({
      fromChain: params.fromChain,
      toChain: params.toChain,
      fromToken: params.fromToken,
      toToken: params.toToken,
      fromAmount: params.fromAmount,
      fromAddress: params.fromAddress,
    });
    
    logger.log(`
Quote received:
- From: ${params.fromAmount} ${quote.action.fromToken.symbol} on ${quote.action.fromChainId}
- To: ~${quote.estimate.toAmount} ${quote.action.toToken.symbol} on ${quote.action.toChainId}
- Gas Cost: ${quote.estimate.gasCosts.reduce((total, cost) => total + BigInt(cost.amount), 0n)} (in wei)
- Execution Time: ~${quote.estimate.executionDuration} seconds
- Using: ${quote.tool}
    `);
    
    // Convert quote to route
    logger.log('Converting quote to route...');
    const route = convertQuoteToRoute(quote);
    
    // Execute the swap
    logger.log('Executing cross-chain swap...');
    
    // Setup tracking variables
    let executionStartTime = Date.now();
    let lastStatusUpdate = {
      status: null,
      timestamp: 0,
      txHash: null,
      lastPrinted: 0
    };
    
    const timeoutMs = maxTimeoutMinutes * 60 * 1000;
    
    // Execute the route with monitoring
    const executedRoute = await executeRoute(route, {
      updateRouteHook(updatedRoute) {
        // Check if we've exceeded the timeout
        if (Date.now() - executionStartTime > timeoutMs) {
          logger.error(`
⚠️ Cross-chain swap has exceeded the maximum timeout of ${maxTimeoutMinutes} minutes.
The transaction might still complete, but this script will exit.
          `);
          process.exit(1);
        }
        
        // Get current step and process
        const currentStep = updatedRoute.steps[updatedRoute.steps.length - 1];
        if (currentStep?.execution?.process?.length > 0) {
          const latestProcess = currentStep.execution.process[currentStep.execution.process.length - 1];
          
          // Only print updates if something changed or 30 seconds have passed
          const statusChanged = latestProcess.status !== lastStatusUpdate.status;
          const txHashChanged = latestProcess.txHash !== lastStatusUpdate.txHash;
          const timeSinceLastPrint = Date.now() - lastStatusUpdate.lastPrinted;
          
          if (statusChanged || txHashChanged || timeSinceLastPrint > 30000) {
            // Get more info about the bridge if available
            const bridgeInfo = currentStep.toolDetails?.name || currentStep.tool || 'Unknown bridge';
            
            // Calculate time elapsed
            const timeElapsed = Math.floor((Date.now() - executionStartTime) / 1000);
            const minutes = Math.floor(timeElapsed / 60);
            const seconds = timeElapsed % 60;
            
            logger.log(`
Execution update (${minutes}m ${seconds}s elapsed):
- Status: ${latestProcess.status}
- Type: ${latestProcess.type}
- Bridge: ${bridgeInfo}
- Transaction Hash: ${latestProcess.txHash || 'Not available yet'}
- Chain: ${currentStep.action.fromChainId} -> ${currentStep.action.toChainId}
${latestProcess.status === 'PENDING' && latestProcess.type === 'RECEIVING_CHAIN' 
  ? '⏳ Bridge confirmation is still pending. This process can take from 5-30 minutes depending on the bridge used.' 
  : ''}
            `);
            
            // Update our tracking variables
            lastStatusUpdate = {
              status: latestProcess.status,
              txHash: latestProcess.txHash,
              timestamp: Date.now(),
              lastPrinted: Date.now()
            };
          }
        }
      },
      
      // This gets called when exchange rates change during execution
      acceptExchangeRateUpdateHook: async (toToken, oldToAmount, newToAmount) => {
        const oldAmount = ethers.formatUnits(oldToAmount, toToken.decimals);
        const newAmount = ethers.formatUnits(newToAmount, toToken.decimals);
        const percentChange = (Number(newAmount) / Number(oldAmount) - 1) * 100;
        
        logger.log(`
Exchange rate updated:
- Token: ${toToken.symbol}
- Old amount: ${oldAmount}
- New amount: ${newAmount}
- Change: ${percentChange.toFixed(2)}%
        `);
        
        // Auto-accept if the rate hasn't decreased more than 1%
        if (percentChange >= -1) {
          logger.log('Rate change is acceptable. Continuing execution...');
          return true;
        }
        
        logger.log('Rate change exceeds threshold. Rejecting execution...');
        return false;
      }
    });
    
    logger.log(`
🎉 Swap executed successfully!
- Route ID: ${executedRoute.routeId}
- Status: ${executedRoute.status}
    `);
    
    return executedRoute;
  } catch (error) {
    logger.error(`Error during multi-chain swap: ${error.message}`);
    
    // Provide more detailed error messages
    if (error.message?.includes('Not an EVM Transaction')) {
      logger.error('💡 This appears to be an issue with Li.Fi\'s wrapper bridge. The router should have handled this as a direct operation.');
    }
    
    throw error;
  }
};

/**
 * Run the BNB to WBNB example
 */
const runBnbToWbnbExample = async () => {
  try {
    // Initialize wallet and configure SDK
    const wallet = initializeWallet();
    const { account } = configureSDKProvider(wallet);
    
    logger.log(`Setting up BNB to WBNB swap`);
    
    // Perform the swap - will be handled directly
    await performMultiChainSwap({
      fromAddress: account.address,
      fromChain: 56,    // BSC
      toChain: 43114,      // BSC (same chain)
      fromToken: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // BNB (native token)
      toToken: '0x408d4cd0adb7cebd1f1a1c33a0ba2098e1295bab', // WBNB
      fromAmount: ethers.parseEther('0.01').toString(), // 0.01 BNB
    });
    
    logger.log('BNB to WBNB swap completed successfully!');
  } catch (error) {
    logger.error('Failed to complete BNB to WBNB swap: ' + error.message);
  }
};

// Run the example
runBnbToWbnbExample();

// Export functions for use in other scripts
export {
  initializeWallet,
  configureSDKProvider,
  performMultiChainSwap,
  runBnbToWbnbExample
};


