// Try different approaches to fix Supabase Auth connection
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

console.log('🔧 Attempting to fix Supabase Auth connection...\n');

async function attemptFix() {
  // Attempt 1: Clear any stale connections
  console.log('[ATTEMPT 1] Creating fresh Supabase client...');
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: (url, options = {}) => {
        // Add custom headers and longer timeout
        return fetch(url, {
          ...options,
          headers: {
            ...options.headers,
            'Cache-Control': 'no-cache',
          },
          signal: AbortSignal.timeout(30000), // 30 second timeout
        });
      },
    },
  });

  console.log('[ATTEMPT 2] Testing Auth with extended timeout...');

  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      if (error.status === 503) {
        console.log('❌ Still getting 503 error');
        console.log('\n📋 This is a Supabase infrastructure issue. Here are your options:\n');
        console.log('1. Restart your Supabase project:');
        console.log('   → Go to: https://supabase.com/dashboard/project/bwvnvzlmqqcdemkpecjw/settings/general');
        console.log('   → Scroll down and click "Restart project"\n');
        console.log('2. Check Supabase status:');
        console.log('   → Visit: https://status.supabase.com\n');
        console.log('3. Contact Supabase support:');
        console.log('   → Go to: https://supabase.com/dashboard/support/new\n');
        console.log('4. Wait 5-10 minutes and try again (services may auto-recover)\n');

        return false;
      } else {
        console.log('⚠️  Different error:', error.message);
        return false;
      }
    }

    console.log('✅ Auth service is responding!');

    // Attempt 3: Try actual login
    console.log('[ATTEMPT 3] Testing actual authentication...');
    const testResult = await supabase.auth.signInWithPassword({
      email: 'test@test.com',
      password: 'test123',
    });

    if (testResult.error) {
      if (testResult.error.message.includes('Invalid login credentials')) {
        console.log('✅ Auth service is WORKING! (Test credentials rejected as expected)');
        console.log('\n🎉 The Auth service is now operational!');
        console.log('You can try logging in with your real credentials now.\n');
        return true;
      } else if (testResult.error.status === 503) {
        console.log('❌ Still getting 503 on login attempts');
        return false;
      } else {
        console.log('⚠️  Unexpected error:', testResult.error.message);
        return false;
      }
    }

    console.log('✅ Auth appears to be working');
    return true;

  } catch (err) {
    console.log('❌ Error during test:', err.message);
    return false;
  }
}

attemptFix().then(success => {
  if (success) {
    process.exit(0);
  } else {
    process.exit(1);
  }
});
