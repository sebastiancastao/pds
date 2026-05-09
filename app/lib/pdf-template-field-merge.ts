export async function mergeSavedPdfFieldsOntoTemplate(
  templateBytes: Uint8Array,
  savedPdfBytes: Uint8Array
): Promise<Uint8Array | null> {
  const { PDFDocument } = await import('pdf-lib');

  try {
    const templateDoc = await PDFDocument.load(templateBytes);
    const savedDoc = await PDFDocument.load(savedPdfBytes);
    const templateForm = templateDoc.getForm();
    const savedForm = savedDoc.getForm();

    const targetFieldsByName = new Map<string, any>();
    for (const targetField of templateForm.getFields()) {
      try {
        targetFieldsByName.set(targetField.getName(), targetField);
      } catch {
        // Ignore malformed fields.
      }
    }

    let copiedCount = 0;

    for (const savedField of savedForm.getFields()) {
      let fieldName = '';
      try {
        fieldName = savedField.getName();
      } catch {
        continue;
      }

      const targetField = targetFieldsByName.get(fieldName);
      if (!targetField) continue;

      try {
        if (typeof (savedField as any).getText === 'function' && typeof (targetField as any).setText === 'function') {
          (targetField as any).setText((savedField as any).getText() || '');
          copiedCount++;
        } else if (typeof (savedField as any).isChecked === 'function') {
          const checked = (savedField as any).isChecked();
          if (checked && typeof (targetField as any).check === 'function') (targetField as any).check();
          if (!checked && typeof (targetField as any).uncheck === 'function') (targetField as any).uncheck();
          copiedCount++;
        } else if (typeof (savedField as any).getSelected === 'function' && typeof (targetField as any).select === 'function') {
          const selected = (savedField as any).getSelected();
          const value = Array.isArray(selected) ? selected[0] : selected;
          if (value) {
            (targetField as any).select(value);
            copiedCount++;
          }
        }
      } catch {
        // Ignore individual field copy failures and keep going.
      }
    }

    if (copiedCount === 0) {
      return null;
    }

    return templateDoc.save();
  } catch {
    return null;
  }
}
