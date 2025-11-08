const WebSocket = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');

console.log('=== POLYMARKET WEBSOCKET TEST ===\n');

// Test 1: Without proxy
console.log('TEST 1: Direct connection (no proxy)');
const ws1 = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');

ws1.on('open', () => {
  console.log('✅ SUCCESS: Direct connection worked');
  ws1.close();
});

ws1.on('error', (error) => {
  console.log('❌ FAILED: Direct connection');
  console.log('Error:', error.message);
  console.log('\n');

  // Test 2: With proxy
  console.log('TEST 2: Connection through proxy');
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxyUrl) {
    console.log('❌ No proxy configured');
    return;
  }

  const proxyAgent = new HttpsProxyAgent(proxyUrl);
  const ws2 = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market', {
    agent: proxyAgent
  });

  ws2.on('open', () => {
    console.log('✅ SUCCESS: Proxy connection worked');
    ws2.close();
  });

  ws2.on('error', (error) => {
    console.log('❌ FAILED: Proxy connection');
    console.log('Error:', error.message);
  });

  ws2.on('close', (code, reason) => {
    console.log('Connection closed:', code, reason.toString());
  });
});

ws1.on('close', (code, reason) => {
  console.log('Direct connection closed:', code, reason.toString());
});
