// Extract employee phone for the 91 missing-phone users from their onboarding PDFs.
// Primary source: I-9 Section 1 "Telephone Number". Guarded fallback: other forms.
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
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const MISSING = ['addiet77@aol.com','agamer4619@gmail.com','alanv44@icloud.com','alexandroskennedy2@gmail.com','amas1221@yahoo.com','amerson269@yahoo.com','amschae@yahoo.com','ashleymwaples@gmail.com','avawood081505@gmail.com','bk102709@gmail.com','bostfin@yahoo.com','brianhartley6@gmail.com','cannont2007@gmail.com','carlos.avalos@spartanlendingteam.com','cberges13@yahoo.com','chloethrasher03@gmail.com','cncb99@gmail.com','coltthrasher2007@outlook.com','connerweisz@gmail.com','cummings@cbaalbany.org','cwoodchrissy@gmail.com','daddywood1231@gmail.com','dom.elwell@gmail.com','donlalo13@hotmail.com','dylanthrasher03@gmail.com','eberges13@yahoo.com','ericka.richards22@gmail.com','evaldezc21@gmail.com','geotty@yahoo.com','gera0005@gmail.com','gmoney21202@aol.com','haleyksibley@gmail.com','jasonbageljoseph@gmail.com','jberges13@aol.com','jcmharley@gmail.com','jcoyne27@yahoo.com','jen5454@gmail.com','jitsinggh@gmail.com','jmszaszfai@aol.com','johnadriance@yahoo.com','jrazz0812@yahoo.com','kahrizmak@gmail.com','kaia123102@gmail.com','keegan.delaney62@gmail.com','kirkendallcade@gmail.com','kirkendallse@gmail.com','kolth004@gmail.com','kyriabutcher@gmail.com','laurenthrasher2023@gmail.com','leelee.goralski@gmail.com','lmkline27@gmail.com','mariasolozabal12@gmail.com','mathew.hautala@gmail.com','mbott56@gmail.com','mdaye76@gmail.com','mebarry22@gmail.com','megkatherine37@gmail.com','miaquinonez03@gmail.com','misschrissaz@yahoo.com','mlecuyer71808@yahoo.com','mmorrell888@yahoo.com','msilver161@gmail.com','mswrobel117@gmail.com','murgasteph89@gmail.com','niaosorio10@gmail.com','nickmgraham16@gmail.com','nickorozco1@gmail.com','oreillycmx@gmail.com','pachuca916@yahoo.com','pbutcher1@msn.com','pfox1387@gmail.com','pgins@yahoo.com','poboy66@msn.com','rachaelgurrola123456@gmail.com','rydog811@gmail.com','s.p.flanagan1@gmail.com','scordova16@gmail.com','sdanahy@nycap.rr.com','sebastiancastanosepul@gmail.com','sierarose2004@gmail.com','stephaniemarilyn1654@gmail.com','sydtthomas33@gmail.com','tbeeler23@gmail.com','theebigkj@gmail.com','thrasher_brooke@yahoo.com','tiakiphart89@gmail.com','tkwharley3@yahoo.com','trina.hautala@gmail.com','uhidntknw@aol.com','waronaren@gmail.com','wpgraham27@gmail.com'];

function toBytes(formData) {
  if (!formData) return null;
  if (typeof formData === 'string') {
    if (formData.startsWith('\\x')) return Buffer.from(formData.slice(2), 'hex');
    return Buffer.from(formData, 'base64');
  }
  return null;
}

const digits = (s) => (s || '').replace(/\D/g, '');
function looksLikePhone(v) {
  const d = digits(v);
  return d.length === 10 || (d.length === 11 && d.startsWith('1'));
}
// field names we must NOT trust as the employee's own phone
const EMPLOYER_HINT = /employer|hiring|insurance|carrier|peo|organization|business|company|emergency/i;

async function loadForm(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getForm();
}
function fieldValue(f) {
  try { if (typeof f.getText === 'function') return (f.getText() || '').trim(); } catch {}
  return '';
}

(async () => {
  const { data: users } = await supabase
    .from('users')
    .select('id,email')
    .in('email', MISSING);
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

  const results = [];
  for (const email of MISSING) {
    const uid = byEmail.get(email);
    if (!uid) { results.push({ email, phone: '', source: '', note: 'no user' }); continue; }

    const { data: rows } = await supabase
      .from('pdf_form_progress')
      .select('form_name, form_data, updated_at')
      .eq('user_id', uid)
      .order('updated_at', { ascending: false });

    const haveData = (rows || []).filter((r) => r.form_data && String(r.form_data).length > 0);
    let phone = '', source = '', note = '';

    // 1) Prefer any I-9 variant: trust the field literally named "Telephone Number"
    const i9s = haveData.filter((r) => /(^|-)i9$/i.test(r.form_name));
    for (const r of i9s) {
      try {
        const form = await loadForm(toBytes(r.form_data));
        let v = '';
        try { v = (form.getTextField('Telephone Number').getText() || '').trim(); } catch {}
        if (looksLikePhone(v)) { phone = v; source = r.form_name + ':Telephone Number'; break; }
      } catch (e) { /* ignore */ }
    }

    // 2) Fallback: scan non-I-9 forms for a phone-ish field with a valid value,
    //    skipping employer/insurance/emergency fields.
    if (!phone) {
      const others = haveData.filter((r) => !/(^|-)i9$/i.test(r.form_name) && !/^onboarding-/i.test(r.form_name));
      outer:
      for (const r of others) {
        try {
          const form = await loadForm(toBytes(r.form_data));
          for (const f of form.getFields()) {
            const name = f.getName() || '';
            if (!/phone|telephone/i.test(name) || EMPLOYER_HINT.test(name)) continue;
            const v = fieldValue(f);
            if (looksLikePhone(v)) { phone = v; source = r.form_name + ':' + name; note = 'fallback'; break outer; }
          }
        } catch (e) { /* ignore */ }
      }
    }

    results.push({ email, phone, source, note });
    console.log(`${phone ? 'OK ' : '-- '} ${email.padEnd(40)} ${phone.padEnd(16)} ${source}`);
  }

  const found = results.filter((r) => r.phone).length;
  console.log(`\nFound ${found} / ${results.length}`);

  // write CSV
  const esc = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const csv = ['email,phone,source,note']
    .concat(results.map((r) => [r.email, r.phone, r.source, r.note].map(esc).join(',')))
    .join('\r\n');
  const out = path.join(__dirname, '..', 'missing_phones_from_pdfs.csv');
  fs.writeFileSync(out, csv, 'utf8');
  console.log('CSV:', out);
  process.exit(0);
})();
