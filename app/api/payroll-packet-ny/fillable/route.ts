import { NextResponse } from 'next/server';
import { PDFDocument, PDFTextField, PDFCheckBox, rgb, degrees, PDFName, PDFNumber } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    // Read the original PDF - This PDF will have fillable fields
    const pdfPath = join(process.cwd(), 'PDS NY Payroll Packet 2025 _1_.pdf');
    const existingPdfBytes = readFileSync(pdfPath);

    // Load the PDF
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const form = pdfDoc.getForm();

    // Get the first page to add form fields
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();

    // Helper function to add rotated field (90° to the right)
    // Rotates W-4 Employee's Withholding Allowance Certificate fields and all other form fields
    const addRotatedField = (field: PDFTextField | PDFCheckBox, options: any) => {
      field.addToPage(firstPage, {
        ...options,
        rotate: degrees(0), // 90° to the right (clockwise)
      });
      
      // Set the /R (Rotation) key in the widget annotation dictionary for PDF viewer compatibility
      const widgets = field.acroField.getWidgets();
      if (widgets.length > 0) {
        const widget = widgets[widgets.length - 1];
        widget.dict.set(PDFName.of('R'), PDFNumber.of(90));
      }
    };

    // Add text fields for form inputs
    // Personal Information Section
    const firstNameField = form.createTextField('firstName');
    addRotatedField(firstNameField, {
      x: 40,
      y: height - 105,
      width: 150,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    firstNameField.setText('');
    firstNameField.enableRequired();


    const lastNameField = form.createTextField('lastName');
    addRotatedField(lastNameField, {
      x: 220,
      y: height - 105,
      width: 150,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    lastNameField.enableRequired();

    const ssnField = form.createTextField('ssn');
    addRotatedField(ssnField, {
      x: 440,
      y: height - 105,
      width: 110,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    ssnField.enableRequired();

    

   

    // Address Section
    const streetAddressField = form.createTextField('streetAddress');
    addRotatedField(streetAddressField, {
      x: 40,
      y: height - 130,
      width: 180,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    streetAddressField.enableRequired();

    const apartmentField = form.createTextField('apartment');
    addRotatedField(apartmentField, {
      x: 330,
      y: height - 130,
      width: 80,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    const cityField = form.createTextField('city');
    addRotatedField(cityField, {
      x: 40,
      y: height - 155,
      width: 180,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    cityField.enableRequired();

    const stateField = form.createTextField('state');
    addRotatedField(stateField, {
      x: 240,
      y: height - 155,
      width: 80,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    stateField.enableRequired();

    const zipCodeField = form.createTextField('zipCode');
    addRotatedField(zipCodeField, {
      x: 330,
      y: height - 155,
      width: 80,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    zipCodeField.enableRequired();

    const singleOrHeadOfHousehold = form.createCheckBox('singleOrHeadOfHousehold');
    addRotatedField(singleOrHeadOfHousehold, {
      x: 515,
      y: height - 120,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    singleOrHeadOfHousehold.enableRequired(); 
    
    const married = form.createCheckBox('married');
    addRotatedField(married, {
      x: 565,
      y: height - 120,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    married.enableRequired();
    
    const marriedbutwitholding = form.createCheckBox('marriedbutwitholding');
    addRotatedField(marriedbutwitholding, {
      x: 565,
      y: height - 132,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    marriedbutwitholding.enableRequired();

    const residentofNYCNo = form.createCheckBox('residentofNYCNo');
    addRotatedField(residentofNYCNo, {
      x: 565,
      y: height - 168,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    residentofNYCNo.enableRequired();

    const residentofNYCYes = form.createCheckBox('residentofNYCYes');
    addRotatedField(residentofNYCYes, {
      x: 527,
      y: height - 168,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    residentofNYCYes.enableRequired();

    const residentofYonkersNo = form.createCheckBox('residentofYonkersNo');
    addRotatedField(residentofYonkersNo, {
      x: 565,
      y: height - 180,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    residentofYonkersNo.enableRequired();

    const residentofYonkersYes = form.createCheckBox('residentofYonkersYes');
    addRotatedField(residentofYonkersYes, {
      x: 527,
      y: height - 180,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    residentofYonkersYes.enableRequired();

    const totalnumberofallowancesNYS = form.createTextField('totalnumberofallowancesNYS');
    addRotatedField(totalnumberofallowancesNYS, {
      x: 510,
      y: height - 202,
      width: 60,
      height: 8,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    totalnumberofallowancesNYS.enableRequired();

    const totalnumberofallowancesNYC = form.createTextField('totalnumberofallowancesNYC');
    addRotatedField(totalnumberofallowancesNYC, {
      x: 510,
      y: height - 214,
      width: 60,
      height: 8,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    totalnumberofallowancesNYC.enableRequired();

    const NYSAmount = form.createTextField('NYSAmount');
    addRotatedField(NYSAmount, {
      x: 510,
      y: height - 250,
      width: 60,
      height: 8,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    NYSAmount.enableRequired();

    const NYCAmount = form.createTextField('NYCAmount');
    addRotatedField(NYCAmount, {
      x: 510,
      y: height - 262,
      width: 60,
      height: 8,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    NYCAmount.enableRequired();


    const YonkersAmount = form.createTextField('YonkersAmount');
    addRotatedField(YonkersAmount, {
      x: 510,
      y: height - 274,
      width: 60,
      height: 8,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    YonkersAmount.enableRequired();

    const signature = form.createTextField('signature');
    addRotatedField(signature, {
      x: 40,
      y: height - 345,
      width: 250,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    signature.enableRequired();

    const date = form.createTextField('date');
    addRotatedField(signature, {
      x: 420,
      y: height - 345,
      width: 150,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    date.enableRequired();

    const fourteenExemptions = form.createCheckBox('14exemptions');
    addRotatedField(fourteenExemptions, {
      x: 395,
      y: height - 467,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    fourteenExemptions.enableRequired();

    const newhire = form.createCheckBox('newhire');
    addRotatedField(newhire, {
      x: 184,
      y: height - 485,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    newhire.enableRequired();

    const firstdate = form.createTextField('firstdate');
    addRotatedField(firstdate, {
      x: 493,
      y: height - 485,
      width: 80,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    firstdate.enableRequired();

    const dependentHealthInsuranceYes = form.createCheckBox('dependentHealthInsuranceYes');
    addRotatedField(dependentHealthInsuranceYes, {
      x: 390,
      y: height - 548,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    dependentHealthInsuranceYes.enableRequired();

    const dependentHealthInsuranceNo = form.createCheckBox('dependentHealthInsuranceNo');
    addRotatedField(dependentHealthInsuranceNo, {
      x: 452,
      y: height - 548,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    dependentHealthInsuranceNo.enableRequired();


    


    const dateQualifies = form.createTextField('dateQualifies');
    addRotatedField(dateQualifies, {
      x: 303,
      y: height - 566,
      width: 90,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    dateQualifies.enableRequired();

    const W4FirstMName  = form.createTextField('W4FirstMName');
    addRotatedField(W4FirstMName, {
      x: 100,
      y: height - 905,
      width: 150,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4FirstMName.enableRequired();

    const W4LastMName  = form.createTextField('W4LastMName');
    addRotatedField(W4LastMName, {
      x: 280,
      y: height - 905,
      width: 120,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4LastMName.enableRequired();


    const W4SSN  = form.createTextField('W4SSN');
    addRotatedField(W4SSN, {
      x: 480,
      y: height - 905,
      width: 100,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4SSN.enableRequired();


    const W4Adress  = form.createTextField('W4Adress');
    addRotatedField(W4Adress, {
      x: 100,
      y: height - 930,
      width: 150,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Adress.enableRequired();


    const W4CityTownZip  = form.createTextField('W4CityTownZip');
    addRotatedField(W4CityTownZip, {
      x: 100,
      y: height - 953,
      width: 150,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4CityTownZip.enableRequired();


    const W4SingleMarried  = form.createCheckBox('W4CSingleMarried');
    addRotatedField(W4SingleMarried, {
      x: 117,
      y: height - 965,
      width: 8,
      height: 8,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4SingleMarried.enableRequired();

    const W4MarriedFilingJointly  = form.createCheckBox('W4MarriedFilingJointly');
    addRotatedField(W4MarriedFilingJointly, {
      x: 117,
      y: height - 976,
      width: 8,
      height: 8,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4MarriedFilingJointly.enableRequired();


    const W4HeadOfHousehold  = form.createCheckBox('W4HeadOfHousehold');
    addRotatedField(W4HeadOfHousehold, {
      x: 117,
      y: height - 987,
      width: 8,
      height: 8,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4HeadOfHousehold.enableRequired();


    const W4total2Jobs  = form.createCheckBox('W4total2Jobs');
    addRotatedField(W4total2Jobs, {
      x: 564,
      y: height - 1140,
      width: 8,
      height: 8,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4total2Jobs.enableRequired();


    const W4200kless  = form.createTextField('W4200kless');
    addRotatedField(W4200kless, {
      x: 415,
      y: height - 1210,
      width: 60,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4200kless.enableRequired();

    const W4200klessDependents  = form.createTextField('W4200klessDependents');
    addRotatedField(W4200klessDependents, {
      x: 415,
      y: height - 1230,
      width: 60,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4200klessDependents.enableRequired();

    const W4200klessQualifyingChild  = form.createTextField('W4200klessQualifyingChild');
    addRotatedField(W4200klessQualifyingChild, {
      x: 515,
      y: height - 1260,
      width: 60,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4200klessQualifyingChild.enableRequired();

    
    


    const W4otherIncome  = form.createTextField('W4otherIncome');
    addRotatedField(W4otherIncome, {
      x: 515,
      y: height - 1295,
      width: 60,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4otherIncome.enableRequired();

    const W4Deductions  = form.createTextField('W4Deductions');
    addRotatedField(W4Deductions, {
      x: 515,
      y: height - 1337,
      width: 60,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Deductions.enableRequired();


    const W4ExtraWithholding  = form.createTextField('W4ExtraWithholding');
    addRotatedField(W4ExtraWithholding, {
      x: 515,
      y: height - 1362,
      width: 60,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4ExtraWithholding.enableRequired();


    const W4Signature  = form.createTextField('W4Signature');
    addRotatedField(W4Signature, {
      x: 100,
      y: height - 1422,
      width: 180,
      height: 18,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Signature.enableRequired();

    const W4Date  = form.createTextField('W4Date');
    addRotatedField(W4Date, {
      x: 470,
      y: height - 1425,
      width: 100,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Date.enableRequired();

    const W4FirstDateOfEmployment  = form.createTextField('W4FirstDateOfEmployment');
    addRotatedField(W4FirstDateOfEmployment, {
      x: 390,
      y: height - 1490,
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4FirstDateOfEmployment.enableRequired();


    const W4Step2TwoJobs  = form.createTextField('W4Step2TwoJobs');
    addRotatedField(W4Step2TwoJobs, {
      x: 515,
      y: height - 2575,
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step2TwoJobs.enableRequired();


    const W4Step2ThreeJobs  = form.createTextField('W4Step2ThreeJobs');
    addRotatedField(W4Step2ThreeJobs, {
      x: 515,
      y: height - 2655,
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step2ThreeJobs.enableRequired();

    const W4Step2ThreeJobsb  = form.createTextField('W4Step2ThreeJobsb');
    addRotatedField(W4Step2ThreeJobsb, {
      x: 515,
      y: height - 2710,
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step2ThreeJobsb.enableRequired();

    const W4Step2ThreeJobsc  = form.createTextField('W4Step2ThreeJobsc');
    addRotatedField(W4Step2ThreeJobsc, {
      x: 515,
      y: height - 2730,
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step2ThreeJobsc.enableRequired();


    const W4Step2NumberPayPeriod  = form.createTextField('W4Step2NumberPayPeriod');
    addRotatedField(W4Step2NumberPayPeriod, {
      x: 515,
      y: height - 2760,
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step2NumberPayPeriod.enableRequired();

    const W4Step2divide  = form.createTextField('W4Step2divide');
    addRotatedField(W4Step2divide, {
      x: 515,
      y: height - 2800,
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step2divide.enableRequired();


    const W4Step4estimatedWages  = form.createTextField('W4Step4estimatedWages');
    addRotatedField(W4Step4estimatedWages, {
      x: 515,
      y: height - 2870,
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step4estimatedWages.enableRequired();


    const W4Step4enterRangeCivilState  = form.createTextField('W4Step4enterRangeCivilState');
    addRotatedField(W4Step4enterRangeCivilState, {
      x: 515,
      y: height - 2900,
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step4enterRangeCivilState.enableRequired();

    const W4Step4subtract  = form.createTextField('W4Step4subtract');
    addRotatedField(W4Step4subtract, {
      x: 515,
      y: height - 2940,
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step4subtract.enableRequired();

    const W4Step4studentLoan  = form.createTextField('W4Step4studentLoan');
    addRotatedField(W4Step4studentLoan, {
      x: 515,
      y: height - 2975,
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step4studentLoan.enableRequired();

    const W4Step4lines3and4  = form.createTextField('W4Step4lines3and4');
    addRotatedField(W4Step4lines3and4, {
      x: 515,
      y: height - 2995,
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step4lines3and4.enableRequired();
  

    

    

    
    

    // Employment Section
    

    // W-4 Information
   

    // Direct Deposit
   
    // Save the PDF with form fields (keeping them editable)
    const pdfBytes = await pdfDoc.save();

    // Return the PDF for browser viewing only (not download)
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="PDS_NY_Payroll_Packet_2025_Fillable.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    console.error('PDF generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate fillable PDF', details: error.message },
      { status: 500 }
    );
  }
}

