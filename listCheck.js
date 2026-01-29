const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
(async () => {
  const pdfBytes = fs.readFileSync('fw4.pdf');
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();
  const fields = form.getFields();
  const checkboxFields = fields.filter((field) => field.constructor.name === 'PDFCheckBox');
  console.log('Checkbox fields (total ' + checkboxFields.length + '):');
  checkboxFields.forEach((field, index) => {
    console.log(`${index + 1}. ${field.getName()}`);
  });
})();
