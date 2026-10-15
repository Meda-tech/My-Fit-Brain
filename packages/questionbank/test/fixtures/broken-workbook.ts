import ExcelJS from 'exceljs';

// A deliberately broken question bank: right tab names, wrong content. Built in code so the fixture
// is readable and needs no binary file.

export async function brokenWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  wb.addWorksheet('README').addRow(['MFB Intimacy Assessment v1.1 (Developer Question Bank)']);

  const q = wb.addWorksheet('Questions');
  q.addRow([
    'ID', 'Module', 'Module name (EN)', 'Module name (HI)', 'Type', 'Question (EN)', 'Question (HI)',
    'Options / Scale (EN || HI)', 'Reverse', 'Scored?', 'Routing / Dev note', 'Path',
  ]);
  // Unknown type, Reverse not a boolean, unknown Scored value.
  q.addRow(['X1', 'CORE', 'Core', 'कोर', 'slider', 'A question', 'एक सवाल',
    'Never(0) | Rarely(1) | Sometimes(2) | Often(3) || कभी नहीं | कभी-कभार | कभी-कभी | अक्सर', 'maybe', 'Sometimes', '', 'ALL']);
  // EN and HI option counts differ; missing Hindi question text.
  q.addRow(['X2', 'CORE', 'Core', 'कोर', 'likert', 'Another question', '',
    'Never(0) | Rarely(1) | Sometimes(2) | Often(3) || कभी नहीं | अक्सर', 'FALSE', 'Yes', '', 'ALL']);
  // Unknown path and a duplicate ID.
  q.addRow(['X2', 'CORE', 'Core', 'कोर', 'yn', 'Third', 'तीसरा', 'No(0) | Yes(3) || नहीं | हाँ', 'FALSE', 'Yes', '', 'COUPLES']);
  // Options without the "||" separator.
  q.addRow(['X3', 'CORE', 'Core', 'कोर', 'single', 'Fourth', 'चौथा', 'One | Two', 'FALSE', 'No', '', 'ALL']);

  const tiers = wb.addWorksheet('Session Tiers');
  tiers.addRow(['Sessions', 'Plan name (EN)', 'Plan name (HI)', 'Pace (EN)', 'Pace (HI)', 'Typical case']);
  tiers.addRow([4, 'Clarity Plan', '', '4 sessions', '', '']);

  const rt = wb.addWorksheet('Report Text');
  rt.addRow(['Key', 'Module', 'Band', 'Text (EN)', 'Text (HI)']);
  rt.addRow(['TITLE', '', 'Severe', 'Title', '']);

  const ss = wb.addWorksheet('Strengths & Stuck');
  ss.addRow(['Item ID', 'Kind', 'Trigger', 'Text (EN)', 'Text (HI)']);
  ss.addRow(['X1', 'BONUS', 'raw answer = Rarely (1)', 'Text', 'पाठ']);

  // Flags tab without the Text (HI) column.
  const fl = wb.addWorksheet('Flags & Safety');
  fl.addRow(['Flag', 'Trigger rule', 'Effect', 'Text (EN)']);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
