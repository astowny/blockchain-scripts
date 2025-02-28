// swap.js
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
  fs.writeFileSync(logFilePath, `=== Cross-Chain Swap Log Started at ${new Date().toISOString()} ===\n\n`);
  
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
  integrator: 'CrossChainSwapExample',
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
  
  // Create a viem wallet client for polygon (to match our example)
  const client = createWalletClient({
    account,
    chain: polygon,
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
 * Perform a cross-chain swap
 * @param {Object} params - The swap parameters
 */
const performCrossChainSwap = async ({
  fromAddress,
  fromChain,
  toChain,
  fromToken,
  toToken,
  fromAmount,
  maxTimeoutMinutes = 30 // Default timeout of 30 minutes
}) => {
  // Validate parameters
  if (!fromChain) throw new Error("fromChain is required");
  if (!toChain) throw new Error("toChain is required");
  if (!fromToken) throw new Error("fromToken is required");
  if (!toToken) throw new Error("toToken is required");
  if (!fromAmount) throw new Error("fromAmount is required");
  if (!fromAddress) throw new Error("fromAddress is required");
  
  logger.log(`
Cross-Chain Swap Request:
- From Chain: ${fromChain}
- To Chain: ${toChain}
- From Token: ${fromToken}
- To Token: ${toToken}
- Amount: ${fromAmount}
- Sender: ${fromAddress}
- Max timeout: ${maxTimeoutMinutes} minutes
  `);
  
  try {
    logger.log('Getting quote for cross-chain swap...');
    
    // Get a quote for the swap
    const quote = await getQuote({
      fromChain,
      toChain,
      fromToken,
      toToken,
      fromAmount,
      fromAddress,
    });
    
    logger.log(`
Quote received:
- From: ${fromAmount} ${quote.action.fromToken.symbol} on ${quote.action.fromChainId}
- To: ~${quote.estimate.toAmount} ${quote.action.toToken.symbol} on ${quote.action.toChainId}
- Gas Cost: ${quote.estimate.gasCosts.reduce((total, cost) => total + BigInt(cost.amount), 0n)} (in wei)
- Execution Time: ~${quote.estimate.executionDuration} seconds
- Using: ${quote.tool}
    `);
    
    // Convert quote to route (necessary step for execution)
    logger.log('Converting quote to route...');
    const route = convertQuoteToRoute(quote);
    
    // Execute the swap
    logger.log('Executing cross-chain swap...');
    
    // Setup tracking variables for better logging and timeout handling
    let executionStartTime = Date.now();
    let lastStatusUpdate = {
      status: null,
      timestamp: 0,
      txHash: null,
      lastPrinted: 0
    };
    
    const timeoutMs = maxTimeoutMinutes * 60 * 1000;
    
    // Create a promise that resolves/rejects based on completion or timeout
    const executionPromise = executeRoute(route, {
      // This gets called when the route object is updated during execution
      updateRouteHook(updatedRoute) {
        // Check if we've exceeded the timeout
        if (Date.now() - executionStartTime > timeoutMs) {
          logger.error(`
⚠️ Cross-chain swap has exceeded the maximum timeout of ${maxTimeoutMinutes} minutes.
The transaction might still complete, but this script will exit.
You can check the status of your transaction using a blockchain explorer.
`);
          process.exit(1); // Exit with error code
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
    
    // Wait for the execution to complete
    const executedRoute = await executionPromise;
    
    logger.log(`
🎉 Swap executed successfully!
- Route ID: ${executedRoute.routeId}
- Status: ${executedRoute.status}
    `);
    
    // Print details about completed transactions
    executedRoute.steps.forEach((step, i) => {
      if (step.execution?.status === 'DONE') {
        const txProcess = step.execution.process.find(p => p.txHash);
        if (txProcess) {
          logger.log(`
Step ${i+1} completed:
- Transaction: ${txProcess.txHash}
- Explorer: ${txProcess.txLink || 'Not available'}
- Tool: ${step.tool}
          `);
        }
      }
    });
    
    return executedRoute;
  } catch (error) {
    logger.error('Error during cross-chain swap: ' + error.message);
    
    // Provide more detail for common errors
    if (error.message?.includes('slippage')) {
      logger.error('💡 The swap failed due to high price impact or slippage. Try reducing the amount or setting a higher slippage tolerance.');
    } else if (error.message?.includes('gas')) {
      logger.error('💡 The transaction failed due to gas estimation or gas fees. Ensure you have enough native tokens to cover gas.');
    } else if (error.message?.includes('user denied')) {
      logger.error('💡 The transaction was rejected by the user.');
    } else if (error.message?.includes('timeout')) {
      logger.error('💡 The transaction timed out. Check the bridge\'s explorer to see if it completed later.');
    }
    
    throw error;
  }
};

/**
 * Run the cross-chain swap example
 */
const runExample = async () => {
  try {
    // Initialize wallet
    const wallet = initializeWallet();
    
    // Configure SDK provider
    const { account } = configureSDKProvider(wallet);
    
    // Example: Swap from Polygon (MATIC) to BSC (BNB)
    const fromChainId = 137; // Polygon
    const toChainId = 56;    // BSC
    
    logger.log(`Setting up swap from Polygon to BSC`);
    
    // Perform the cross-chain swap
    await performCrossChainSwap({
      fromAddress: account.address,
      fromChain: fromChainId,
      toChain: toChainId,
      fromToken: '0x0000000000000000000000000000000000000000', // MATIC (native token)
      toToken: '0x0000000000000000000000000000000000000000', // BNB (native token)
      fromAmount: ethers.parseEther('0.1').toString(), // 0.1 MATIC (adjust as needed)
      maxTimeoutMinutes: 30 // Set a 30-minute maximum timeout
    });
    
    logger.log('Cross-chain swap completed successfully!');
  } catch (error) {
    logger.error('Failed to complete cross-chain swap: ' + error.message);
  }
};

// Run the example
runExample();

// Export functions for use in other scripts
export {
  initializeWallet,
  configureSDKProvider,
  performCrossChainSwap,
  runExample
};





