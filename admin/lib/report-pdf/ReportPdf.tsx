import 'server-only';
import { Document, Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { Lang, ReportArea, ReportDocument, ReportSection } from '@mfb/report';
import { colour, pdfAssets } from './assets';

// The report PDF, laid out on brand/MFB_Assessment_Report_Template_A4.pdf: a cover page (endorsed
// logo, bindu dot, test name, Prepared for / Date / Report ID, founder seal, teal disclaimer band) and
// content pages (logo header with test and client name, numbered teal sections, mist cards with bars,
// "Space to speak." footer). Every sentence comes from the stored report document; only the labels
// below are UI words. Generated on request and never stored.

const FOOTER_LINE = 'My Fit Brain · A unit of MeDa Partners Pvt Ltd · System Designed by MeDa Partners Pvt Ltd';
const BRAND_LINE = 'Space to speak.';

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
  // Never split words across lines.
  Font.registerHyphenationCallback((word) => [word]);
  fontsReady = true;
}

// A4 = 595 × 842 pt. Margins follow the template (about 57 pt left and right).
const M = 57;

const s = StyleSheet.create({
  // Cover
  cover: { backgroundColor: colour.cream, fontFamily: 'DM Sans', color: colour.ink },
  coverLogo: { position: 'absolute', left: M - 14, top: 58, width: 200 },
  coverBody: { position: 'absolute', left: M, right: M, top: 262 },
  bindu: { width: 22, height: 22, borderRadius: 11, backgroundColor: colour.coral, marginBottom: 22 },
  coverTitle: { fontFamily: 'Poppins', fontWeight: 600, fontSize: 32, lineHeight: 1.2, color: colour.teal },
  coverSubtitle: { marginTop: 22, fontSize: 13.5, color: colour['ink-soft'] },
  fields: { position: 'absolute', left: M, top: 456, width: 312 },
  field: { borderBottomWidth: 1, borderBottomColor: colour.sand, paddingBottom: 9, marginBottom: 18 },
  fieldLabel: { fontSize: 8.5, letterSpacing: 1, color: colour['ink-muted'], marginBottom: 5 },
  fieldValue: { fontSize: 12, color: colour.ink },
  seal: { position: 'absolute', right: M - 6, top: 486, width: 134, height: 134 },
  band: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 96, backgroundColor: colour.teal, paddingHorizontal: M, paddingTop: 28 },
  bandText: { fontSize: 8.5, lineHeight: 1.6, color: colour.white, maxWidth: 420 },

  // Content pages
  page: { backgroundColor: colour.white, fontFamily: 'DM Sans', color: colour.ink, paddingTop: 116, paddingBottom: 78, paddingHorizontal: M },
  header: { position: 'absolute', top: 40, left: M, right: M, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colour.sand, paddingBottom: 14 },
  headerLogo: { width: 112, marginLeft: -8 },
  headerText: { fontSize: 8.5, color: colour['ink-muted'] },
  footer: { position: 'absolute', bottom: 30, left: M, right: M, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colour.sand, paddingTop: 10 },
  footerBrand: { fontFamily: 'Poppins', fontSize: 8.5, color: colour['coral-deep'] },
  footerText: { fontSize: 7.5, color: colour['ink-muted'] },

  h2: { fontFamily: 'Poppins', fontWeight: 600, fontSize: 17, color: colour.teal, marginBottom: 10 },
  section: { marginBottom: 22 },
  body: { fontSize: 10.5, lineHeight: 1.6, color: colour['ink-soft'] },
  note: { fontSize: 8.5, lineHeight: 1.5, color: colour['ink-muted'], marginTop: 6 },

  card: { backgroundColor: colour.mist, borderRadius: 9, paddingVertical: 15, paddingHorizontal: 19, marginBottom: 11 },
  areaLabel: { fontSize: 8.5, letterSpacing: 1, color: colour['ink-muted'], marginBottom: 9 },
  track: { height: 8, borderRadius: 4, backgroundColor: colour.sand, marginBottom: 8 },
  fill: { height: 8, borderRadius: 4, backgroundColor: colour.teal },
  areaCaption: { fontSize: 9, color: colour['ink-soft'] },

  bulletRow: { flexDirection: 'row', marginBottom: 5 },
  bullet: { width: 4, height: 4, borderRadius: 2, backgroundColor: colour.coral, marginTop: 6, marginRight: 9 },
  bulletText: { flex: 1, fontSize: 10.5, lineHeight: 1.6, color: colour['ink-soft'] },

  callout: { backgroundColor: colour.cream, borderLeftWidth: 3, borderLeftColor: colour.teal, borderTopRightRadius: 6, borderBottomRightRadius: 6, padding: 13, marginBottom: 9 },
  calloutText: { fontSize: 10, lineHeight: 1.6, color: colour['ink-soft'] },
  crisis: { backgroundColor: colour.mist, borderLeftWidth: 3, borderLeftColor: colour.teal, borderTopRightRadius: 9, borderBottomRightRadius: 9, padding: 16, marginBottom: 22 },
  crisisText: { fontSize: 11, lineHeight: 1.6, color: colour.ink },
  plan: { backgroundColor: colour.mist, borderRadius: 9, padding: 16 },
  planText: { fontFamily: 'Poppins', fontWeight: 500, fontSize: 11, lineHeight: 1.55, color: colour.ink },
});

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

export interface ReportPdfProps {
  doc: ReportDocument;
  clientName: string;
  testName: string;
}

