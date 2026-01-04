const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, degrees } = require('pdf-lib');

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

async function maskButtonGraphics(filePath) {
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
    }

    // Load PDF
    const pdfDoc = await PDFDocument.load(sourceBytes);
    const pages = pdfDoc.getPages();

    console.log(`  Pages: ${pages.length}`);

    let buttonsMasked = 0;

    // For each page, draw white rectangles over common button locations
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const { width, height } = page.getSize();

      console.log(`  Page ${i + 1}: ${width}x${height}`);

      // Common button positions based on the screenshot
      // Bottom center area where "Back" and "Continue" buttons typically appear

      // Mask bottom-left area (Back button area)
      // Typical position: left side, bottom of page
      page.drawRectangle({
        x: 50,
        y: 20,
        width: 200,
        height: 60,
        color: rgb(1, 1, 1), // White
        opacity: 1,
      });

      // Mask bottom-center-left area
      page.drawRectangle({
        x: width * 0.2,
        y: 20,
        width: 150,
        height: 60,
        color: rgb(1, 1, 1), // White
        opacity: 1,
      });

      // Mask bottom-right area (Continue button area)
      // Typical position: right side, bottom of page
      page.drawRectangle({
        x: width - 250,
        y: 20,
        width: 200,
        height: 60,
        color: rgb(1, 1, 1), // White
        opacity: 1,
      });

      // Mask bottom-center-right area
      page.drawRectangle({
        x: width * 0.6,
        y: 20,
        width: 150,
        height: 60,
        color: rgb(1, 1, 1), // White
        opacity: 1,
      });

      // Also mask any buttons that might be in the middle
      page.drawRectangle({
        x: width * 0.4,
        y: 20,
        width: width * 0.2,
        height: 60,
        color: rgb(1, 1, 1), // White
        opacity: 1,
      });

      buttonsMasked++;
    }

    console.log(`  ✓ Button areas masked on ${buttonsMasked} pages`);

    // Save the masked PDF
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(filePath, pdfBytes);

    console.log(`  ✓ Masked PDF saved: ${filePath}`);
    console.log('');

    return true;
  } catch (error) {
    console.error(`  ✗ Error processing ${filePath}:`, error.message);
    console.log('');
    return false;
  }
}

async function main() {
  console.log('Starting button graphics masking process...\n');

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

    const success = await maskButtonGraphics(filePath);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  console.log('='.repeat(50));
  console.log(`Button masking complete!`);
  console.log(`  ✓ Success: ${successCount}`);
  console.log(`  ✗ Failed: ${failCount}`);
  console.log(`  Total: ${PDF_FILES.length}`);
  console.log('='.repeat(50));
  console.log('\nNote: White rectangles have been drawn over button areas.');
  console.log('If buttons are still visible, you may need to adjust coordinates in the script.');
}

main();
