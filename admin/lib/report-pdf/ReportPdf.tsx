import 'server-only';
import { Document, Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { Report } from '@mfb/questionnaire';
import { colour, pdfAssets } from './assets';

// The report PDF, laid out on brand/MFB_Assessment_Report_Template_A4.pdf: a cover page (endorsed logo,
// bindu dot, title, Prepared for / Date / Report ID, founder seal, teal disclaimer band) and content
// pages (logo header, numbered teal sections, mist cards with bars, "Space to speak." footer). Five
// parts, the same for every questionnaire; parts with no content are left out. Every sentence comes
// from the stored report; only the labels below are UI words. Generated on request and never stored.

const FOOTER_LINE = 'My Fit Brain · A unit of MeDa Partners Pvt Ltd · System Designed by MeDa Partners Pvt Ltd';
const BRAND_LINE = 'Space to speak.';

const LABELS = {
  en: { preparedFor: 'PREPARED FOR', date: 'DATE', reportId: 'REPORT ID', sessions: 'sessions', notEnough: 'Not enough answers' },
  hi: { preparedFor: 'किसके लिए', date: 'तारीख', reportId: 'रिपोर्ट ID', sessions: 'सेशन', notEnough: 'पर्याप्त जवाब नहीं' },
};

let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  const f = pdfAssets().fonts;
  Font.register({
    family: 'Poppins',
    fonts: [
      { src: f.poppinsRegular, fontWeight: 400 },
      { src: f.poppinsMedium, fontWeight: 500 },
      { src: f.poppinsSemiBold, fontWeight: 600 },
      { src: f.poppinsBold, fontWeight: 700 },
    ],
  });
  Font.register({
    family: 'DM Sans',
    fonts: [
      { src: f.dmSansRegular, fontWeight: 400 },
      { src: f.dmSansMedium, fontWeight: 500 },
      { src: f.dmSansBold, fontWeight: 700 },
    ],
  });
  // Hindi reports need a Devanagari font; registered when the files are present (assets.ts).
  if (f.devanagariRegular) {
    Font.register({
      family: 'Devanagari',
      fonts: [{ src: f.devanagariRegular, fontWeight: 400 }, ...(f.devanagariBold ? [{ src: f.devanagariBold, fontWeight: 700 }] : [])],
    });
  }
  // Never split words across lines.
  Font.registerHyphenationCallback((word) => [word]);
  fontsReady = true;
}

// A4 = 595 × 842 pt. Margins follow the template (about 57 pt left and right).
const M = 57;

const s = StyleSheet.create({
  cover: { backgroundColor: colour.cream, color: colour.ink },
  coverLogo: { position: 'absolute', left: M - 14, top: 58, width: 200 },
  coverBody: { position: 'absolute', left: M, right: M, top: 262 },
  bindu: { width: 22, height: 22, borderRadius: 11, backgroundColor: colour.coral, marginBottom: 22 },
  coverTitle: { fontWeight: 600, fontSize: 32, lineHeight: 1.2, color: colour.teal },
  coverSubtitle: { marginTop: 14, fontSize: 13.5, lineHeight: 1.5, color: colour['ink-soft'] },
  coverDesigned: { marginTop: 10, fontSize: 11, color: colour['ink-muted'] },
  fields: { position: 'absolute', left: M, top: 470, width: 312 },
  field: { borderBottomWidth: 1, borderBottomColor: colour.sand, paddingBottom: 9, marginBottom: 18 },
  fieldLabel: { fontSize: 8.5, letterSpacing: 1, color: colour['ink-muted'], marginBottom: 5 },
  fieldValue: { fontSize: 12, color: colour.ink },
  seal: { position: 'absolute', right: M - 6, top: 486, width: 134, height: 134 },
  band: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 96, backgroundColor: colour.teal, paddingHorizontal: M, paddingTop: 24 },
  bandText: { fontSize: 8.5, lineHeight: 1.6, color: colour.white, maxWidth: 440 },

  page: { backgroundColor: colour.white, color: colour.ink, paddingTop: 116, paddingBottom: 78, paddingHorizontal: M },
  header: { position: 'absolute', top: 40, left: M, right: M, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colour.sand, paddingBottom: 14 },
  headerLogo: { width: 112, marginLeft: -8 },
  headerText: { fontSize: 8.5, color: colour['ink-muted'] },
  footer: { position: 'absolute', bottom: 30, left: M, right: M, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colour.sand, paddingTop: 10 },
  footerBrand: { fontFamily: 'Poppins', fontSize: 8.5, color: colour['coral-deep'] },
  footerText: { fontFamily: 'DM Sans', fontSize: 7.5, color: colour['ink-muted'] },

  h2: { fontWeight: 600, fontSize: 17, color: colour.teal, marginBottom: 10 },
  section: { marginBottom: 22 },
  body: { fontSize: 10.5, lineHeight: 1.6, color: colour['ink-soft'] },

  card: { backgroundColor: colour.mist, borderRadius: 9, paddingVertical: 15, paddingHorizontal: 19, marginBottom: 11 },
  areaLabel: { fontSize: 10, fontWeight: 600, color: colour.ink, marginBottom: 9 },
  track: { height: 8, borderRadius: 4, backgroundColor: colour.sand, marginBottom: 8 },
  fill: { height: 8, borderRadius: 4, backgroundColor: colour.teal },
  areaCaption: { fontSize: 9, color: colour['ink-soft'] },
  areaMeaning: { fontSize: 10, lineHeight: 1.55, color: colour['ink-soft'], marginTop: 7 },

  bulletRow: { flexDirection: 'row', marginBottom: 5 },
  bullet: { width: 4, height: 4, borderRadius: 2, backgroundColor: colour.coral, marginTop: 6, marginRight: 9 },
  bulletText: { flex: 1, fontSize: 10.5, lineHeight: 1.6, color: colour['ink-soft'] },

  support: { backgroundColor: colour.mist, borderLeftWidth: 3, borderLeftColor: colour.teal, borderTopRightRadius: 9, borderBottomRightRadius: 9, padding: 16, marginBottom: 22 },
  supportText: { fontSize: 11, lineHeight: 1.6, color: colour.ink },
  plan: { backgroundColor: colour.mist, borderRadius: 9, padding: 16 },
  planText: { fontWeight: 500, fontSize: 11.5, lineHeight: 1.55, color: colour.ink },
  planNote: { fontSize: 10, lineHeight: 1.5, color: colour['ink-soft'], marginTop: 8 },
});

