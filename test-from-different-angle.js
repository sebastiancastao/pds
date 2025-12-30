// Test Supabase Auth from different angles
const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Read .env.local
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const envLines = envContent.split('\n');

envLines.forEach(line => {
  const trimmedLine = line.trim();
  if (trimmedLine && !trimmedLine.startsWith('#')) {
    const [key, ...valueParts] = trimmedLine.split('=');
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  }
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log('🧪 Testing Supabase Auth from different angles...\n');

// Test 1: Raw HTTPS request (bypass Supabase client)
async function testRawHTTPS() {
  console.log('[TEST 1] Raw HTTPS request to Auth endpoint...');

  return new Promise((resolve) => {
    const url = new URL(`${supabaseUrl}/auth/v1/token?grant_type=password`);

    const postData = JSON.stringify({
      email: 'test@test.com',
      password: 'test123'
    });

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log('   Status:', res.statusCode);

        if (res.statusCode === 503) {
          console.log('   ❌ 503 Service Unavailable - Auth backend is down');
        } else if (res.statusCode === 400) {
          console.log('   ✅ Auth is responding (400 = bad credentials, which is expected)');
        } else {
          console.log('   Response:', data.substring(0, 200));
        }
        resolve(res.statusCode);
      });
    });

    req.on('error', (error) => {
      console.log('   ❌ Connection error:', error.message);
      resolve(null);
    });

    req.on('timeout', () => {
      console.log('   ❌ Request timeout');
      req.destroy();
      resolve(null);
    });

    req.write(postData);
    req.end();
  });
}

// Test 2: Try with different DNS
async function testDNS() {
  console.log('\n[TEST 2] Checking DNS resolution...');

  const dns = require('dns').promises;
  const hostname = new URL(supabaseUrl).hostname;

  try {
    const addresses = await dns.resolve4(hostname);
    console.log('   ✅ DNS resolves to:', addresses.join(', '));
    return true;
  } catch (error) {
    console.log('   ❌ DNS resolution failed:', error.message);
    return false;
  }
}

// Test 3: Check if it's a regional issue
async function testFromPublicAPI() {
  console.log('\n[TEST 3] Testing if Auth endpoint is accessible...');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: { 'apikey': supabaseAnonKey },
      signal: controller.signal
    });

    clearTimeout(timeout);

    console.log('   Status:', response.status);

    if (response.status === 503) {
      const text = await response.text();
      console.log('   ❌ Auth service is down');
      console.log('   Error:', text.substring(0, 200));

      // Check if it mentions upstream
      if (text.includes('upstream')) {
        console.log('\n   💡 This is a Supabase backend issue (upstream connection error)');
        console.log('   The Auth service cannot connect to its database/backend');
      }
      return false;
    } else {
      console.log('   ✅ Auth endpoint is accessible');
      return true;
    }
  } catch (error) {
    console.log('   ❌ Error:', error.message);
    return false;
  }
}

async function runAllTests() {
  const dnsOk = await testDNS();
  const httpsStatus = await testRawHTTPS();
  const publicApiOk = await testFromPublicAPI();

  console.log('\n' + '═'.repeat(60));
  console.log('📊 DIAGNOSIS:\n');

  if (!dnsOk) {
    console.log('❌ DNS ISSUE: Cannot resolve Supabase hostname');
    console.log('   → Try flushing DNS: ipconfig /flushdns');
    console.log('   → Try different network (mobile hotspot)');
  } else if (httpsStatus === 503) {
    console.log('❌ SUPABASE AUTH BACKEND IS DOWN');
    console.log('   → This is NOT your fault');
    console.log('   → This is a Supabase infrastructure issue');
    console.log('\n   RECOMMENDED ACTIONS:');
    console.log('   1. Restart your Supabase project (safest option)');
    console.log('   2. Wait 30-60 minutes for auto-recovery');
    console.log('   3. Contact Supabase support if issue persists\n');
  } else if (httpsStatus === 400) {
    console.log('✅ AUTH IS WORKING!');
    console.log('   → You can try logging in now');
  } else {
    console.log('⚠️  UNCLEAR ISSUE');
    console.log('   → Try restarting Supabase project');
  }

  console.log('═'.repeat(60) + '\n');
}

runAllTests();
