const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Load .env.local manually
const envContent = fs.readFileSync('.env.local', 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    envVars[match[1].trim()] = match[2].trim();
  }
});

const supabase = createClient(
  envVars.NEXT_PUBLIC_SUPABASE_URL,
  envVars.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  console.log('Clearing saved background check form progress...');

  // Delete saved form progress
  const { error: progressError } = await supabase
    .from('pdf_form_progress')
    .delete()
    .in('form_name', ['background-waiver', 'background-disclosure']);

  if (progressError) {
    console.error('Error deleting progress:', progressError);
  } else {
    console.log('✅ Successfully deleted saved form progress');
  }

  // Also clear any saved PDFs in background_check_pdfs table
  const { error: pdfError } = await supabase
    .from('background_check_pdfs')
    .update({
      waiver_pdf_data: null,
      disclosure_pdf_data: null
    })
    .not('user_id', 'is', null);

  if (pdfError) {
    console.error('Error clearing PDFs:', pdfError);
  } else {
    console.log('✅ Successfully cleared saved PDFs');
  }

  console.log('\n✅ Done! Now hard refresh the page in your browser (Ctrl+Shift+R).');
  process.exit(0);
})();
