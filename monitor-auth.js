// Monitor Supabase Auth Recovery
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Read .env.local manually
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

console.log('🔍 Monitoring Supabase Auth service...');
console.log('Press Ctrl+C to stop\n');

let checkCount = 0;

async function checkAuth() {
  checkCount++;
  const timestamp = new Date().toLocaleTimeString();

  try {
    const authUrl = `${supabaseUrl}/auth/v1/health`;
    const response = await fetch(authUrl, {
      headers: { 'apikey': supabaseAnonKey },
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });

    if (response.ok) {
      console.log(`[${timestamp}] ✅ Auth service is HEALTHY (Status: ${response.status})`);
      console.log('\n🎉 AUTH SERVICE IS BACK ONLINE!');
      console.log('You can now try logging in again.\n');
      process.exit(0);
    } else {
      console.log(`[${timestamp}] ⚠️  Auth service returned: ${response.status} (Check #${checkCount})`);
    }
  } catch (error) {
    console.log(`[${timestamp}] ❌ Auth service unavailable: ${error.message} (Check #${checkCount})`);
  }
}

// Check immediately
checkAuth();

// Then check every 10 seconds
setInterval(checkAuth, 10000);
