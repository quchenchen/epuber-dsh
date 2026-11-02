/**
 * 《材料格式》—— WorkDSH 所有 Word 交付的默认版式。
 *
 * Values are measured from the reference document the media centre supplies for
 * outward-facing material (`材料格式.docx`, one A4 section):
 *
 *   page    A4 portrait, top/bottom 99.25pt (3.5cm), left/right 79.4pt (2.8cm),
 *           header 42.55pt, footer 70.9pt
 *   body    仿宋_GB2312 16pt (三号), first-line indent 2 chars (32pt),
 *           fixed line spacing 29pt, 14.3pt after
 *   title   宋体 22pt (二号), bold, centred
 *   h1      黑体 16pt, bold, first-line indent 2 chars   (一、)
 *   h2      仿宋_GB2312 16pt, bold, first-line indent 2 chars   (（一）)
 *   h3      仿宋_GB2312 16pt, bold, first-line indent 2 chars   (1.)
 *   footer  — 1 — centred, 宋体 14pt (四号)
 *
 * OOXML stores lengths in twentieths of a point, so every pt value below is
 * multiplied by 20 at the use site. Latin text and digits use Times New Roman,
 * which is the convention for Chinese official material even though the sample
 * only names the East Asian font.
 *
 * This module is the single source for that layout: the DOCX writer applies it
 * to every export, so an expert, a Skill or a direct tool call all deliver the
 * same document instead of each inventing its own styling.
 */
export const MATERIAL_FORMAT = {
  page: {
    widthTwips: 11906,
    heightTwips: 16838,
    marginTopTwips: 1985,
    marginBottomTwips: 1985,
    marginLeftTwips: 1588,
    marginRightTwips: 1588,
    headerTwips: 851,
    footerTwips: 1418,
  },
  latinFont: "Times New Roman",
  body: {
    eastAsiaFont: "仿宋_GB2312",
    sizeHalfPoints: 32,
    /** Fixed 29pt line spacing: w:line is in twentieths of a point. */
    lineTwips: 580,
    /** Body paragraphs carry 14.3pt before and after, as in the reference. */
    beforeTwips: 286,
    afterTwips: 286,
    firstLineTwips: 640,
  },
  title: { eastAsiaFont: "宋体", sizeHalfPoints: 44, bold: true },
  heading1: { eastAsiaFont: "黑体", sizeHalfPoints: 32 },
  heading2: { eastAsiaFont: "仿宋_GB2312", sizeHalfPoints: 32 },
  heading3: { eastAsiaFont: "仿宋_GB2312", sizeHalfPoints: 32 },
  footer: { eastAsiaFont: "宋体", sizeHalfPoints: 28 },
} as const;

/** Heading styles in the order the writer receives them (heading 1..6). */
export const MATERIAL_HEADINGS = [
  // Heading 1 is the document title: centred, no indent.
  { ...MATERIAL_FORMAT.title, align: "center", firstLineTwips: 0, beforeTwips: 0, afterTwips: 286 },
  // H2..H4 are the 一、 / （一） / 1. levels: indented two characters, no spacing.
  { ...MATERIAL_FORMAT.heading1, align: "left", firstLineTwips: MATERIAL_FORMAT.body.firstLineTwips, beforeTwips: 0, afterTwips: 0 },
  { ...MATERIAL_FORMAT.heading2, align: "left", firstLineTwips: MATERIAL_FORMAT.body.firstLineTwips, beforeTwips: 0, afterTwips: 0 },
  { ...MATERIAL_FORMAT.heading3, align: "left", firstLineTwips: MATERIAL_FORMAT.body.firstLineTwips, beforeTwips: 0, afterTwips: 0 },
  // Deeper levels keep the same size and indentation; the model should rarely need them.
  { ...MATERIAL_FORMAT.heading3, align: "left", firstLineTwips: MATERIAL_FORMAT.body.firstLineTwips, beforeTwips: 0, afterTwips: 0 },
  { ...MATERIAL_FORMAT.heading3, align: "left", firstLineTwips: MATERIAL_FORMAT.body.firstLineTwips, beforeTwips: 0, afterTwips: 0 },
] as const;
