// Check the 2 unresolved users: what forms (with data) do they have, and i9 phone field?
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { PDFDocument } = require('pdf-lib');

const envPath = path.join(__dirname, '..', '.env.local');
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const toBytes = (d) => (typeof d === 'string' ? (d.startsWith('\\x') ? Buffer.from(d.slice(2), 'hex') : Buffer.from(d, 'base64')) : null);

(async () => {
  const emails = ['mariasolozabal12@gmail.com', 'sebastiancastanosepul@gmail.com'];
  const { data: users } = await supabase.from('users').select('id,email').in('email', emails);
  for (const u of users) {
    const { data: rows } = await supabase.from('pdf_form_progress').select('form_name, form_data').eq('user_id', u.id);
    console.log(`\n=== ${u.email} ===`);
    for (const r of rows || []) {
      const len = r.form_data ? String(r.form_data).length : 0;
      let tel = '';
      if (len && /(^|-)i9$/i.test(r.form_name)) {
        try { tel = (await PDFDocument.load(toBytes(r.form_data), { ignoreEncryption: true })).getForm().getTextField('Telephone Number').getText() || ''; } catch (e) { tel = 'ERR:' + e.message; }
      }
      console.log(`  ${r.form_name.padEnd(28)} len=${len}${tel ? '  TEL=' + tel : ''}`);
    }
  }
  process.exit(0);
})();
