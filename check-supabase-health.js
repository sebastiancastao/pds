// Check Supabase Health
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
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('\n🏥 Supabase Health Check');
console.log('═'.repeat(60));

console.log('\n[CONFIG]');
console.log('URL:', supabaseUrl);
console.log('Anon Key:', supabaseAnonKey ? '✅ Set (' + supabaseAnonKey.substring(0, 20) + '...)' : '❌ Missing');
console.log('Service Key:', supabaseServiceKey ? '✅ Set (' + supabaseServiceKey.substring(0, 20) + '...)' : '❌ Missing');

async function checkHealth() {
  try {
    // Test 1: Check if we can reach Supabase
    console.log('\n[TEST 1] Checking Supabase connectivity...');
    const response = await fetch(supabaseUrl);
    console.log('   Status:', response.status);
    console.log('   ✅ Supabase URL is reachable');

    // Test 2: Check database access with service role
    console.log('\n[TEST 2] Testing database access...');
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id')
      .limit(1);

    if (error) {
      console.log('   ❌ Database query failed:', error.message);
    } else {
      console.log('   ✅ Database is accessible');
    }

    // Test 3: Check Auth service
    console.log('\n[TEST 3] Testing Auth service...');
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Try to get session (should return null if not logged in)
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      console.log('   ❌ Auth service error:', sessionError.message);
    } else {
      console.log('   ✅ Auth service is responding');
      console.log('   Current session:', sessionData.session ? 'Active' : 'None (expected)');
    }

    // Test 4: Check if Auth endpoint is accessible
    console.log('\n[TEST 4] Testing Auth endpoint directly...');
    const authUrl = `${supabaseUrl}/auth/v1/health`;
    try {
      const authResponse = await fetch(authUrl, {
        headers: {
          'apikey': supabaseAnonKey
        }
      });
      console.log('   Auth health status:', authResponse.status);

      if (authResponse.ok) {
        const healthData = await authResponse.json();
        console.log('   ✅ Auth service is healthy');
        console.log('   Response:', healthData);
      } else {
        console.log('   ⚠️  Auth service returned:', authResponse.status, authResponse.statusText);
        const errorText = await authResponse.text();
        console.log('   Error:', errorText);
      }
    } catch (authError) {
      console.log('   ❌ Cannot reach auth endpoint:', authError.message);
    }

    // Test 5: Check for rate limiting
    console.log('\n[TEST 5] Checking for rate limiting...');
    const testEmail = 'test@example.com';
    const testPassword = 'TestPassword123!';

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    });

    if (signInError) {
      if (signInError.status === 503) {
        console.log('   ⚠️  503 Service Unavailable - Supabase Auth is down or overloaded');
        console.log('   This is a Supabase infrastructure issue, not your application');
      } else if (signInError.status === 429) {
        console.log('   ⚠️  429 Too Many Requests - Rate limited');
      } else if (signInError.message.includes('Invalid login credentials')) {
        console.log('   ✅ Auth service is working (test credentials rejected as expected)');
      } else {
        console.log('   Error:', signInError.status, signInError.message);
      }
    } else {
      console.log('   ⚠️  Unexpected: Test login succeeded (this should not happen)');
    }

    console.log('\n═'.repeat(60));
    console.log('Health check complete\n');

  } catch (error) {
    console.error('\n❌ Health check failed:', error.message);
  }
}

checkHealth();
