// User Status Diagnostic Script
// Run this to check your account status in the database

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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkUserStatus() {
  const email = process.argv[2];

  if (!email) {
    console.log('Usage: node check-user-status.js <email>');
    console.log('Example: node check-user-status.js user@example.com');
    process.exit(1);
  }

  console.log(`\n🔍 Checking status for: ${email}\n`);

  // Check users table
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (userError) {
    console.log('❌ Error fetching user:', userError.message);
    if (userError.code === 'PGRST116') {
      console.log('⚠️  User not found in database');
    }
    process.exit(1);
  }

  console.log('✅ User found in database\n');
  console.log('📊 User Details:');
  console.log('─'.repeat(50));
  console.log(`ID: ${userData.id}`);
  console.log(`Email: ${userData.email}`);
  console.log(`Role: ${userData.role}`);
  console.log(`Active: ${userData.is_active ? '✅ Yes' : '❌ No'}`);
  console.log(`Temporary Password: ${userData.is_temporary_password ? '⚠️  Yes' : '✅ No'}`);
  console.log(`Must Change Password: ${userData.must_change_password ? '⚠️  Yes' : '✅ No'}`);
  console.log(`Failed Login Attempts: ${userData.failed_login_attempts || 0}`);

  if (userData.account_locked_until) {
    const lockTime = new Date(userData.account_locked_until);
    const now = new Date();
    if (lockTime > now) {
      const minutesRemaining = Math.ceil((lockTime - now) / 60000);
      console.log(`🔒 Account Locked: Until ${lockTime.toLocaleString()} (${minutesRemaining} minutes remaining)`);
    } else {
      console.log(`🔓 Account Lock Expired: ${lockTime.toLocaleString()}`);
    }
  } else {
    console.log('🔓 Account Lock: None');
  }

  console.log(`Background Check Completed: ${userData.background_check_completed ? '✅ Yes' : '❌ No'}`);
  console.log(`Created: ${new Date(userData.created_at).toLocaleString()}`);
  console.log('─'.repeat(50));

  // Check Supabase Auth
  console.log('\n🔐 Checking Supabase Auth...\n');
  const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();

  if (authError) {
    console.log('❌ Error checking auth:', authError.message);
  } else {
    const authUser = authUsers.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (authUser) {
      console.log('✅ User exists in Supabase Auth');
      console.log(`Auth ID: ${authUser.id}`);
      console.log(`Email Confirmed: ${authUser.email_confirmed_at ? '✅ Yes' : '❌ No'}`);
      console.log(`Last Sign In: ${authUser.last_sign_in_at ? new Date(authUser.last_sign_in_at).toLocaleString() : 'Never'}`);
    } else {
      console.log('⚠️  User not found in Supabase Auth');
    }
  }

  console.log('\n💡 Recommendations:\n');

  if (!userData.is_active) {
    console.log('❌ Account is INACTIVE. Contact admin to activate.');
  }

  if (userData.account_locked_until && new Date(userData.account_locked_until) > new Date()) {
    console.log('🔒 Account is LOCKED. Wait for lockout to expire or contact admin.');
  }

  if (userData.failed_login_attempts >= 3) {
    console.log(`⚠️  ${userData.failed_login_attempts} failed login attempts. ${5 - userData.failed_login_attempts} attempts remaining.`);
  }

  if (userData.is_temporary_password) {
    console.log('⚠️  Using temporary password. You will be asked to change it after login.');
  }

  console.log('\n');
  process.exit(0);
}

checkUserStatus().catch(console.error);
