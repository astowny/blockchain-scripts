const { checkTokenLiquidity, ALL_TOKENS, SUPPORTED_CHAINS, configureLogging } = require('./defi');
const path = require('path');
const fs = require('fs');

describe('Liquidity Scanner Tests', () => {
  beforeAll(() => {
    // Configurer le niveau de log pour les tests
    configureLogging('debug');
    
    // Créer le dossier logs s'il n'existe pas
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  });

  test('SUPPORTED_CHAINS should contain expected chains', () => {
    expect(SUPPORTED_CHAINS).toHaveProperty('1', 'ETHEREUM');
    expect(SUPPORTED_CHAINS).toHaveProperty('137', 'POLYGON');
  });

  test('ALL_TOKENS should contain essential tokens', () => {
    const tokens = ALL_TOKENS.map(t => t.name);
    expect(tokens).toContain('Wrapped Ether');
    expect(tokens).toContain('USD Coin');
  });

  test('checkTokenLiquidity should work for USDC on Ethereum', async () => {
    const result = await checkTokenLiquidity(
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
      1 // Ethereum
    );
    expect(result).toHaveProperty('token');
    expect(result).toHaveProperty('chainId');
    expect(result).toHaveProperty('protocols');
  }, 30000); // Timeout de 30 secondes

  test('checkTokenLiquidity should handle invalid tokens gracefully', async () => {
    const result = await checkTokenLiquidity(
      '0x0000000000000000000000000000000000000000',
      1
    );
    expect(result).toHaveProperty('chainId', 1);
  });
});