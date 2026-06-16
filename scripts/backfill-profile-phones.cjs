// Backfill profiles.phone for the recovered phones (from missing_phones_from_pdfs.csv).
// Phones are normalized to (XXX) XXX-XXXX and encrypted to match the existing convention.
// Only updates rows where profiles.phone is currently empty/null.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const CryptoJS = require('crypto-js');

const DRY_RUN = process.argv.includes('--dry-run');

const envPath = path.join(__dirname, '..', '.env.local');
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const KEY = env.ENCRYPTION_KEY;
if (!KEY || KEY.length < 32) { console.error('Missing/short ENCRYPTION_KEY'); process.exit(1); }
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const encrypt = (plain) =>
  CryptoJS.AES.encrypt(plain, KEY, { mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString();

function normalizePhone(raw) {
  let d = (raw || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return (raw || '').trim();
}

// minimal CSV parser for our simple, quoted file
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = [];
    let cur = '', inQ = false;
    const s = lines[i];
    for (let j = 0; j < s.length; j++) {
      const ch = s[j];
      if (inQ) {
        if (ch === '"' && s[j + 1] === '"') { cur += '"'; j++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { cells.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    cells.push(cur);
    rows.push({ email: cells[0], phone: cells[1], source: cells[2], note: cells[3] });
  }
  return rows;
}

(async () => {
  const csv = parseCsv(fs.readFileSync(path.join(__dirname, '..', 'missing_phones_from_pdfs.csv'), 'utf8'));
  const withPhone = csv.filter((r) => r.phone && r.phone.trim());
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Rows with phone: ${withPhone.length}`);

  const emails = withPhone.map((r) => r.email.toLowerCase());
  const { data: users } = await supabase.from('users').select('id,email').in('email', emails);
  const idByEmail = new Map((users || []).map((u) => [u.email.toLowerCase(), u.id]));

  let updated = 0, skippedHasPhone = 0, noUser = 0, noProfile = 0, errors = 0;
  for (const r of withPhone) {
    const email = r.email.toLowerCase();
    const uid = idByEmail.get(email);
    if (!uid) { console.log(`NO-USER     ${email}`); noUser++; continue; }

    const { data: prof, error: pErr } = await supabase
      .from('profiles').select('user_id, phone').eq('user_id', uid).maybeSingle();
    if (pErr) { console.log(`ERR-READ    ${email}: ${pErr.message}`); errors++; continue; }
    if (!prof) { console.log(`NO-PROFILE  ${email}`); noProfile++; continue; }
    if (prof.phone && String(prof.phone).trim()) { console.log(`SKIP-HAS    ${email}`); skippedHasPhone++; continue; }

    const normalized = normalizePhone(r.phone);
    const enc = encrypt(normalized);
    if (DRY_RUN) { console.log(`WOULD-SET   ${email.padEnd(40)} ${normalized}`); updated++; continue; }

    const { error: uErr } = await supabase.from('profiles').update({ phone: enc }).eq('user_id', uid);
    if (uErr) { console.log(`ERR-WRITE   ${email}: ${uErr.message}`); errors++; continue; }
    console.log(`SET         ${email.padEnd(40)} ${normalized}`);
    updated++;
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Done. updated=${updated} skipped_has_phone=${skippedHasPhone} no_profile=${noProfile} no_user=${noUser} errors=${errors}`);
  process.exit(0);
})();
