const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFName, PDFDict, PDFArray } = require('pdf-lib');

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

async function aggressiveCleanPDF(filePath) {
  console.log(`Processing: ${filePath}`);

  try {
    // Use backup file as source
    const backupPath = filePath.replace('.pdf', '_BACKUP.pdf');

    let sourceBytes;
    if (fs.existsSync(backupPath)) {
      console.log(`  Using backup file: ${backupPath}`);
      sourceBytes = fs.readFileSync(backupPath);
    } else {
      console.log(`  No backup found, using original file`);
      sourceBytes = fs.readFileSync(filePath);
      // Create backup
      fs.writeFileSync(backupPath, sourceBytes);
      console.log(`  ✓ Backup created: ${backupPath}`);
    }

    // Load PDF
    const pdfDoc = await PDFDocument.load(sourceBytes);
    const pages = pdfDoc.getPages();

    console.log(`  Pages: ${pages.length}`);

    let itemsRemoved = 0;

    // More aggressive cleaning
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageDict = page.node;

      // Remove all annotations
      const annots = pageDict.get(PDFName.of('Annots'));
      if (annots) {
        pageDict.delete(PDFName.of('Annots'));
        itemsRemoved++;
      }

      // Remove Actions (button actions)
      const actions = pageDict.get(PDFName.of('AA'));
      if (actions) {
        pageDict.delete(PDFName.of('AA'));
        itemsRemoved++;
      }

      // Remove additional actions
      const additionalActions = pageDict.get(PDFName.of('A'));
      if (additionalActions) {
        pageDict.delete(PDFName.of('A'));
        itemsRemoved++;
      }

      // Try to clean the content stream to remove button-related graphics
      // This is more complex but we'll try to remove XObject references that might be buttons
      try {
        const resources = pageDict.get(PDFName.of('Resources'));
        if (resources && resources instanceof PDFDict) {
          const xobjects = resources.get(PDFName.of('XObject'));
          if (xobjects && xobjects instanceof PDFDict) {
            const entries = xobjects.entries();
            const keysToRemove = [];

            for (const [key, value] of entries) {
              const keyStr = key.toString().toLowerCase();
              // Look for common button-related names
              if (keyStr.includes('btn') ||
                  keyStr.includes('button') ||
                  keyStr.includes('continue') ||
                  keyStr.includes('back') ||
                  keyStr.includes('next')) {
                keysToRemove.push(key);
              }
            }

            for (const key of keysToRemove) {
              xobjects.delete(key);
              itemsRemoved++;
              console.log(`    Removed XObject: ${key}`);
            }
          }
        }
      } catch (e) {
        // Ignore errors in content stream cleaning
      }
    }

    console.log(`  ✓ Items removed: ${itemsRemoved}`);

    // Remove document-level interactive elements
    const catalog = pdfDoc.catalog;
    const catalogDict = catalog.dict;

    // Remove AcroForm (form fields)
    if (catalogDict.has(PDFName.of('AcroForm'))) {
      catalogDict.delete(PDFName.of('AcroForm'));
      console.log(`  ✓ Removed AcroForm`);
    }

    // Remove OpenAction
    if (catalogDict.has(PDFName.of('OpenAction'))) {
      catalogDict.delete(PDFName.of('OpenAction'));
      console.log(`  ✓ Removed OpenAction`);
    }

    // Save the cleaned PDF
    const pdfBytes = await pdfDoc.save({
      useObjectStreams: false,
      addDefaultPage: false,
      updateFieldAppearances: false
    });

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
  console.log('Starting AGGRESSIVE PDF cleaning process...\n');

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

    const success = await aggressiveCleanPDF(filePath);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  console.log('='.repeat(50));
  console.log(`Aggressive cleaning complete!`);
  console.log(`  ✓ Success: ${successCount}`);
  console.log(`  ✗ Failed: ${failCount}`);
  console.log(`  Total: ${PDF_FILES.length}`);
  console.log('='.repeat(50));
}

main();
