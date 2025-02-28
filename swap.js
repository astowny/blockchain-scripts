// crosschain-swap.js
import { createConfig, EVM, ChainId, getQuote, executeOrder, config } from '@lifi/sdk';
import { ethers } from 'ethers';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, arbitrum, optimism, polygon, bsc } from 'viem/chains';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

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
  
  // Create a viem wallet client for the initial chain (mainnet)
  const client = createWalletClient({
    account,
    chain: mainnet,
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
  
  return { account, wallet };
};

/**
 * Perform a cross-chain swap
 * @param {Object} params - The swap parameters
 * @param {string} params.fromAddress - The sender address
 * @param {ChainId} params.fromChain - The source chain ID
 * @param {ChainId} params.toChain - The destination chain ID
 * @param {string} params.fromToken - The token address to swap from
 * @param {string} params.toToken - The token address to swap to
 * @param {string} params.fromAmount - The amount to swap (as a string)
 * @returns {Promise<Object>} The result of the swap
 */
const performCrossChainSwap = async ({
  fromAddress,
  fromChain,
  toChain,
  fromToken,
  toToken,
  fromAmount
}) => {
  console.log(`
Cross-Chain Swap Request:
- From Chain: ${fromChain}
- To Chain: ${toChain}
- From Token: ${fromToken}
- To Token: ${toToken}
- Amount: ${fromAmount}
- Sender: ${fromAddress}
  `);
  
  console.log('Getting quote for cross-chain swap...');
  
  try {
    // Get a quote for the swap
    const quote = await getQuote({
      fromAddress,
      fromChain,
      toChain,
      fromToken,
      toToken,
      fromAmount,
    });
    
    console.log(`
Quote received:
- From: ${fromAmount} ${quote.action.fromToken.symbol} on ${quote.action.fromChainId}
- To: ~${quote.estimate.toAmount} ${quote.action.toToken.symbol} on ${quote.action.toChainId}
- Gas Cost: ${quote.estimate.gasCosts.reduce((total, cost) => total + BigInt(cost.amount), 0n)} (in wei)
- Execution Time: ~${quote.estimate.executionDuration} seconds
    `);
    
    // Execute the swap
    console.log('Executing cross-chain swap...');
    
    const result = await executeOrder(quote);
    
    console.log(`
Swap executed successfully!
- Transaction Hash: ${result.transactionHash}
- Status: ${result.status}
    `);
    
    return result;
  } catch (error) {
    console.error('Error during cross-chain swap:', error);
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
    console.log('Wallet initialized with address:', wallet.address);
    
    // Configure SDK provider
    const { account } = configureSDKProvider(wallet);
    console.log('SDK provider configured with account:', account.address);
    
    // Perform a cross-chain swap (example: swap ETH on Arbitrum to USDC on Optimism)
    const result = await performCrossChainSwap({
      fromAddress: account.address,
      fromChain: ChainId.POL, // Arbitrum
      toChain: ChainId.BNB, // Optimism
      fromToken: '0x0000000000000000000000000000000000000000', // ETH (native token)
      toToken: '0x0000000000000000000000000000000000000000', // USDC on Optimism
      fromAmount: ethers.parseEther('7').toString(), // 0.01 ETH
    });
    
    console.log('Cross-chain swap completed successfully!');
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error running example:', error);
  }
};
runExample()

// Export functions for use in other scripts
export {
  initializeWallet,
  configureSDKProvider,
  performCrossChainSwap,
  runExample
};





