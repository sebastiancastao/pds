const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFName } = require('pdf-lib');

const PDF_FILES = [
  '8_de2320_UI Guide.pdf',
  '9_de2515_Disability Insurance Provisions.pdf',
  '10_Paid Family Leave_de2511d.pdf',
  '11_Sexual-Harassment-Poster_ENG.pdf',
  '12. Survivors-Right-to-Time-Off_English-B.pdf',
  '13_The-Rights-of-Employees-who-are-Transgender-or-Gender-Nonconforming-Poster_ENG.pdf',
  '15. health-insurance-marketplace-coverage-options-complete.pdf',
  'LC_2810.5_Notice to Employee.pdf',
  '17. Discrimination-is-Against-the-Law-Brochure_ENG.pdf',
  '18. Immigration-Rights-Fact-Sheet_ENG.pdf',
  '19. California-Protects-The-Civil-Rights-Of-Members-Of-The-Military-And-Veterans_ENG.pdf',
  '20. LGBTQ-Fact-Sheet_ENG.pdf'
];

async function cleanPDF(filePath) {
  console.log(`Processing: ${filePath}`);

  try {
    // Read the original PDF
    const existingPdfBytes = fs.readFileSync(filePath);

    // Create backup
    const backupPath = filePath.replace('.pdf', '_BACKUP.pdf');
    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, existingPdfBytes);
      console.log(`  ✓ Backup created: ${backupPath}`);
    }

    // Load PDF
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const pages = pdfDoc.getPages();

    console.log(`  Pages: ${pages.length}`);

    // Remove annotations from all pages
    let annotationsRemoved = 0;
    for (const page of pages) {
      const annotations = page.node.Annots();
      if (annotations) {
        page.node.delete(PDFName.of('Annots'));
        annotationsRemoved++;
      }

      // Also try to remove any link annotations or widget annotations
      const pageDict = page.node;
      const keys = pageDict.entries();
      for (const [key, value] of keys) {
        const keyName = key.toString();
        if (keyName.includes('Link') || keyName.includes('Widget') || keyName.includes('Btn')) {
          try {
            pageDict.delete(key);
          } catch (e) {
            // Ignore errors for non-deletable entries
          }
        }
      }
    }

    console.log(`  ✓ Annotations removed from ${annotationsRemoved} pages`);

    // Save the cleaned PDF
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(filePath, pdfBytes);

    console.log(`  ✓ Cleaned PDF saved: ${filePath}`);
    console.log('');

    return true;
  } catch (error) {
    console.error(`  ✗ Error processing ${filePath}:`, error.message);
    console.log('');
    return false;
  }
}

async function main() {
  console.log('Starting PDF cleaning process...\n');

  const rootDir = path.join(__dirname, '..');
  let successCount = 0;
  let failCount = 0;

  for (const file of PDF_FILES) {
    const filePath = path.join(rootDir, file);

    if (!fs.existsSync(filePath)) {
      console.log(`⚠ File not found: ${filePath}\n`);
      failCount++;
      continue;
    }

    const success = await cleanPDF(filePath);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  console.log('='.repeat(50));
  console.log(`Cleaning complete!`);
  console.log(`  ✓ Success: ${successCount}`);
  console.log(`  ✗ Failed: ${failCount}`);
  console.log(`  Total: ${PDF_FILES.length}`);
  console.log('='.repeat(50));
}

main();
