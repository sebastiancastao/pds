const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// Create template data
const headers = [
  'Employee Name',
  'SSN',
  'Address',
  'Employee ID',
  'Pay Period Start',
  'Pay Period End',
  'Pay Date',
  'Regular Hours',
  'Regular Rate',
  'Overtime Hours',
  'Overtime Rate',
  'Double Time Hours',
  'Double Time Rate',
  'Federal Income',
  'Social Security',
  'Medicare',
  'State Income',
  'State DI',
  'State',
  'Misc Deduction',
  'Misc Reimbursement',
];

const sampleData = [
  'John Doe',
  'XXX-XX-1234',
  '123 Main St, Los Angeles, CA 90001',
  'EMP-001',
  '01/01/2024',
  '01/15/2024',
  '01/20/2024',
  '80',
  '25.00',
  '5',
  '37.50',
  '0',
  '50.00',
  '250.00',
  '124.00',
  '29.00',
  '85.00',
  '12.50',
  'CA',
  '0',
  '0',
];

// Create workbook
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([headers, sampleData]);

// Set column widths
ws['!cols'] = headers.map(() => ({ wch: 20 }));

// Add the worksheet to the workbook
XLSX.utils.book_append_sheet(wb, ws, 'Paystub Data');

// Ensure the templates directory exists
const templatesDir = path.join(__dirname, '..', 'public', 'templates');
if (!fs.existsSync(templatesDir)) {
  fs.mkdirSync(templatesDir, { recursive: true });
}

// Write the file
const outputPath = path.join(templatesDir, 'paystub-template.xlsx');
XLSX.writeFile(wb, outputPath);

console.log('✓ Paystub template generated at:', outputPath);
