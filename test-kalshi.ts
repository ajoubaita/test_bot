import * as crypto from 'crypto';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import WebSocket from 'ws';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

dotenv.config();

// Configure proxy if available
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

if (proxyAgent) {
  console.log('Using proxy:', proxyUrl.split('@')[1] || 'configured');
}

// Load credentials
const apiKey = process.env.KALSHI_API_KEY;
const privateKeyPath = process.env.KALSHI_PRIVATE_KEY || './KalshiPK.txt';
const privateKey = fs.readFileSync(privateKeyPath, 'utf-8').trim();

console.log('=== KALSHI CONNECTION TEST ===\n');
console.log('API Key:', apiKey?.substring(0, 8) + '...');
console.log('Private Key loaded:', privateKey?.length, 'characters');
console.log('Private Key preview:', privateKey?.substring(0, 50) + '...\n');

// Test signature generation using RSA-PSS (required by Kalshi)
function generateSignature(timestamp: string, method: string, path: string): string {
  try {
    const message = timestamp + method + path;

    // Sign using RSA-PSS (NOT HMAC - Kalshi uses asymmetric signing)
    const sign = crypto.createSign('SHA256');
    sign.update(message);
    sign.end();

    // Use RSA-PSS padding
    const signature = sign.sign({
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    });

    return signature.toString('base64');
  } catch (error: any) {
    console.error('Error generating RSA-PSS signature:', error.message);
    throw error;
  }
}

// Test 1: REST API authentication
async function testRestAPI() {
  console.log('=== TEST 1: REST API ===');
  const timestamp = Date.now().toString();
  const method = 'GET';
  const path = '/trade-api/v2/markets';
  const signature = generateSignature(timestamp, method, path);

  console.log('Request:');
  console.log('  Method:', method);
  console.log('  Path:', path);
  console.log('  Timestamp:', timestamp);
  console.log('  Signature:', signature.substring(0, 20) + '...');

  try {
    const response = await axios.get(`https://api.elections.kalshi.com${path}`, {
      headers: {
        'KALSHI-ACCESS-KEY': apiKey!,
        'KALSHI-ACCESS-SIGNATURE': signature,
        'KALSHI-ACCESS-TIMESTAMP': timestamp,
      },
      params: { limit: 5 },
      httpsAgent: proxyAgent,
    });

    console.log('✅ REST API SUCCESS');
    console.log('Status:', response.status);
    console.log('Markets found:', response.data.markets?.length || 0);
    if (response.data.markets?.length > 0) {
      console.log('Sample market:', response.data.markets[0].ticker);
    }
    return true;
  } catch (error: any) {
    console.log('❌ REST API FAILED');
    console.log('Status:', error.response?.status);
    console.log('Error:', error.response?.data || error.message);
    return false;
  }
}

// Test 2: WebSocket connection
async function testWebSocket() {
  console.log('\n=== TEST 2: WEBSOCKET ===');

  return new Promise((resolve, reject) => {
    const timestamp = Date.now().toString();
    const signature = generateSignature(timestamp, 'GET', '/trade-api/ws/v2');

    console.log('WebSocket URL: wss://api.elections.kalshi.com/trade-api/ws/v2');
    console.log('Timestamp:', timestamp);
    console.log('Signature:', signature.substring(0, 20) + '...');

    const wsOptions: any = {
      headers: {
        'KALSHI-ACCESS-KEY': apiKey!,
        'KALSHI-ACCESS-SIGNATURE': signature,
        'KALSHI-ACCESS-TIMESTAMP': timestamp,
      },
    };

    if (proxyAgent) {
      wsOptions.agent = proxyAgent;
    }

    const ws = new WebSocket('wss://api.elections.kalshi.com/trade-api/ws/v2', wsOptions);

    ws.on('open', () => {
      console.log('✅ WEBSOCKET CONNECTED');
      ws.close();
      resolve(true);
    });

    ws.on('message', (data) => {
      console.log('📨 Message:', data.toString().substring(0, 100));
    });

    ws.on('error', (error) => {
      console.log('❌ WEBSOCKET ERROR:', error.message);
      reject(error);
    });

    ws.on('close', (code, reason) => {
      console.log('WebSocket closed');
      console.log('  Code:', code);
      console.log('  Reason:', reason.toString() || 'No reason provided');

      if (code === 1000) {
        resolve(true);
      } else {
        reject(new Error(`WebSocket closed with code ${code}`));
      }
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.log('❌ WEBSOCKET TIMEOUT');
        ws.close();
        reject(new Error('Connection timeout'));
      }
    }, 5000);
  });
}

// Run tests
async function runTests() {
  try {
    const restOk = await testRestAPI();

    if (restOk) {
      await testWebSocket();
    } else {
      console.log('\n⚠️ Skipping WebSocket test due to REST API failure');
      console.log('\n=== DIAGNOSIS ===');
      console.log('Issue: REST API authentication failed');
      console.log('Possible causes:');
      console.log('  1. Invalid API key or private key');
      console.log('  2. Incorrect signature generation');
      console.log('  3. Key file format issue (check for extra spaces/newlines)');
    }
  } catch (error: any) {
    console.log('\n=== ERROR ===');
    console.log(error.message);

    console.log('\n=== DIAGNOSIS ===');
    console.log('Issue: WebSocket connection failed');
    console.log('Possible causes:');
    console.log('  1. WebSocket endpoint doesn\'t support authenticated connections');
    console.log('  2. Different signature format required for WebSocket');
    console.log('  3. API key doesn\'t have WebSocket permissions');
    console.log('  4. Kalshi WebSocket may require different auth flow');
  }

  console.log('\n=== RECOMMENDATIONS ===');
  console.log('1. Verify credentials at: https://kalshi.com/docs/');
  console.log('2. Check if private key file has extra whitespace');
  console.log('3. Confirm API key has WebSocket access enabled');
  console.log('4. Try generating new API credentials');
}

runTests().catch(console.error);
