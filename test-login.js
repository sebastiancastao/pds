// Test Login Flow
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

// Create regular client (like the browser does)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Create admin client
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testLogin() {
  const email = process.argv[2];
  const password = process.argv[3];

  if (!email || !password) {
    console.log('Usage: node test-login.js <email> <password>');
    process.exit(1);
  }

  console.log('\n🔐 Testing Login Flow for:', email);
  console.log('═'.repeat(60));

  // Step 1: Check user exists in database
  console.log('\n[STEP 1] Checking user in database...');
  const { data: userData, error: userError } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (userError) {
    console.log('❌ User not found in database:', userError.message);
    process.exit(1);
  }

  console.log('✅ User found in database');
  console.log('   - ID:', userData.id);
  console.log('   - Active:', userData.is_active);
  console.log('   - Locked:', userData.account_locked_until || 'No');
  console.log('   - Failed attempts:', userData.failed_login_attempts || 0);

  // Step 2: Check if account is locked
  if (userData.account_locked_until) {
    const lockTime = new Date(userData.account_locked_until);
    if (lockTime > new Date()) {
      console.log('❌ ACCOUNT IS LOCKED until:', lockTime.toLocaleString());
      process.exit(1);
    }
  }

  // Step 3: Check if account is active
  if (!userData.is_active) {
    console.log('❌ ACCOUNT IS INACTIVE');
    process.exit(1);
  }

  // Step 4: Try to authenticate with Supabase Auth
  console.log('\n[STEP 2] Attempting Supabase authentication...');

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: email.toLowerCase().trim(),
    password: password,
  });

  if (authError) {
    console.log('❌ AUTHENTICATION FAILED');
    console.log('   Error:', authError.message);
    console.log('   Code:', authError.status);

    if (authError.message.includes('Invalid login credentials')) {
      console.log('\n💡 The password is incorrect or the user does not exist in Supabase Auth.');
      console.log('   This means:');
      console.log('   - The password you entered does not match what\'s in Supabase Auth');
      console.log('   - OR the user was not created properly in Supabase Auth');
      console.log('\n   To fix this, you need to reset the password in Supabase Auth.');
    }

    process.exit(1);
  }

  console.log('✅ AUTHENTICATION SUCCESSFUL!');
  console.log('   - User ID:', authData.user?.id);
  console.log('   - Email:', authData.user?.email);
  console.log('   - Session exists:', !!authData.session);

  // Step 5: Check profile
  console.log('\n[STEP 3] Checking profile...');
  const { data: profileData, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('user_id', authData.user.id)
    .single();

  if (profileError) {
    console.log('⚠️  Profile not found:', profileError.message);
  } else {
    console.log('✅ Profile found');
    console.log('   - MFA Enabled:', profileData.mfa_enabled || false);
    console.log('   - MFA Secret exists:', !!profileData.mfa_secret);
  }

  console.log('\n═'.repeat(60));
  console.log('✅ LOGIN TEST COMPLETED SUCCESSFULLY!');
  console.log('The login system is working. The issue was likely:');
  console.log('   - Wrong password');
  console.log('   - Account was locked (4 failed attempts)');
  console.log('\n');

  // Sign out
  await supabase.auth.signOut();
  process.exit(0);
}

testLogin().catch(error => {
  console.error('\n❌ ERROR:', error.message);
  process.exit(1);
});