export function ReportPdf({ doc, clientName, testName }: ReportPdfProps) {
  registerFonts();
  const { logo } = pdfAssets();
  const lang: Lang = doc.sections.en ? 'en' : (doc.languages[0] ?? 'en');
  const r = doc.sections[lang] as ReportSection;

  // Numbered sections in the order of the developer spec (section 7). Crisis layout: plan and focus
  // are already null in the stored document.
  // keep: short sections that must not split from their heading across pages.
  const sections: { heading: string | null; body: React.ReactNode; keep?: boolean }[] = [];
  sections.push({
    heading: r.snapshot.heading,
    body: (
      <>
        {r.snapshot.areas.map((a) => (
          <AreaCard key={a.module} area={a} />
        ))}
        {r.snapshot.note && <Text style={s.note}>{r.snapshot.note}</Text>}
      </>
    ),
  });
  if (r.strengths.items.length) sections.push({ heading: r.strengths.heading, body: <Bullets items={r.strengths.items} /> });
  if (r.stuck.items.length) sections.push({ heading: r.stuck.heading, body: <Bullets items={r.stuck.items} /> });
  if (r.means.items.length) {
    sections.push({
      heading: r.means.heading,
      body: r.means.items.map((t, i) => (
        <Text key={i} style={[s.body, { marginBottom: 7 }]}>
          {t}
        </Text>
      )),
    });
  }
  if (r.plan) {
    sections.push({
      heading: r.plan.heading,
      keep: true,
      body: (
        <>
          {r.plan.line && (
            <View style={s.plan} wrap={false}>
              <Text style={s.planText}>{r.plan.line}</Text>
            </View>
          )}
          {r.plan.extra.map((t, i) => (
            <Text key={i} style={[s.body, { marginTop: 8 }]}>
              {t}
            </Text>
          ))}
        </>
      ),
    });
  }
  if (r.focus?.items.length) sections.push({ heading: r.focus.heading, body: <Bullets items={r.focus.items} /> });
  const medical = r.blocks.filter((b) => b.kind === 'medical');
  const other = r.blocks.filter((b) => b.kind !== 'medical');
  if (other.length) sections.push({ heading: null, body: <Callouts texts={other.map((b) => b.text)} /> });
  if (medical.length) sections.push({ heading: r.medicalHeading, body: <Callouts texts={medical.map((b) => b.text)} /> });
  if (r.next.heading || r.next.text) {
    sections.push({ heading: r.next.heading, keep: true, body: r.next.text ? <Text style={s.body}>{r.next.text}</Text> : null });
  }
  if (r.nri) sections.push({ heading: null, keep: true, body: <Text style={s.body}>{r.nri}</Text> });

  let n = 0;
  const date = formatDate(doc.completedAt);

  return (
    <Document title={doc.reportId ?? 'Report'} author="My Fit Brain" creator="My Fit Brain" producer="My Fit Brain">
      {/* Cover */}
      <Page size="A4" style={s.cover}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
        <Image style={s.coverLogo} src={{ data: logo.endorsed, format: 'png' }} />
        <View style={s.coverBody}>
          <View style={s.bindu} />
          <Text style={s.coverTitle}>{testName}</Text>
          {r.designedBy && <Text style={s.coverSubtitle}>{r.designedBy}</Text>}
        </View>
        <View style={s.fields}>
          <Field label="PREPARED FOR" value={clientName} />
          <Field label="DATE" value={date} />
          <Field label="REPORT ID" value={doc.reportId ?? '—'} />
        </View>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
        <Image style={s.seal} src={{ data: logo.seal, format: 'png' }} />
        <View style={s.band}>{r.disclaimer && <Text style={s.bandText}>{r.disclaimer}</Text>}</View>
      </Page>

      {/* Content */}
      <Page size="A4" style={s.page}>
        <View style={s.header} fixed>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
          <Image style={s.headerLogo} src={{ data: logo.horizontal, format: 'png' }} />
          <Text style={s.headerText}>
            {testName} · {clientName}
          </Text>
        </View>

        {doc.layout === 'crisis' && r.crisis && (
          <View style={s.crisis} wrap={false}>
            <Text style={s.crisisText}>{r.crisis}</Text>
          </View>
        )}

        {sections.map((sec, i) => {
          const numbered = sec.heading ? `${++n}. ${sec.heading}` : null;
          return (
            <View key={i} style={s.section} wrap={!sec.keep}>
              {numbered && (
                <Text style={s.h2} minPresenceAhead={110}>
                  {numbered}
                </Text>
              )}
              {sec.body}
            </View>
          );
        })}

        <View style={s.footer} fixed>
          <Text style={s.footerBrand}>{BRAND_LINE}</Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `${FOOTER_LINE}   ·   ${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldValue}>{value}</Text>
    </View>
  );
}

function AreaCard({ area }: { area: ReportArea }) {
  const pct = Math.max(0, Math.min(100, area.percent ?? 0));
  const caption = [area.percent !== null ? `${area.percent}%` : null, area.bandName].filter(Boolean).join(' · ');
  return (
    <View style={s.card} wrap={false}>
      <Text style={s.areaLabel}>{(area.name ?? area.module).toUpperCase()}</Text>
      <View style={s.track}>
        <View style={[s.fill, { width: `${pct}%` }]} />
      </View>
      {caption && <Text style={s.areaCaption}>{caption}</Text>}
    </View>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <View>
      {items.map((t, i) => (
        <View key={i} style={s.bulletRow} wrap={false}>
          <View style={s.bullet} />
          <Text style={s.bulletText}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

function Callouts({ texts }: { texts: string[] }) {
  return (
    <View>
      {texts.map((t, i) => (
        <View key={i} style={s.callout} wrap={false}>
          <Text style={s.calloutText}>{t}</Text>
        </View>
      ))}
    </View>
  );
}
