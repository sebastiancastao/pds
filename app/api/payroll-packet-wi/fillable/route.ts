import { NextResponse } from 'next/server';
import { PDFDocument, PDFTextField, PDFCheckBox, rgb, degrees, PDFName, PDFNumber } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const pdfPath = join(process.cwd(), 'PDS Wisconsin Payroll Packet 2025 _2_.pdf');
    const existingPdfBytes = readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const form = pdfDoc.getForm();
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();

    // Helper to support robust rotation on all viewers
    const addRotatedField = (field: PDFTextField | PDFCheckBox, options: any) => {
      field.addToPage(firstPage, {
        ...options,
        rotate: degrees(0),
      });
      const widgets = field.acroField.getWidgets();
      if (widgets.length > 0) {
        const widget = widgets[widgets.length - 1];
        widget.dict.set(PDFName.of('R'), PDFNumber.of(90));
      }
    };

    // Copy of key fields from AZ for demonstration (adjust coordinates for WI layout as needed later)
    const wiFirstName = form.createTextField('wiFirstName');
    addRotatedField(wiFirstName, {
      x: 40,
      y: height - 82,
      width: 150,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    wiFirstName.enableRequired();

    const wiSSN = form.createTextField('wiSSN');
    addRotatedField(wiSSN, {
      x: 335,
      y: height - 82,
      width: 80,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    wiSSN.enableRequired();

    const homeAdress = form.createTextField('homeAdress');
    addRotatedField(homeAdress, {
      x: 40,
      y: height - 103,
      width: 120,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    homeAdress.enableRequired();

    const DOB = form.createTextField('DOB');
    addRotatedField(DOB, {
      x: 335,
      y: height - 103,
      width: 80,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    DOB.enableRequired();

    const city = form.createTextField('city');
    addRotatedField(city, {
      x: 40,
      y: height - 123,
      width: 100,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    city.enableRequired();


    const DOH = form.createTextField('DOH');
    addRotatedField(DOH, {
      x: 335,
      y: height - 123,
      width: 80,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    DOH.enableRequired();


    const state = form.createTextField('state');
    addRotatedField(state, {
      x: 217,
      y: height - 124,
      width: 30,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    state.enableRequired();

    const zip = form.createTextField('zip');
    addRotatedField(zip, {
      x: 260,
      y: height - 124,
      width: 50,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    zip.enableRequired();

    const single = form.createCheckBox('single');
    addRotatedField(single, {
      x: 437,
      y: height - 74,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    single.enableRequired();

    const married = form.createCheckBox('married');
    addRotatedField(married, {
      x: 437,
      y: height - 88,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    married.enableRequired();


    const marriedWithholding = form.createCheckBox('marriedWithholding');
    addRotatedField(marriedWithholding, {
      x: 437,
      y: height - 102,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    marriedWithholding.enableRequired();

    const exemptionYS = form.createTextField('exemptionYS');
    addRotatedField(exemptionYS, {
      x: 450,
      y: height - 158,
      width: 100,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    exemptionYS.enableRequired();

    const exemptionSpouse = form.createTextField('exemptionSpouse');
    addRotatedField(exemptionSpouse, {
      x: 450,
      y: height - 175,
      width: 100,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    exemptionSpouse.enableRequired();


    const exemptionDependents = form.createTextField('exemptionDependents');
    addRotatedField(exemptionDependents, {
      x: 450,
      y: height - 190,
      width: 100,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    exemptionDependents.enableRequired();

    const total = form.createTextField('total');
    addRotatedField(total, {
      x: 450,
      y: height - 210,
      width: 100,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    total.enableRequired();

    const additionalAmmount = form.createTextField('additionalAmmount');
    addRotatedField(additionalAmmount, {
      x: 450,
      y: height - 225,
      width: 100,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    additionalAmmount.enableRequired();

    const exempt = form.createTextField('exempt');
    addRotatedField(exempt, {
      x: 450,
      y: height - 245,
      width: 100,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    exempt.enableRequired();

    const signature = form.createTextField('signature');
    addRotatedField(signature , {
      x: 70,
      y: height - 277,
      width: 180,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    signature.enableRequired();

    const date = form.createTextField('date');
    addRotatedField(signature , {
      x: 350,
      y: height - 277,
      width: 100,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    date.enableRequired();


    const W4FirstMName  = form.createTextField('W4FirstMName');
    addRotatedField(W4FirstMName, {
      x: 100,
      y: height - (3905 - 2204),
      width: 150,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4FirstMName.enableRequired();

    const W4LastMName  = form.createTextField('W4LastMName');
    addRotatedField(W4LastMName, {
      x: 280,
      y: height - (3905 - 2204),
      width: 120,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4LastMName.enableRequired();

    const W4SSN  = form.createTextField('W4SSN');
    addRotatedField(W4SSN, {
      x: 480,
      y: height - (3905 - 2204),
      width: 100,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4SSN.enableRequired();


    const W4Adress  = form.createTextField('W4Adress');
    addRotatedField(W4Adress, {
      x: 100,
      y: height - (3930 - 2204),
      width: 150,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Adress.enableRequired();


    const W4CityTownZip  = form.createTextField('W4CityTownZip');
    addRotatedField(W4CityTownZip, {
      x: 100,
      y: height - (3953 - 2204),
      width: 150,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4CityTownZip.enableRequired();


    const W4SingleMarried  = form.createCheckBox('W4CSingleMarried');
    addRotatedField(W4SingleMarried, {
      x: 117,
      y: height - (3965 - 2204),
      width: 8,
      height: 8,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4SingleMarried.enableRequired();

    const W4MarriedFilingJointly  = form.createCheckBox('W4MarriedFilingJointly');
    addRotatedField(W4MarriedFilingJointly, {
      x: 117,
      y: height - (3976 - 2204),
      width: 8,
      height: 8,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4MarriedFilingJointly.enableRequired();


    const W4HeadOfHousehold  = form.createCheckBox('W4HeadOfHousehold');
    addRotatedField(W4HeadOfHousehold, {
      x: 117,
      y: height - (3987 - 2204),
      width: 8,
      height: 8,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4HeadOfHousehold.enableRequired();


    const W4total2Jobs  = form.createCheckBox('W4total2Jobs');
    addRotatedField(W4total2Jobs, {
      x: 564,
      y: height - (3585-1647),
      width: 8,
      height: 8,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4total2Jobs.enableRequired();


    const W4200kless  = form.createTextField('W4200kless');
    addRotatedField(W4200kless, {
      x: 415,
      y: height - (3650 - 1647),
      width: 60,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4200kless.enableRequired();

    const W4200klessDependents  = form.createTextField('W4200klessDependents');
    addRotatedField(W4200klessDependents, {
      x: 415,
      y: height - (3670 - 1647),
      width: 60,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4200klessDependents.enableRequired();

    const W4200klessQualifyingChild  = form.createTextField('W4200klessQualifyingChild');
    addRotatedField(W4200klessQualifyingChild, {
      x: 515,
      y: height - (3700 - 1647),
      width: 60,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4200klessQualifyingChild.enableRequired();

    const W4otherIncome  = form.createTextField('W4otherIncome');
    addRotatedField(W4otherIncome, {
      x: 515,
      y: height - (3735 - 1647),
      width: 60,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4otherIncome.enableRequired();

    const W4Deductions  = form.createTextField('W4Deductions');
    addRotatedField(W4Deductions, {
      x: 515,
      y: height - (3777 - 1647),
      width: 60,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Deductions.enableRequired();

    const W4ExtraWithholding  = form.createTextField('W4ExtraWithholding');
    addRotatedField(W4ExtraWithholding, {
      x: 515,
      y: height - (3802 - 1647),
      width: 60,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4ExtraWithholding.enableRequired();

    const W4Signature  = form.createTextField('W4Signature');
    addRotatedField(W4Signature, {
      x: 100,
      y: height - (3865 - 1647),
      width: 180,
      height: 18,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Signature.enableRequired();

    const W4Date  = form.createTextField('W4Date');
    addRotatedField(W4Date, {
      x: 470,
      y: height - (3865 - 1647),
      width: 100,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Date.enableRequired();

    const W4FirstDateOfEmployment  = form.createTextField('W4FirstDateOfEmployment');
    addRotatedField(W4FirstDateOfEmployment, {
      x: 390,
      y: height - (3930 - 1647),
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4FirstDateOfEmployment.enableRequired();

    const W4Step2TwoJobs  = form.createTextField('W4Step2TwoJobs');
    addRotatedField(W4Step2TwoJobs, {
      x: 515,
      y: height - (4975-1597),
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step2TwoJobs.enableRequired();

    const W4Step2ThreeJobs  = form.createTextField('W4Step2ThreeJobs');
    addRotatedField(W4Step2ThreeJobs, {
      x: 515,
      y: height - (5055-1597),
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step2ThreeJobs.enableRequired();

    const W4Step2ThreeJobsb  = form.createTextField('W4Step2ThreeJobsb');
    addRotatedField(W4Step2ThreeJobsb, {
      x: 515,
      y: height - (5110-1597),
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step2ThreeJobsb.enableRequired();

    const W4Step2ThreeJobsc  = form.createTextField('W4Step2ThreeJobsc');
    addRotatedField(W4Step2ThreeJobsc, {
      x: 515,
      y: height - (5130-1597),
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step2ThreeJobsc.enableRequired();

    const W4Step2NumberPayPeriod  = form.createTextField('W4Step2NumberPayPeriod');
    addRotatedField(W4Step2NumberPayPeriod, {
      x: 515,
      y: height - (5160-1597),
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step2NumberPayPeriod.enableRequired();

    const W4Step2divide  = form.createTextField('W4Step2divide');
    addRotatedField(W4Step2divide, {
      x: 515,
      y: height - (5200-1597),
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step2divide.enableRequired();

    const W4Step4estimatedWages  = form.createTextField('W4Step4estimatedWages');
    addRotatedField(W4Step4estimatedWages, {
      x: 515,
      y: height - (5270-1597),
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step4estimatedWages.enableRequired();

    const W4Step4enterRangeCivilState  = form.createTextField('W4Step4enterRangeCivilState');
    addRotatedField(W4Step4enterRangeCivilState, {
      x: 515,
      y: height - (5300-1597),
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step4enterRangeCivilState.enableRequired();

    const W4Step4subtract  = form.createTextField('W4Step4subtract');
    addRotatedField(W4Step4subtract, {
      x: 515,
      y: height - (5340-1597),
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step4subtract.enableRequired();

    const W4Step4studentLoan  = form.createTextField('W4Step4studentLoan');
    addRotatedField(W4Step4studentLoan, {
      x: 515,
      y: height - (5375-1597),
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step4studentLoan.enableRequired();

    const W4Step4lines3and4  = form.createTextField('W4Step4lines3and4');
    addRotatedField(W4Step4lines3and4, {
      x: 515,
      y: height - (5395-1597),
      width: 70,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    W4Step4lines3and4.enableRequired();

    // ... additional fields (copy/paste others as needed, or adjust for WI PDF)

    // Save and return the PDF with editable fields
    const pdfBytes = await pdfDoc.save();
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="PDS_WI_Payroll_Packet_2025_Fillable.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    console.error('WI PDF generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate fillable WI Payroll Packet PDF', details: error.message },
      { status: 500 }
    );
  }
}
