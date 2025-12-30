// Reset Failed Login Attempts
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

async function resetLoginAttempts() {
  const email = process.argv[2];

  if (!email) {
    console.log('Usage: node reset-login-attempts.js <email>');
    process.exit(1);
  }

  console.log(`\n🔄 Resetting failed login attempts for: ${email}\n`);

  const { data, error } = await supabase
    .from('users')
    .update({
      failed_login_attempts: 0,
      account_locked_until: null
    })
    .eq('email', email.toLowerCase().trim())
    .select()
    .single();

  if (error) {
    console.log('❌ Error:', error.message);
    process.exit(1);
  }

  console.log('✅ Successfully reset login attempts!');
  console.log(`   Failed attempts: ${data.failed_login_attempts}`);
  console.log(`   Account locked: ${data.account_locked_until || 'No'}\n`);
  console.log('💡 You can now try logging in again.\n');

  process.exit(0);
}

resetLoginAttempts().catch(console.error);