function formatDate(iso: string, lang: 'en' | 'hi'): string {
  return new Date(iso).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

export interface ReportPdfProps {
  report: Report;
}

export function ReportPdf({ report: r }: ReportPdfProps) {
  registerFonts();
  const { logo, fonts } = pdfAssets();
  const lang = r.lang;
  const t = LABELS[lang];
  // Hindi text uses the Devanagari font when available; headings fall back to it too (Poppins has no Devanagari).
  const hindi = lang === 'hi' && !!fonts.devanagariRegular;
  const bodyFont = hindi ? 'Devanagari' : 'DM Sans';
  const headFont = hindi ? 'Devanagari' : 'Poppins';
  const body = { fontFamily: bodyFont };
  const head = { fontFamily: headFont };

  const sections: { heading: string; body: React.ReactNode; keep?: boolean }[] = [];
  if (r.snapshot.areas.length) {
    sections.push({
      heading: r.snapshot.heading,
      body: (
        <>
          {r.snapshot.areas.map((a, i) => (
            <View key={i} style={s.card} wrap={false}>
              <Text style={[s.areaLabel, head]}>{a.title}</Text>
              <View style={s.track}>
                <View style={[s.fill, { width: `${Math.max(0, Math.min(100, a.percent ?? 0))}%` }]} />
              </View>
              <Text style={[s.areaCaption, body]}>{a.percent === null ? t.notEnough : `${a.percent}% · ${a.range}`}</Text>
              {a.meaning && <Text style={[s.areaMeaning, body]}>{a.meaning}</Text>}
            </View>
          ))}
        </>
      ),
    });
  }
  if (r.plan) {
    sections.push({
      heading: r.plan.heading,
      keep: true,
      body: (
        <View style={s.plan} wrap={false}>
          <Text style={[s.planText, head]}>
            {r.plan.name}: {r.plan.sessions} {t.sessions}, {r.plan.pace}
          </Text>
          <Text style={[s.planNote, body]}>{r.plan.note}</Text>
        </View>
      ),
    });
  }
  if (r.focus) {
    sections.push({
      heading: r.focus.heading,
      body: (
        <View>
          <Text style={[s.body, body, { marginBottom: 6, fontWeight: 500 }]}>{r.focus.title}</Text>
          {r.focus.lines.map((line, i) => (
            <View key={i} style={s.bulletRow} wrap={false}>
              <View style={s.bullet} />
              <Text style={[s.bulletText, body]}>{line}</Text>
            </View>
          ))}
        </View>
      ),
    });
  }
  if (r.closing) sections.push({ heading: r.closing.heading, keep: true, body: <Text style={[s.body, body]}>{r.closing.text}</Text> });

  let n = 0;
  const date = formatDate(r.date, lang);

  return (
    <Document title={r.reportId} author="My Fit Brain" creator="My Fit Brain" producer="My Fit Brain">
      <Page size="A4" style={[s.cover, body]}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
        <Image style={s.coverLogo} src={{ data: logo.endorsed, format: 'png' }} />
        <View style={s.coverBody}>
          <View style={s.bindu} />
          <Text style={[s.coverTitle, head]}>{r.title}</Text>
          {r.subtitle && <Text style={[s.coverSubtitle, body]}>{r.subtitle}</Text>}
          <Text style={[s.coverDesigned, body]}>{r.designedBy}</Text>
        </View>
        <View style={s.fields}>
          <Field label={t.preparedFor} value={r.clientName} font={bodyFont} />
          <Field label={t.date} value={date} font={bodyFont} />
          <Field label={t.reportId} value={r.reportId} font="DM Sans" />
        </View>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
        <Image style={s.seal} src={{ data: logo.seal, format: 'png' }} />
        <View style={s.band}>
          <Text style={[s.bandText, body]}>{r.disclaimer}</Text>
        </View>
      </Page>

      <Page size="A4" style={[s.page, body]}>
        <View style={s.header} fixed>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
          <Image style={s.headerLogo} src={{ data: logo.horizontal, format: 'png' }} />
          <Text style={[s.headerText, body]}>
            {r.title} · {r.clientName}
          </Text>
        </View>

        {r.support && (
          <View style={s.support} wrap={false}>
            <Text style={[s.supportText, body]}>{r.support}</Text>
          </View>
        )}

        {sections.map((sec, i) => (
          <View key={i} style={s.section} wrap={!sec.keep}>
            <Text style={[s.h2, head]} minPresenceAhead={110}>
              {++n}. {sec.heading}
            </Text>
            {sec.body}
          </View>
        ))}

        <View style={s.footer} fixed>
          <Text style={s.footerBrand}>{BRAND_LINE}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `${FOOTER_LINE}   ·   ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

function Field({ label, value, font }: { label: string; value: string; font: string }) {
  return (
    <View style={s.field}>
      <Text style={[s.fieldLabel, { fontFamily: font }]}>{label}</Text>
      <Text style={[s.fieldValue, { fontFamily: font }]}>{value}</Text>
    </View>
  );
}
