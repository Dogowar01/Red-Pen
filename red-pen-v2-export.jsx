import { useState, useMemo } from "react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const STOP = new Set(["the","a","an","and","or","but","if","then","is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","could","should","may","might","must","of","to","in","on","at","by","for","with","about","against","between","through","during","before","after","above","below","from","up","down","out","off","over","under","again","further","once","here","there","when","where","why","how","all","each","every","both","few","more","most","other","some","such","no","not","only","own","same","so","than","too","very","s","t","can","just","this","that","these","those","i","me","my","you","your","he","him","his","she","her","it","its","we","us","our","they","them","their","what","which","who","whom","as","into","like","one","also","any","because","now","said","says","say"]);

const CRUTCH = {"suddenly":"vague time marker — show the abruptness","just":"filler intensifier — usually deletable","really":"weak intensifier — find a stronger word","very":"weak intensifier — find a stronger word","quite":"weak hedge — usually deletable","actually":"filler — usually deletable","began":"filtering verb — show the action directly","started":"filtering verb — show the action directly","felt":"emotion-tell — show the feeling","seemed":"uncertainty hedge — be direct","appeared":"uncertainty hedge — be direct","noticed":"POV filter — drop it, show the thing","realized":"telling — show the realisation unfold","watched":"POV filter — usually deletable","heard":"POV filter — usually deletable","thought":"internal filter — go direct to the thought","wondered":"internal filter — go direct to the question","somehow":"vague — explain or cut","somewhat":"weak hedge — cut","nodded":"overused gesture","shrugged":"overused gesture","sighed":"overused gesture","smiled":"overused gesture","frowned":"overused gesture","literally":"filler","basically":"filler"};

const TYPE_COLORS = {"Throat-clearing":"#ef4444","Adverb stuffing":"#f97316","Emotion-telling":"#a855f7","Hollow intensifiers":"#f59e0b","Passive constructions":"#3b82f6","Redundant body language":"#06b6d4","Over-explaining":"#84cc16","AI filler phrases":"#ec4899","Repetitive sentence rhythm":"#8b5cf6","Stage directions":"#14b8a6","Sycophantic cadence":"#fb7185","Sterile metaphors":"#f472b6"};
function typeColor(t) { for (const [k,v] of Object.entries(TYPE_COLORS)) if (t.toLowerCase().includes(k.toLowerCase())) return v; return "#94a3b8"; }

// ─── TEXT UTILITIES ───────────────────────────────────────────────────────────

function countWords(t) { return t.trim() ? t.trim().split(/\s+/).length : 0; }
function splitSentences(t) {
  const c = t.replace(/\b(Mr|Mrs|Ms|Dr|Jr|Sr|St|Lt|Sgt|Prof|vs|etc|e\.g|i\.e)\./gi,"$1<D>");
  return (c.match(/[^.!?]+[.!?]+["']?/g)||[]).map(s=>s.replace(/<D>/g,".").trim()).filter(s=>s.length>0);
}
function tokenize(t) { return (t.toLowerCase().match(/\b[a-z'']+\b/g)||[]); }

// ─── LOCAL ANALYSIS FUNCTIONS ─────────────────────────────────────────────────

function computePacing(text, wc) {
  if (wc < 50) return null;
  const sents = splitSentences(text);
  const lens = sents.map(s => s.split(/\s+/).filter(Boolean).length);
  if (!lens.length) return null;
  const avg = lens.reduce((a,b)=>a+b,0)/lens.length;
  const stdDev = Math.sqrt(lens.reduce((a,b)=>a+(b-avg)**2,0)/lens.length);
  const burstiness = stdDev/avg;
  const runs = []; let cur=[0];
  for (let i=1;i<lens.length;i++) { if (Math.abs(lens[i]-lens[i-1])<=2) cur.push(i); else { if (cur.length>=4) runs.push([...cur]); cur=[i]; } }
  if (cur.length>=4) runs.push(cur);

  // Sentence starters
  const starterFreq = {};
  const starterSents = [];
  sents.forEach((s, idx) => {
    // Strip leading quote marks and whitespace, grab first word
    const clean = s.replace(/^["'\u201C\u2018\s]+/,'');
    const first = (clean.match(/^([A-Za-z]+)/)||[])[1];
    if (!first) return;
    const w = first.toLowerCase();
    starterFreq[w] = (starterFreq[w]||0)+1;
    starterSents.push({ idx, word: w, original: s });
  });
  const total = starterSents.length || 1;
  // Find overused starters (>15% or >=4 times)
  const overused = Object.entries(starterFreq)
    .filter(([,c]) => c>=4 || (c/total)>=0.15)
    .sort((a,b)=>b[1]-a[1])
    .map(([w,c]) => ({ word:w, count:c, pct:Math.round((c/total)*100) }));
  // Find consecutive same-starter runs (3+)
  const consecRuns = [];
  let cRun = [starterSents[0]];
  for (let i=1;i<starterSents.length;i++) {
    if (starterSents[i].word === starterSents[i-1].word) { cRun.push(starterSents[i]); }
    else { if (cRun.length>=3) consecRuns.push([...cRun]); cRun=[starterSents[i]]; }
  }
  if (cRun.length>=3) consecRuns.push(cRun);
  // Top starters for display
  const topStarters = Object.entries(starterFreq).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([w,c])=>({word:w,count:c,pct:Math.round((c/total)*100)}));

  return { lens, avg, stdDev, burstiness, max:Math.max(...lens), min:Math.min(...lens), runs, total:sents.length, starters:{ overused, consecRuns, topStarters, totalSents:total } };
}

function computeRepeats(text, wc) {
  if (wc < 50) return null;
  const words = tokenize(text);
  const freq = {};
  for (const w of words) if (!STOP.has(w) && w.length>2) freq[w]=(freq[w]||0)+1;
  const repeated = Object.entries(freq).filter(([,c])=>c>=3).sort((a,b)=>b[1]-a[1]).slice(0,20);
  const crutchHits = Object.entries(CRUTCH).map(([word,reason])=>{ const c=words.filter(w=>w===word).length; return c>=2?{word,count:c,reason,per1000:((c/words.length)*1000).toFixed(1)}:null; }).filter(Boolean).sort((a,b)=>b.count-a.count);
  const echoes=[]; const seen=new Set();
  for (let i=0;i<words.length;i++) { if (STOP.has(words[i])||words[i].length<=3) continue; for (let j=i+1;j<Math.min(i+30,words.length);j++) { if (words[i]===words[j]) { const k=`${words[i]}-${i}`; if (!seen.has(k)) { echoes.push({word:words[i],distance:j-i}); seen.add(k); } break; } } }
  return { repeated, crutchHits, echoes:echoes.slice(0,15), totalWords:words.length };
}

function computeDialogueMeta(text, wc) {
  if (wc < 50) return null;
  // Extract dialogue lines (text inside quotes)
  const dialogueMatches = text.match(/[""][^""]{3,}[""]/g) || text.match(/"[^"]{3,}"/g) || [];
  const dialogueWords = dialogueMatches.join(' ').split(/\s+/).filter(Boolean).length;
  const ratio = Math.round((dialogueWords / wc) * 100);
  const lineCount = dialogueMatches.length;
  return { ratio, lineCount, dialogueWords, proseWords: wc - dialogueWords };
}

function computePatterns(text, wc) {
  if (wc < 50) return null;
  const sentences = splitSentences(text);
  const words = tokenize(text);

  // ── Rule of Three (tricolon) ──
  // Matches "A, B, and C" or "A, B, C" where items are 2–40 chars each
  const triRe = /([A-Za-z][^,;.!?]{1,50}),\s+([A-Za-z][^,;.!?]{1,50}),\s+(?:and\s+|or\s+)?([A-Za-z][^,;.!?\n]{1,50})/g;
  const tricolons = [];
  let m;
  while ((m = triRe.exec(text)) !== null) {
    const full = m[0].trim();
    // Skip very short matches (likely just CSV data) and very long ones
    if (full.length < 12 || full.length > 160) continue;
    // Skip if items are single words (likely a plain list, not a rhetorical tricolon)
    const items = [m[1].trim(), m[2].trim(), m[3].trim()];
    const avgLen = items.reduce((a,b)=>a+b.split(' ').length,0)/3;
    if (avgLen < 2) continue;
    tricolons.push({ text: full, items });
  }

  // ── List rhythm stacking ──
  // Sentences with 3+ comma groups (potential list stacking)
  const listySentences = sentences.filter(s => (s.match(/,/g)||[]).length >= 3);
  // Paragraphs with 2+ listy sentences (stacking risk)
  const paragraphs = text.split(/\n\n+/);
  const stackedParas = paragraphs.filter(p => {
    const pSents = splitSentences(p);
    return pSents.filter(s => (s.match(/,/g)||[]).length >= 3).length >= 2;
  });
  // Find sentences with parallel "X, Y, and Z and A, B, and C" double-stacking
  const doubleStacks = sentences.filter(s => {
    const m2 = s.match(/(?:[A-Za-z][^,]{1,40},\s*){2,}(?:and|or)\s+[A-Za-z]/g);
    return m2 && m2.length >= 2;
  });

  // ── Simile / metaphor stacking ──
  // Local proxy: "like a/an/the", "as X as", direct metaphor verbs ("was a", "were a" near noun phrases)
  const simileRe = /\blike\s+(?:a|an|the)\s+\w+(?:\s+\w+){0,3}|\bas\s+\w+\s+as\s+(?:a|an|the)\s+\w+/gi;
  const personRe = /\b(?:the\s+\w+\s+(?:whispered|howled|groaned|breathed|sang|danced|wept|laughed|screamed|clawed|reached|waited|watched|refused|demanded|offered|swallowed)|(?:darkness|silence|wind|rain|light|shadow|time|fear|grief|hope|sky|earth|fire|water|stone)\s+(?:swallowed|consumed|devoured|embraced|reached|clawed|pressed|wrapped|settled|crept|crawled|hunted|watched))/gi;
  const allFigurative = [];
  let fm;
  const simileRe2 = new RegExp(simileRe.source, 'gi');
  while ((fm = simileRe2.exec(text)) !== null) allFigurative.push({ text: fm[0], index: fm.index, type: 'simile' });
  const personRe2 = new RegExp(personRe.source, 'gi');
  while ((fm = personRe2.exec(text)) !== null) allFigurative.push({ text: fm[0], index: fm.index, type: 'personification' });
  allFigurative.sort((a,b) => a.index - b.index);
  // Find stacks: 2+ figurative devices within 100 chars of each other
  const figStacks = [];
  for (let i = 0; i < allFigurative.length - 1; i++) {
    if (allFigurative[i+1].index - allFigurative[i].index <= 120) {
      figStacks.push({ a: allFigurative[i], b: allFigurative[i+1],
        context: text.slice(Math.max(0, allFigurative[i].index - 10), allFigurative[i+1].index + allFigurative[i+1].text.length + 10).trim()
      });
    }
  }

  // ── Contrast structures ("not X but Y") ──
  const contrastRe = /\bnot\s+[^,;.!?\n]{3,50}(?:,\s+|\s+)but\s+[^,;.!?\n]{3,60}|\brather\s+than\s+[^,;.!?\n]{3,50}|\binstead\s+of\s+[^,;.!?\n]{3,50}(?:,\s+[^,;.!?\n]{3,50})?|\b(?:less|more)\s+\w+(?:\s+\w+)?\s+than\s+[^,;.!?\n]{3,40}/gi;
  const contrasts = [];
  while ((m = contrastRe.exec(text)) !== null) contrasts.push({ text: m[0].trim(), index: m.index });
  const contrastStacks = [];
  for (let i = 0; i < contrasts.length - 1; i++) {
    if (contrasts[i+1].index - contrasts[i].index <= 300) {
      contrastStacks.push([contrasts[i], contrasts[i+1]]);
    }
  }

  // ── Clean pivot sentences ──
  // Formulaic wrap-up/transition sentences AI loves: "With that,", "And so", "That changed everything" etc.
  const pivotPatterns = [
    /\bwith\s+that[,.]?\s/gi,
    /\band\s+(?:just\s+)?(?:like\s+that|so)[,.]?\s/gi,
    /\bin\s+the\s+end[,.]?\s/gi,
    /\bafter\s+all[,.]?\s/gi,
    /\bthat\s+(?:was\s+that|changed\s+everything|was\s+all|would\s+have\s+to\s+(?:be\s+)?enough|settled\s+it|did\s+it)[.!]/gi,
    /\bit\s+was\s+(?:done|over|decided|settled|enough|time)\b/gi,
    /\bnothing\s+(?:would\s+ever\s+)?(?:be\s+the\s+same|could\s+change\s+that|else\s+mattered)/gi,
    /\beverything\s+(?:changed|was\s+different|had\s+changed)\b/gi,
    /\b(?:she|he|they)\s+(?:didn't|did\s+not)\s+look\s+back\b/gi,
    /\b(?:there\s+was\s+)?(?:no\s+going\s+back|no\s+turning\s+back|no\s+choice|no\s+other\s+(?:way|option))\b/gi,
    /\bso\s+(?:it\s+was|be\s+it|it\s+went)\b[.!]/gi,
    /\b(?:she|he|they)\s+had\s+(?:made\s+(?:her|his|their)\s+(?:choice|decision)|no\s+choice)\b/gi,
    /\bthe\s+(?:die\s+was\s+cast|matter\s+was\s+(?:settled|closed))\b/gi,
  ];
  const pivots = [];
  for (const re of pivotPatterns) {
    let pm;
    const re2 = new RegExp(re.source, 'gi');
    while ((pm = re2.exec(text)) !== null) {
      // Get surrounding sentence for context
      const sentStart = Math.max(0, text.lastIndexOf('\n', pm.index) + 1);
      const sentEnd = text.indexOf('\n', pm.index + pm[0].length);
      const sentence = text.slice(sentStart, sentEnd === -1 ? pm.index + 80 : Math.min(sentEnd, pm.index + 100)).trim();
      pivots.push({ text: pm[0].trim(), sentence: sentence.slice(0, 120), index: pm.index });
    }
  }
  // Deduplicate by index proximity
  const seenPivotIdx = new Set();
  const uniquePivots = pivots.filter(p => {
    const key = Math.floor(p.index / 20);
    if (seenPivotIdx.has(key)) return false;
    seenPivotIdx.add(key); return true;
  }).sort((a,b) => a.index - b.index);

  // ── Emotional shorthand stacking ──
  // Pre-packaged emotional signals — fine once, AI-ish when stacked
  const emotionShorthand = [
    { re: /\b(?:his|her|their|my)\s+(?:heart)\s+(?:sank|pounded|raced|hammered|lurched|leapt|skipped a beat|dropped|clenched|constricted|ached|seized|stuttered|froze|stopped)/gi, label:'heart [verb]' },
    { re: /\b(?:his|her|their|my)\s+(?:breath)\s+(?:caught|hitched|escaped|rushed out|held|stopped|came fast|came short)/gi, label:'breath [verb]' },
    { re: /\b(?:his|her|their|my)\s+(?:stomach)\s+(?:dropped|churned|lurched|tightened|knotted|twisted|sank|turned|flipped)/gi, label:'stomach [verb]' },
    { re: /\b(?:his|her|their|my)\s+(?:chest)\s+(?:tightened|constricted|ached|hurt|seized|heaved|compressed|caved)/gi, label:'chest [verb]' },
    { re: /\b(?:his|her|their|my)\s+(?:throat)\s+(?:tightened|closed|constricted|burned|ached|went dry|knotted|swelled|seized)/gi, label:'throat [verb]' },
    { re: /\b(?:his|her|their|my)\s+(?:jaw)\s+(?:clenched|tightened|set|dropped|locked|went tight)/gi, label:'jaw [verb]' },
    { re: /\btears?\s+(?:pricked|burned|stung|welled|blurred|filled|fell|streamed|spilled|threatened|formed)/gi, label:'tears [verb]' },
    { re: /\b(?:his|her|their|my)\s+eyes?\s+(?:burned|stung|pricked|widened|went wide|blurred|filled|grew hot|watered)/gi, label:'eyes [verb]' },
    { re: /\b(?:a\s+)?(?:knot|lump)\s+(?:formed\s+in|rose\s+in|settled\s+in|sat\s+in|in)\s+(?:his|her|their|my)\s+(?:throat|chest|stomach)/gi, label:'knot/lump in throat' },
    { re: /\b(?:heat|warmth|cold|chill|ice)\s+(?:rose|spread|flooded|crept|settled|washed|shot|ran|crawled)\s+(?:through|up|down|into|across)\s+(?:his|her|their|my)/gi, label:'physical sensation spread' },
    { re: /\b(?:his|her|their|my)\s+(?:skin)\s+(?:prickled|crawled|tingled|burned|went cold|went hot|flushed)/gi, label:'skin [verb]' },
    { re: /\b(?:his|her|their|my)\s+(?:hands?|fingers?)\s+(?:trembled|shook|went cold|went numb|clenched|curled)/gi, label:'hands/fingers [verb]' },
    { re: /\b(?:a\s+)?(?:wave|surge|rush|flood)\s+of\s+(?:relief|dread|fear|guilt|shame|nausea|panic|anger|grief|sadness|sorrow|despair)/gi, label:'wave/surge of [emotion]' },
  ];
  const allShorthand = [];
  for (const { re, label } of emotionShorthand) {
    let em;
    const re2 = new RegExp(re.source, 'gi');
    while ((em = re2.exec(text)) !== null) allShorthand.push({ text: em[0].trim(), label, index: em.index });
  }
  allShorthand.sort((a,b) => a.index - b.index);
  // Find stacks: 2+ within 200 words (~1200 chars)
  const shorthandStacks = [];
  const usedInStack = new Set();
  for (let i = 0; i < allShorthand.length - 1; i++) {
    if (allShorthand[i+1].index - allShorthand[i].index <= 1200) {
      shorthandStacks.push({ a: allShorthand[i], b: allShorthand[i+1],
        context: text.slice(Math.max(0, allShorthand[i].index - 20), allShorthand[i+1].index + allShorthand[i+1].text.length + 20).trim()
      });
      usedInStack.add(i); usedInStack.add(i+1);
    }
  }

  return {
    tricolons,
    listySentences,
    stackedParas,
    doubleStacks,
    allFigurative,
    figStacks,
    contrasts,
    contrastStacks,
    pivots: uniquePivots,
    allShorthand,
    shorthandStacks,
    totalSentences: sentences.length,
    totalWords: wc,
  };
}

// ─── JSZIP LOADER ─────────────────────────────────────────────────────────────

function loadJSZip() {
  return new Promise((resolve,reject) => {
    if (window.JSZip) return resolve(window.JSZip);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = () => resolve(window.JSZip);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ─── DOCX IMPORT ─────────────────────────────────────────────────────────────

async function importDocx(file) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(file);
  const xmlFile = zip.file('word/document.xml');
  if (!xmlFile) throw new Error('Could not find document content. Is this a valid .docx file?');
  const xml = await xmlFile.async('string');
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const paragraphs = doc.getElementsByTagNameNS(NS, 'p');
  const lines = [];
  for (const para of paragraphs) {
    let line = '';
    const runs = para.getElementsByTagNameNS(NS, 'r');
    for (const run of runs) {
      if (run.parentElement?.localName === 'del') continue;
      const ts = run.getElementsByTagNameNS(NS, 't');
      for (const t of ts) line += t.textContent;
      if (run.getElementsByTagNameNS(NS, 'br').length) line += '\n';
    }
    lines.push(line);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ─── DOCX EXPORT ─────────────────────────────────────────────────────────────

const xe = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function xrun(text, p={}) {
  const {b,i,color,sz} = p;
  const rpr = [b?'<w:b/><w:bCs/>':'',i?'<w:i/>':'',color?`<w:color w:val="${color}"/>`:'',sz?`<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`:''].filter(Boolean).join('');
  return `<w:r>${rpr?`<w:rPr>${rpr}</w:rPr>`:''}<w:t xml:space="preserve">${xe(text)}</w:t></w:r>`;
}
function xpara(runs, style='Normal', before=0, after=160) {
  const sp=(before||after!==160)?`<w:spacing${before?` w:before="${before}"`:''} w:after="${after}"/>`:'';
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${sp}</w:pPr>${Array.isArray(runs)?runs.join(''):runs}</w:p>`;
}
const xh1 = t => xpara(xrun(t),'Heading1',480,160);
const xh2 = t => xpara(xrun(t),'Heading2',280,120);
const xp  = (t,p={}) => xpara(xrun(t,p),'Normal',0,p.after!==undefined?p.after:120);
const xbr = () => '<w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>';
const xhr  = () => '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="DDDDDD"/></w:pBdr><w:spacing w:before="120" w:after="200"/></w:pPr></w:p>';

function buildDocumentXml({ wordCount, aiisms, pacing, repeats, showTell, dialogue, tension, sourceName }) {
  const date = new Date().toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'});
  const ps = [];

  ps.push(xpara(xrun('The Red Pen',{b:true}),'Heading1',0,80));
  ps.push(xpara(xrun('Editorial Analysis Report',{sz:28,color:'555555'}),'Normal',0,60));
  ps.push(xpara(xrun(`${date}  ·  ${wordCount.toLocaleString()} words${sourceName?`  ·  ${sourceName}`:''}`,{sz:20,color:'999999'}),'Normal',0,280));
  ps.push(xhr());

  // Analyses included summary
  ps.push(xpara(xrun('Analyses Included',{b:true,sz:22}),'Normal',0,80));
  [
    [aiisms,  'AI-isms Analysis',        `Score ${aiisms?.score}/10 · ${aiisms?.flags?.length||0} flags`],
    [pacing,  'Pacing & Sentence Starters', `${pacing?.total} sentences · ${pacing?.starters?.overused?.length||0} overused starters`],
    [repeats, 'Word Usage & Repeats',    `${repeats?.crutchHits?.length} crutch words`],
    [showTell,'Show vs Tell',            `${showTell?.ratio}% shown`],
    [dialogue,'Dialogue Health',         `${dialogue?.dialogueRatio}% dialogue · ${dialogue?.flags?.length||0} flags`],
    [tension, 'Tension & Stakes',        `Arc: ${tension?.arc}`],
  ].forEach(([r,l,n])=>ps.push(xpara([xrun(r?'✓  ':'—  ',{color:r?'166534':'999999'}),xrun(l,{b:!!r,color:r?'1E293B':'999999'}),xrun(r?`  —  ${n}`:'  (not run)',{color:'888888',sz:20})],'Normal',0,60)));
  ps.push(xbr());

  // ── AI-ISMS
  if (aiisms) {
    ps.push(xh1('AI-isms Analysis'));
    const sc=aiisms.score, scC=sc>=6?'16A34A':sc>=4?'D97706':'DC2626';
    const scL=sc>=8?'Strong Human Voice':sc>=6?'Mostly Human':sc>=4?'Needs Work':'Heavy AI Patterns';
    ps.push(xpara([xrun('Humanity Score  ',{b:true}),xrun(`${sc}/10`,{b:true,sz:28,color:scC}),xrun(`   ${scL}`,{color:'666666'})],'Normal',0,120));
    ps.push(xpara(xrun(aiisms.summary,{i:true,color:'444444'}),'Normal',0,240));
    if (aiisms.flags?.length) {
      ps.push(xh2(`${aiisms.flags.length} Flag${aiisms.flags.length!==1?'s':''} Raised`));
      aiisms.flags.forEach((f,i)=>{
        ps.push(xpara([xrun(`#${String(i+1).padStart(2,'0')}  `,{color:'AAAAAA',sz:20}),xrun(f.type,{b:true,color:'9B2335'})],'Normal',i===0?0:200,40));
        ps.push(xpara(xrun(`"${f.original}"`,{i:true,color:'555555'}),'Normal',0,60));
        ps.push(xpara([xrun('Why: ',{b:true,color:'444444'}),xrun(f.reason,{color:'555555'})],'Normal',0,60));
        ps.push(xpara([xrun('Rewrite: ',{b:true,color:'166534'}),xrun(`"${f.suggestion}"`,{i:true,color:'15803D'})],'Normal',0,100));
      });
    }
    ps.push(xhr());
  }

  // ── PACING
  if (pacing) {
    ps.push(xh1('Pacing & Sentence Starters'));
    const rl=pacing.burstiness<0.35?'Monotonous':pacing.burstiness<0.55?'Steady':pacing.burstiness<0.85?'Varied':'Highly Varied';
    const rc=pacing.burstiness<0.35?'DC2626':pacing.burstiness<0.55?'D97706':'16A34A';
    ps.push(xpara([xrun('Rhythm: ',{b:true}),xrun(rl,{b:true,color:rc}),xrun(`   Avg ${pacing.avg.toFixed(1)} words/sentence  ·  Range ${pacing.min}–${pacing.max}`,{color:'777777'})],'Normal',0,120));
    const notes=[];
    if (pacing.burstiness<0.35) notes.push('Sentence lengths are too uniform — a primary AI-detection signal. Vary structure deliberately.');
    else if (pacing.burstiness<0.55) notes.push('Rhythm is steady but could use more dramatic variation at emotional peaks.');
    else notes.push('Good sentence-length variation — reads with natural human rhythm.');
    if (pacing.runs?.length) notes.push(`${pacing.runs.length} run${pacing.runs.length>1?'s':''} of 4+ consecutive similar-length sentences detected. Break these up.`);
    notes.forEach(n=>ps.push(xpara([xrun('• ',{color:'AAAAAA'}),xrun(n,{color:'444444'})],'Normal',0,80)));
    ps.push(xh2('Sentence Starter Analysis'));
    if (pacing.starters?.overused?.length) {
      ps.push(xp('Overused sentence openers:',{color:'444444',after:60}));
      pacing.starters.overused.forEach(s=>ps.push(xpara([xrun(`${s.word}`,{b:true,color:'92400E'}),xrun(`  ×${s.count}  (${s.pct}% of sentences)  `,{}),xrun('— vary your sentence structures to open differently',{color:'777777',sz:20})],'Normal',0,60)));
    }
    if (pacing.starters?.consecRuns?.length) {
      ps.push(xbr());
      ps.push(xp(`${pacing.starters.consecRuns.length} run${pacing.starters.consecRuns.length>1?'s':''} of 3+ consecutive sentences starting with the same word:`,{color:'DC2626',after:60}));
      pacing.starters.consecRuns.forEach(run=>ps.push(xpara([xrun(`"${run[0].word}"`,{b:true,color:'DC2626'}),xrun(`  ${run.length} in a row — restructure to break the pattern`,{color:'777777'})],'Normal',0,60)));
    }
    if (!pacing.starters?.overused?.length && !pacing.starters?.consecRuns?.length) ps.push(xp('No significant sentence-starter repetition detected.',{color:'16A34A'}));
    ps.push(xhr());
  }

  // ── REPEATS
  if (repeats) {
    ps.push(xh1('Word Usage & Repeats'));
    ps.push(xh2(`Crutch Words  (${repeats.crutchHits.length} flagged)`));
    if (!repeats.crutchHits.length) ps.push(xp('No overused crutch words.',{color:'16A34A'}));
    else repeats.crutchHits.forEach(h=>ps.push(xpara([xrun(`${h.word}`,{b:true,color:'92400E'}),xrun(`  ×${h.count}  (${h.per1000}/1k)`,{}),xrun(`   —   ${h.reason}`,{color:'555555'})],'Normal',0,80)));
    ps.push(xbr());
    ps.push(xh2(`Close Echoes  (${repeats.echoes.length} found)`));
    if (!repeats.echoes.length) ps.push(xp('No close-proximity repetitions.',{color:'16A34A'}));
    else ps.push(xp(repeats.echoes.map(e=>`${e.word} (${e.distance}w)`).join('   ·   '),{color:'0E7490'}));
    if (repeats.repeated?.length) { ps.push(xbr()); ps.push(xh2('Most Repeated Content Words')); ps.push(xp(repeats.repeated.map(([w,c])=>`${w} ×${c}`).join('   ·   '),{color:'6D28D9'})); }
    ps.push(xhr());
  }

  // ── SHOW vs TELL
  if (showTell) {
    ps.push(xh1('Show vs Tell Analysis'));
    const rc=showTell.ratio>=70?'16A34A':showTell.ratio>=50?'D97706':'DC2626';
    const rl=showTell.ratio>=75?'Strongly Shown':showTell.ratio>=60?'Mostly Shown':showTell.ratio>=45?'Balanced':showTell.ratio>=30?'Too Much Telling':'Heavily Told';
    ps.push(xpara([xrun(`${showTell.ratio}%`,{b:true,sz:28,color:rc}),xrun(' shown',{b:true,color:rc}),xrun(`   ${showTell.showCount} showing · ${showTell.tellCount} telling   `,{color:'777777'}),xrun(rl,{b:true,color:rc})],'Normal',0,120));
    ps.push(xpara(xrun(showTell.summary,{i:true,color:'444444'}),'Normal',0,240));
    if (showTell.tellingExamples?.length) {
      ps.push(xh2('Convert to Showing'));
      showTell.tellingExamples.forEach(e=>{
        ps.push(xpara(xrun(`"${e.text}"`,{i:true,color:'991B1B'}),'Normal',160,40));
        ps.push(xpara([xrun('Issue: ',{b:true}),xrun(e.issue,{color:'555555'})],'Normal',0,60));
        ps.push(xpara([xrun('Show it: ',{b:true,color:'166534'}),xrun(`"${e.rewrite}"`,{i:true,color:'15803D'})],'Normal',0,140));
      });
    }
    if (showTell.showingExamples?.length) {
      ps.push(xh2("Strong Showing — What's Working"));
      showTell.showingExamples.forEach(e=>{
        ps.push(xpara(xrun(`"${e.text}"`,{i:true,color:'15803D'}),'Normal',80,40));
        ps.push(xp(e.strength,{color:'555555'}));
      });
    }
    ps.push(xhr());
  }

  // ── DIALOGUE
  if (dialogue) {
    ps.push(xh1('Dialogue Health'));
    const dc=dialogue.dialogueRatio>=50?'3B82F6':dialogue.dialogueRatio>=20?'16A34A':'D97706';
    ps.push(xpara([xrun(`${dialogue.dialogueRatio}%`,{b:true,sz:28,color:dc}),xrun(' dialogue',{b:true,color:dc}),xrun(`   ${dialogue.lineCount} exchanges  ·  ${dialogue.proseDialogueBalance}`,{color:'777777'})],'Normal',0,120));
    ps.push(xpara(xrun(dialogue.summary,{i:true,color:'444444'}),'Normal',0,240));
    if (dialogue.flags?.length) {
      ps.push(xh2(`${dialogue.flags.length} Dialogue Flag${dialogue.flags.length!==1?'s':''}`));
      dialogue.flags.forEach((f,i)=>{
        ps.push(xpara([xrun(`#${String(i+1).padStart(2,'0')}  `,{color:'AAAAAA',sz:20}),xrun(f.type,{b:true,color:'1D4ED8'})],'Normal',i===0?0:200,40));
        ps.push(xpara(xrun(`"${f.original}"`,{i:true,color:'555555'}),'Normal',0,60));
        ps.push(xpara([xrun('Issue: ',{b:true}),xrun(f.reason,{color:'555555'})],'Normal',0,60));
        ps.push(xpara([xrun('Rewrite: ',{b:true,color:'166534'}),xrun(`"${f.suggestion}"`,{i:true,color:'15803D'})],'Normal',0,100));
      });
    }
    if (dialogue.strengths?.length) {
      ps.push(xh2("What's Working"));
      dialogue.strengths.forEach(s=>ps.push(xpara([xrun('✓  ',{color:'166534'}),xrun(s,{color:'444444'})],'Normal',0,80)));
    }
    ps.push(xhr());
  }

  // ── TENSION
  if (tension) {
    ps.push(xh1('Tension & Stakes'));
    const tc=tension.tensionScore>=7?'16A34A':tension.tensionScore>=5?'D97706':'DC2626';
    ps.push(xpara([xrun(`${tension.tensionScore}/10`,{b:true,sz:28,color:tc}),xrun('  Tension Score',{b:true,color:tc}),xrun(`   Arc: ${tension.arc}`,{color:'777777'})],'Normal',0,120));
    ps.push(xpara(xrun(tension.summary,{i:true,color:'444444'}),'Normal',0,200));
    if (tension.hook) { ps.push(xh2('Chapter Hook')); ps.push(xpara([xrun('Assessment: ',{b:true}),xrun(tension.hook,{color:'444444'})],'Normal',0,120)); }
    if (tension.sagPoints?.length) { ps.push(xh2('Where Tension Sags')); tension.sagPoints.forEach(s=>ps.push(xpara([xrun('⚠  ',{color:'D97706'}),xrun(s,{color:'555555'})],'Normal',0,80))); }
    if (tension.ending) { ps.push(xh2('Chapter Ending')); ps.push(xpara([xrun('Assessment: ',{b:true}),xrun(tension.ending,{color:'444444'})],'Normal',0,120)); }
    if (tension.recommendations?.length) { ps.push(xh2('Recommendations')); tension.recommendations.forEach(r=>ps.push(xpara([xrun('→  ',{color:'3B82F6'}),xrun(r,{color:'444444'})],'Normal',0,80))); }
  }

  const sectPr=`<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${ps.join('')}${sectPr}</w:body></w:document>`;
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-AU"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="480" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:b/><w:bCs/><w:sz w:val="40"/><w:szCs w:val="40"/><w:color w:val="1E293B"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="7C3AED"/></w:rPr></w:style></w:styles>`;
}

async function exportDocx(data) {
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  zip.file('[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  zip.file('_rels/.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('word/document.xml', buildDocumentXml(data));
  zip.file('word/styles.xml', buildStylesXml());
  const blob = await zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = data.sourceName?data.sourceName.replace(/[^a-z0-9]/gi,'-').toLowerCase():'analysis';
  a.href=url; a.download=`red-pen-${slug}-${new Date().toISOString().slice(0,10)}.docx`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ─── STYLE HELPERS ────────────────────────────────────────────────────────────

const S = {
  mono: {fontFamily:"'Courier New', monospace"},
  serif: {fontFamily:"Georgia, serif"},
  display: {fontFamily:"'Playfair Display', Georgia, serif"},
  label: {fontFamily:"'Courier New', monospace",fontSize:"0.65rem",color:"#64748b",letterSpacing:"0.15em",textTransform:"uppercase"},
  card: {background:"#0a1628",border:"1px solid #1e293b",borderRadius:"6px",padding:"1.25rem"},
};

function apiCall(system, userContent, maxTokens=4000) {
  return fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:maxTokens,system,messages:[{role:"user",content:userContent}]})})
    .then(r=>r.json())
    .then(d=>{ if(d.error) throw new Error(d.error.message); return JSON.parse(d.content.map(b=>b.text||"").join("").replace(/```json|```/g,"").trim()); });
}

// ─── SHARED COMPONENTS ────────────────────────────────────────────────────────

function Empty({msg}) {
  return <div style={{textAlign:"center",padding:"2rem",border:"1px dashed #1e293b",borderRadius:"6px"}}><p style={{...S.mono,fontSize:"0.7rem",color:"#475569",margin:0}}>{msg}</p></div>;
}

function RunButton({onClick,label,disabled,loading,loadingLabel}) {
  return <button onClick={onClick} disabled={disabled||loading} style={{width:"100%",padding:"0.9rem",background:loading||disabled?"#1e293b":"#ef4444",border:"none",borderRadius:"4px",cursor:loading||disabled?"not-allowed":"pointer",...S.mono,fontSize:"0.75rem",letterSpacing:"0.15em",textTransform:"uppercase",color:loading||disabled?"#475569":"#fff"}}>
    {loading?loadingLabel||"◆ Analysing...":label}
  </button>;
}

function RerunButton({onClick}) {
  return <button onClick={onClick} style={{marginTop:"1rem",width:"100%",padding:"0.7rem",background:"transparent",border:"1px solid #1e293b",borderRadius:"4px",cursor:"pointer",...S.mono,fontSize:"0.65rem",color:"#64748b",letterSpacing:"0.12em",textTransform:"uppercase"}}>↻ Re-run Analysis</button>;
}

function TextInput({text,setText,wordCount,fileName,setFileName}) {
  const [collapsed,setCollapsed]=useState(false);
  const [importing,setImporting]=useState(false);
  const [importErr,setImportErr]=useState(null);

  async function handleFile(e) {
    const file=e.target.files?.[0];
    if(!file) return;
    if(!file.name.endsWith('.docx')){setImportErr('Please select a .docx file.');return;}
    setImporting(true); setImportErr(null);
    try {
      const extracted=await importDocx(file);
      if(!extracted||extracted.length<10) throw new Error('No readable text found.');
      setText(extracted); setFileName(file.name); setCollapsed(false);
    } catch(err){setImportErr(err.message);}
    setImporting(false); e.target.value='';
  }

  return (
    <div style={{marginBottom:"1.25rem"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.6rem"}}>
        <label style={S.label}>Manuscript Text</label>
        <div style={{display:"flex",gap:"0.5rem",alignItems:"center"}}>
          <span style={{...S.mono,fontSize:"0.65rem",color:wordCount>=50?"#4ade80":"#64748b"}}>{wordCount} words</span>
          {text&&<button onClick={()=>setCollapsed(!collapsed)} style={{background:"transparent",border:"1px solid #1e293b",borderRadius:"3px",padding:"0.2rem 0.5rem",cursor:"pointer",...S.mono,fontSize:"0.6rem",color:"#64748b"}}>{collapsed?"▼ expand":"▲ collapse"}</button>}
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:"0.6rem",marginBottom:"0.6rem"}}>
        <label style={{display:"inline-flex",alignItems:"center",gap:"0.4rem",padding:"0.45rem 0.85rem",background:"#0f172a",border:"1px solid #334155",borderRadius:"4px",cursor:importing?"not-allowed":"pointer",...S.mono,fontSize:"0.68rem",color:importing?"#475569":"#94a3b8",letterSpacing:"0.08em",whiteSpace:"nowrap"}}
          onMouseEnter={e=>{if(!importing){e.currentTarget.style.borderColor="#4ade80";e.currentTarget.style.color="#4ade80";}}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor="#334155";e.currentTarget.style.color=importing?"#475569":"#94a3b8";}}>
          <input type="file" accept=".docx" onChange={handleFile} style={{display:"none"}} disabled={importing}/>
          {importing?"◆ Importing...":"⬆ Import .docx"}
        </label>
        {fileName&&!importing&&<span style={{...S.mono,fontSize:"0.6rem",color:"#4ade80",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"220px"}}>✓ {fileName}</span>}
        {importErr&&<span style={{...S.mono,fontSize:"0.6rem",color:"#ef4444"}}>{importErr}</span>}
        <span style={{...S.mono,fontSize:"0.58rem",color:"#334155",marginLeft:"auto",whiteSpace:"nowrap"}}>or paste below</span>
      </div>
      {!collapsed&&<textarea value={text} onChange={e=>{setText(e.target.value);setFileName('');}} placeholder="Paste your chapter, scene, or excerpt — or import a .docx above..." style={{width:"100%",minHeight:text?"120px":"200px",background:"#0a1628",border:"1px solid #1e293b",borderRadius:"6px",color:"#cbd5e1",fontFamily:"Georgia, serif",fontSize:"0.9rem",lineHeight:1.7,padding:"1rem",boxSizing:"border-box",resize:"vertical",outline:"none",caretColor:"#ef4444"}}/>}
    </div>
  );
}

function TabBar({active,onChange}) {
  const tabs=[["aiisms","AI-isms",true],["pacing","Pacing",false],["repeats","Repeats",false],["patterns","Patterns",false],["show-tell","Show vs Tell",true],["dialogue","Dialogue",true],["tension","Tension",true],["rating","Rating",false],["export","Export",false]];
  return (
    <div style={{display:"flex",gap:"0.2rem",marginBottom:"1.25rem",borderBottom:"1px solid #1e293b",overflowX:"auto"}}>
      {tabs.map(([id,label,api])=>{
        const isActive=active===id;
        return <button key={id} onClick={()=>onChange(id)} style={{background:"transparent",border:"none",borderBottom:`2px solid ${isActive?id==="export"?"#4ade80":"#ef4444":"transparent"}`,padding:"0.55rem 0.75rem",cursor:"pointer",...S.mono,fontSize:"0.64rem",color:isActive?"#f1f5f9":"#475569",letterSpacing:"0.07em",textTransform:"uppercase",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:"0.3rem"}}>
          {label}{api&&<span style={{fontSize:"0.48rem",color:isActive?"#ef4444":"#334155"}}>◆</span>}
        </button>;
      })}
    </div>
  );
}

// ─── TAB 1: AI-ISMS ──────────────────────────────────────────────────────────

const AIISM_SYS = `You are an expert literary editor identifying AI writing patterns ("AI-isms") in fiction. Flag: Throat-clearing, Adverb stuffing, Emotion-telling, Hollow intensifiers, Passive constructions, Redundant body language, Over-explaining, AI filler phrases ("tapestry of","couldn't help but","heart pounding"), Repetitive sentence rhythm, Stage directions, Sycophantic cadence, Sterile metaphors. Return ONLY valid JSON, no fences: {"summary":"2-3 sentence overview","score":<1-10>,"flags":[{"id":<int>,"original":"<exact phrase>","type":"<category>","reason":"<why>","suggestion":"<rewrite>"}]}. Max 20 flags. Match author voice.`;

function FlagCard({flag,index,accentColor}) {
  const [open,setOpen]=useState(false);
  const c=accentColor||typeColor(flag.type);
  return (
    <div onClick={()=>setOpen(!open)} style={{background:"#0f172a",border:`1px solid ${open?c+"66":"#1e293b"}`,borderLeft:`3px solid ${c}`,borderRadius:"4px",padding:"0.85rem 1rem",cursor:"pointer",marginBottom:"0.5rem"}}>
      <div style={{display:"flex",gap:"0.75rem"}}>
        <span style={{...S.mono,fontSize:"0.6rem",color:"#475569",minWidth:"1.5rem"}}>#{String(index+1).padStart(2,"0")}</span>
        <div style={{flex:1,minWidth:0}}>
          <span style={{background:c+"22",color:c,border:`1px solid ${c}44`,borderRadius:"3px",padding:"0.1rem 0.5rem",...S.mono,fontSize:"0.6rem"}}>{flag.type}</span>
          <blockquote style={{...S.display,fontSize:"0.85rem",color:"#94a3b8",lineHeight:1.5,margin:"0.4rem 0 0 0",fontStyle:"italic",overflow:"hidden",display:open?"block":"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>"{flag.original}"</blockquote>
          {open&&<div style={{marginTop:"0.75rem",display:"flex",flexDirection:"column",gap:"0.65rem"}}>
            <div><div style={{...S.mono,fontSize:"0.6rem",color:"#475569",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"0.25rem"}}>Why</div><p style={{...S.serif,fontSize:"0.82rem",color:"#94a3b8",margin:0,lineHeight:1.6}}>{flag.reason}</p></div>
            <div style={{background:"#0d2d1a",border:"1px solid #166534",borderRadius:"3px",padding:"0.65rem"}}>
              <div style={{...S.mono,fontSize:"0.6rem",color:"#4ade80",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"0.3rem"}}>✦ Rewrite</div>
              <p style={{...S.display,fontSize:"0.85rem",color:"#86efac",margin:0,lineHeight:1.6,fontStyle:"italic"}}>"{flag.suggestion}"</p>
            </div>
          </div>}
        </div>
      </div>
    </div>
  );
}

function AIismsTab({text,wordCount,result,setResult}) {
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);
  const [filter,setFilter]=useState("All");

  async function run() {
    setLoading(true); setError(null); setResult(null);
    try { setResult(await apiCall(AIISM_SYS,`Analyse:\n\n${text}`)); }
    catch(e){setError(e.message);}
    setLoading(false);
  }

  if (wordCount<50) return <Empty msg="Paste at least 50 words to run AI-ism analysis"/>;
  if (!result&&!loading) return <div><p style={{...S.mono,fontSize:"0.7rem",color:"#64748b",lineHeight:1.7,marginBottom:"1rem"}}>Deep editorial review of 12 AI-ism categories. Results saved for Word export.</p><RunButton onClick={run} label="◆ Run AI-ism Analysis"/>{error&&<p style={{...S.mono,fontSize:"0.7rem",color:"#ef4444",marginTop:"0.5rem"}}>{error}</p>}</div>;
  if (loading) return <div style={{textAlign:"center",padding:"2rem 0"}}><div style={{...S.display,fontSize:"1.1rem",color:"#ef4444",fontStyle:"italic"}}>Reading your manuscript...</div></div>;

  const types=["All",...new Set(result.flags.map(f=>f.type))];
  const visible=result.flags.filter(f=>filter==="All"||f.type===filter);
  const sc=result.score, scColor=sc>=8?"#4ade80":sc>=6?"#a3e635":sc>=4?"#facc15":sc>=2?"#fb923c":"#ef4444";

  return (
    <div>
      <div style={{...S.card,marginBottom:"1rem"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:"0.4rem"}}>
          <span style={S.label}>Humanity Score</span>
          <span style={{...S.display,fontSize:"1.4rem",color:scColor,fontWeight:700}}>{sc}/10</span>
        </div>
        <div style={{height:"4px",background:"#1e293b",borderRadius:"2px",overflow:"hidden",marginBottom:"1rem"}}>
          <div style={{height:"100%",width:`${sc*10}%`,background:scColor,boxShadow:`0 0 8px ${scColor}88`}}/>
        </div>
        <p style={{...S.serif,fontSize:"0.85rem",color:"#94a3b8",margin:0,lineHeight:1.7,fontStyle:"italic"}}>{result.summary}</p>
      </div>
      {types.length>1&&<div style={{display:"flex",gap:"0.35rem",flexWrap:"wrap",marginBottom:"0.85rem"}}>
        {types.map(t=>{const c=t==="All"?"#94a3b8":typeColor(t),a=filter===t;return <button key={t} onClick={()=>setFilter(t)} style={{background:a?c+"22":"transparent",border:`1px solid ${a?c:"#1e293b"}`,borderRadius:"3px",padding:"0.2rem 0.55rem",cursor:"pointer",...S.mono,fontSize:"0.6rem",color:a?c:"#475569",letterSpacing:"0.08em"}}>{t}</button>;})}
      </div>}
      {visible.map((f,i)=><FlagCard key={f.id} flag={f} index={i}/>)}
      <RerunButton onClick={()=>{setResult(null);setFilter("All");}}/>
    </div>
  );
}

// ─── TAB 2: PACING ────────────────────────────────────────────────────────────

function PacingTab({wordCount,pacing}) {
  if (!pacing) return <Empty msg="Paste at least 50 words to see pacing analysis"/>;
  const rl=pacing.burstiness<0.35?"Monotonous":pacing.burstiness<0.55?"Steady":pacing.burstiness<0.85?"Varied":"Highly Varied";
  const rc=pacing.burstiness<0.35?"#ef4444":pacing.burstiness<0.55?"#facc15":"#4ade80";
  const flagged=new Set(pacing.runs.flat());
  const maxH=80;
  const {starters}=pacing;

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"0.5rem",marginBottom:"1rem"}}>
        {[["Avg Length",pacing.avg.toFixed(1)+" words",""],["Rhythm",pacing.burstiness.toFixed(2),rl,rc],["Sentences",pacing.total,`${pacing.min}–${pacing.max} word range`]].map(([l,v,u,c])=>(
          <div key={l} style={{...S.card,padding:"0.75rem",textAlign:"center"}}>
            <div style={{...S.display,fontSize:"1.3rem",color:c||"#f1f5f9",fontWeight:700}}>{v}</div>
            <div style={{...S.mono,fontSize:"0.55rem",color:"#475569",textTransform:"uppercase",letterSpacing:"0.08em",marginTop:"0.2rem"}}>{l}</div>
            {u&&<div style={{...S.mono,fontSize:"0.55rem",color:c||"#64748b",marginTop:"0.1rem"}}>{u}</div>}
          </div>
        ))}
      </div>

      {/* Rhythm chart */}
      <div style={{...S.card,marginBottom:"1rem"}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:"0.75rem"}}>
          <span style={S.label}>Sentence Rhythm</span>
          <span style={{...S.mono,fontSize:"0.6rem",color:"#475569"}}>← start · end →</span>
        </div>
        <div style={{display:"flex",alignItems:"flex-end",gap:"1px",height:maxH+20,borderBottom:"1px solid #1e293b",overflow:"hidden"}}>
          {pacing.lens.map((l,i)=>{const h=(l/pacing.max)*maxH,f=flagged.has(i);return <div key={i} title={`Sentence ${i+1}: ${l} words`} style={{flex:"1 0 3px",minWidth:"2px",height:`${h}px`,background:f?"#ef4444":l>pacing.avg*1.5?"#3b82f6":l<pacing.avg*0.5?"#a3e635":"#64748b",borderRadius:"1px 1px 0 0"}}/>;} )}
        </div>
        <div style={{display:"flex",gap:"0.6rem",marginTop:"0.5rem",flexWrap:"wrap"}}>
          {[["#a3e635","Short"],["#64748b","Mid"],["#3b82f6","Long"],["#ef4444","Monotony run"]].map(([c,l])=>(
            <div key={l} style={{display:"flex",alignItems:"center",gap:"0.3rem"}}><div style={{width:8,height:8,background:c,borderRadius:1}}/><span style={{...S.mono,fontSize:"0.55rem",color:"#64748b"}}>{l}</span></div>
          ))}
        </div>
      </div>

      {/* Pacing notes */}
      <div style={{...S.card,marginBottom:"1rem"}}>
        <div style={{...S.label,marginBottom:"0.75rem"}}>Pacing Notes</div>
        <ul style={{margin:0,paddingLeft:"1rem",...S.serif,fontSize:"0.82rem",color:"#94a3b8",lineHeight:1.7}}>
          {pacing.burstiness<0.35&&<li>Sentence lengths are too uniform — a primary AI-detection signal. Alternate short punchy lines with longer constructions.</li>}
          {pacing.burstiness>=0.35&&pacing.burstiness<0.55&&<li>Rhythm is steady but could use more dramatic variation at emotional peaks.</li>}
          {pacing.burstiness>=0.55&&<li>Good sentence-length variation — reads with natural human rhythm.</li>}
          {pacing.runs.length>0&&<li>Found <span style={{color:"#ef4444"}}>{pacing.runs.length}</span> run{pacing.runs.length>1?"s":""} of 4+ similar-length sentences (red bars). Break these up.</li>}
          {pacing.avg>25&&<li>Average sentence length is high ({pacing.avg.toFixed(1)} words). Consider trimming for clarity.</li>}
          {pacing.avg<10&&<li>Average sentence length is short ({pacing.avg.toFixed(1)} words). Combine related thoughts occasionally.</li>}
          {pacing.max>60&&<li>Longest sentence is {pacing.max} words — read it aloud to check flow.</li>}
        </ul>
      </div>

      {/* Sentence starters */}
      <div style={S.card}>
        <div style={{...S.label,marginBottom:"0.75rem"}}>Sentence Starter Analysis</div>
        {starters.overused.length===0&&starters.consecRuns.length===0
          ? <p style={{...S.mono,fontSize:"0.7rem",color:"#4ade80",margin:0}}>✓ No significant sentence-starter repetition detected.</p>
          : <div style={{display:"flex",flexDirection:"column",gap:"0.75rem"}}>
              {starters.overused.length>0&&(
                <div>
                  <div style={{...S.mono,fontSize:"0.62rem",color:"#f59e0b",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"0.5rem"}}>Overused Openers</div>
                  <div style={{display:"flex",flexDirection:"column",gap:"0.4rem"}}>
                    {starters.overused.map(s=>(
                      <div key={s.word} style={{background:"#0f172a",borderLeft:"3px solid #f59e0b",borderRadius:"3px",padding:"0.55rem 0.75rem",display:"flex",alignItems:"center",gap:"0.6rem"}}>
                        <span style={{...S.display,fontSize:"1rem",color:"#fbbf24",fontWeight:600,minWidth:"60px"}}>{s.word}</span>
                        <div style={{flex:1,height:"4px",background:"#1e293b",borderRadius:"2px"}}><div style={{height:"100%",width:`${Math.min(s.pct*2,100)}%`,background:"#f59e0b",borderRadius:"2px"}}/></div>
                        <span style={{...S.mono,fontSize:"0.62rem",color:"#64748b",whiteSpace:"nowrap"}}>×{s.count} · {s.pct}%</span>
                      </div>
                    ))}
                  </div>
                  <p style={{...S.mono,fontSize:"0.62rem",color:"#64748b",margin:"0.5rem 0 0 0",lineHeight:1.5}}>Vary your sentence structures — open with action, setting, dialogue, or subordinate clauses instead.</p>
                </div>
              )}
              {starters.consecRuns.length>0&&(
                <div>
                  <div style={{...S.mono,fontSize:"0.62rem",color:"#ef4444",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"0.5rem"}}>Consecutive Same-Opener Runs</div>
                  {starters.consecRuns.map((run,i)=>(
                    <div key={i} style={{background:"#0f172a",borderLeft:"3px solid #ef4444",borderRadius:"3px",padding:"0.55rem 0.75rem",marginBottom:"0.4rem"}}>
                      <span style={{...S.mono,fontSize:"0.65rem",color:"#ef4444"}}>{run.length} sentences in a row starting with </span>
                      <span style={{...S.display,fontStyle:"italic",color:"#fca5a5"}}>"{run[0].word}"</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
        }
        {starters.topStarters.length>0&&(
          <div style={{marginTop:"1rem"}}>
            <div style={{...S.mono,fontSize:"0.6rem",color:"#475569",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"0.5rem"}}>All Sentence Openers</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:"0.35rem"}}>
              {starters.topStarters.map(s=>{
                const hot=starters.overused.some(o=>o.word===s.word);
                return <div key={s.word} style={{background:hot?"rgba(245,158,11,0.1)":"#0f172a",border:`1px solid ${hot?"#f59e0b44":"#1e293b"}`,borderRadius:"3px",padding:"0.2rem 0.5rem",display:"flex",gap:"0.35rem",alignItems:"center"}}>
                  <span style={{...S.display,fontSize:"0.82rem",color:hot?"#fbbf24":"#94a3b8"}}>{s.word}</span>
                  <span style={{...S.mono,fontSize:"0.58rem",color:"#475569"}}>×{s.count}</span>
                </div>;
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TAB 3: REPEATS ───────────────────────────────────────────────────────────

function RepeatsTab({wordCount,repeats}) {
  if (!repeats) return <Empty msg="Paste at least 50 words to see word usage analysis"/>;
  return (
    <div>
      <div style={{...S.card,marginBottom:"1rem"}}>
        <div style={{...S.label,marginBottom:"0.75rem"}}>Crutch Words ({repeats.crutchHits.length} flagged)</div>
        {!repeats.crutchHits.length?<p style={{...S.mono,fontSize:"0.7rem",color:"#4ade80",margin:0}}>✓ No overused crutch words.</p>
          :repeats.crutchHits.map(h=>(
            <div key={h.word} style={{background:"#0f172a",border:"1px solid #1e293b",borderLeft:"3px solid #f97316",borderRadius:"3px",padding:"0.6rem 0.75rem",marginBottom:"0.5rem"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:"0.2rem"}}>
                <span style={{...S.display,fontSize:"0.95rem",color:"#fbbf24",fontWeight:600}}>{h.word}</span>
                <span style={{...S.mono,fontSize:"0.65rem",color:"#64748b"}}>×{h.count} · {h.per1000}/1k</span>
              </div>
              <p style={{...S.mono,fontSize:"0.65rem",color:"#94a3b8",margin:0,lineHeight:1.5}}>{h.reason}</p>
            </div>
          ))}
      </div>
      <div style={{...S.card,marginBottom:"1rem"}}>
        <div style={{...S.label,marginBottom:"0.75rem"}}>Echoes ({repeats.echoes.length} found · same word within 30 words)</div>
        {!repeats.echoes.length?<p style={{...S.mono,fontSize:"0.7rem",color:"#4ade80",margin:0}}>✓ No close-proximity repetitions.</p>
          :<div style={{display:"flex",flexWrap:"wrap",gap:"0.4rem"}}>
            {repeats.echoes.map((e,i)=>(
              <div key={i} style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:"3px",padding:"0.3rem 0.6rem",display:"flex",gap:"0.4rem",alignItems:"center"}}>
                <span style={{...S.display,fontSize:"0.85rem",color:"#06b6d4",fontStyle:"italic"}}>{e.word}</span>
                <span style={{...S.mono,fontSize:"0.6rem",color:"#475569"}}>{e.distance}w apart</span>
              </div>
            ))}
          </div>}
      </div>
      {repeats.repeated.length>0&&(
        <div style={S.card}>
          <div style={{...S.label,marginBottom:"0.75rem"}}>Most Repeated Content Words</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:"0.35rem"}}>
            {repeats.repeated.map(([w,c])=>{const int=Math.min(c/8,1);return <div key={w} style={{background:`rgba(168,85,247,${0.1+int*0.3})`,border:`1px solid rgba(168,85,247,${0.3+int*0.4})`,borderRadius:"3px",padding:"0.25rem 0.55rem",display:"flex",gap:"0.4rem",alignItems:"center"}}><span style={{...S.display,fontSize:"0.85rem",color:"#e9d5ff"}}>{w}</span><span style={{...S.mono,fontSize:"0.6rem",color:"#c4b5fd"}}>×{c}</span></div>;})}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TAB 3b: PATTERNS ────────────────────────────────────────────────────────

function PatternRow({ label, count, color, children, defaultOpen=false }) {
  const [open, setOpen] = useState(defaultOpen);
  const ok = count === 0;
  return (
    <div style={{ marginBottom:"0.6rem" }}>
      <div onClick={()=>setOpen(!open)} style={{ display:"flex", alignItems:"center", gap:"0.75rem", padding:"0.65rem 0.85rem", background:"#0f172a", border:`1px solid ${ok?"#166534":open?color+"55":"#1e293b"}`, borderLeft:`3px solid ${ok?"#166534":color}`, borderRadius:"4px", cursor:"pointer" }}>
        <span style={{ ...S.mono, fontSize:"0.62rem", color:ok?"#4ade80":color, minWidth:"1.2rem", fontWeight:700 }}>{ok?"✓":count}</span>
        <span style={{ ...S.mono, fontSize:"0.68rem", color:ok?"#4ade80":"#cbd5e1", flex:1 }}>{label}</span>
        {!ok && <span style={{ ...S.mono, fontSize:"0.58rem", color:"#475569" }}>{open?"▲":"▼"}</span>}
      </div>
      {open && !ok && <div style={{ background:"#080f1f", border:"1px solid #1e293b", borderTop:"none", borderRadius:"0 0 4px 4px", padding:"0.75rem 0.85rem" }}>{children}</div>}
    </div>
  );
}

function PatternPill({ text, color }) {
  return <span style={{ display:"inline-block", background:color+"18", border:`1px solid ${color}44`, borderRadius:"3px", padding:"0.15rem 0.5rem", ...S.mono, fontSize:"0.65rem", color:color, margin:"0.2rem 0.2rem 0.2rem 0" }}>{text}</span>;
}

function PatternsTab({ wordCount, patterns }) {
  if (!patterns) return <Empty msg="Paste at least 50 words to see pattern analysis"/>;

  const tricolorThresh = Math.floor(patterns.totalWords / 300);
  const triOverused = patterns.tricolons.length > Math.max(tricolorThresh, 2);
  const hasListStack = patterns.stackedParas.length > 0 || patterns.doubleStacks.length > 0;
  const hasFigStack = patterns.figStacks.length > 0;
  const hasContrastStack = patterns.contrastStacks.length > 0;
  const hasPivots = patterns.pivots.length > 0;
  const hasShorthandStack = patterns.shorthandStacks.length > 0;

  const issueCount = [triOverused, hasListStack, hasFigStack, hasContrastStack, hasPivots, hasShorthandStack].filter(Boolean).length;

  return (
    <div>
      {/* Summary bar */}
      <div style={{ ...S.card, marginBottom:"1rem" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:"0.5rem" }}>
          <span style={S.label}>Pattern Analysis</span>
          <span style={{ ...S.mono, fontSize:"0.72rem", color:issueCount===0?"#4ade80":issueCount<=2?"#facc15":"#ef4444" }}>
            {issueCount === 0 ? "✓ No issues" : `${issueCount} pattern${issueCount>1?"s":""} flagged`}
          </span>
        </div>
        <div style={{ display:"flex", gap:"0.4rem", flexWrap:"wrap" }}>
          {[
            [`${patterns.tricolons.length} tricolon${patterns.tricolons.length!==1?"s":""}`, triOverused?"#f59e0b":"#4ade80"],
            [`${patterns.contrasts.length} contrast${patterns.contrasts.length!==1?"s":""}`, hasContrastStack?"#f97316":"#4ade80"],
            [`${patterns.allFigurative.length} figurative`, hasFigStack?"#a855f7":"#4ade80"],
            [`${patterns.listySentences.length} list sent.`, hasListStack?"#ef4444":"#4ade80"],
            [`${patterns.pivots.length} pivot${patterns.pivots.length!==1?"s":""}`, hasPivots?"#06b6d4":"#4ade80"],
            [`${patterns.allShorthand.length} emo. shorthand`, hasShorthandStack?"#ec4899":"#4ade80"],
          ].map(([l,c])=><PatternPill key={l} text={l} color={c}/>)}
        </div>
      </div>

      {/* 1. Rule of Three */}
      <PatternRow label={`Rule of Three  ·  ${patterns.tricolons.length} detected${triOverused?" — may be overused":""}`} count={triOverused?patterns.tricolons.length:0} color="#f59e0b" defaultOpen={triOverused}>
        <p style={{ ...S.mono, fontSize:"0.65rem", color:"#94a3b8", marginBottom:"0.75rem", lineHeight:1.6 }}>
          Tricolons are powerful when used sparingly. More than {Math.max(tricolorThresh,2)} in a chapter can feel formulaic — especially if items don't escalate. Each should earn its structure.
        </p>
        {patterns.tricolons.slice(0,8).map((t,i)=>(
          <div key={i} style={{ marginBottom:"0.5rem", paddingBottom:"0.5rem", borderBottom:i<Math.min(patterns.tricolons.length,8)-1?"1px solid #1e293b":"none" }}>
            <blockquote style={{ ...S.display, fontSize:"0.83rem", color:"#fbbf24", fontStyle:"italic", margin:"0 0 0.3rem 0", lineHeight:1.5 }}>"{t.text}"</blockquote>
            <div style={{ display:"flex", gap:"0.4rem", flexWrap:"wrap" }}>
              {t.items.map((item,j)=><span key={j} style={{ ...S.mono, fontSize:"0.6rem", color:"#64748b" }}>[{j+1}] {item.trim()}</span>)}
            </div>
          </div>
        ))}
        {patterns.tricolons.length > 8 && <p style={{ ...S.mono, fontSize:"0.62rem", color:"#475569", marginTop:"0.5rem" }}>…and {patterns.tricolons.length-8} more</p>}
      </PatternRow>

      {/* 2. List rhythm stacking */}
      <PatternRow label={`List Rhythm Stacking  ·  ${patterns.listySentences.length} comma-heavy sentences${hasListStack?" — stacking detected":""}`} count={hasListStack?(patterns.stackedParas.length+patterns.doubleStacks.length):0} color="#ef4444">
        <p style={{ ...S.mono, fontSize:"0.65rem", color:"#94a3b8", marginBottom:"0.75rem", lineHeight:1.6 }}>
          Multiple list-structured sentences in the same paragraph create a breathless, AI-typical rhythm. Break them up with simple declarative sentences.
        </p>
        {patterns.doubleStacks.length > 0 && (
          <div style={{ marginBottom:"0.75rem" }}>
            <div style={{ ...S.mono, fontSize:"0.62rem", color:"#ef4444", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.4rem" }}>Double-stacked sentences</div>
            {patterns.doubleStacks.slice(0,4).map((s,i)=>(
              <blockquote key={i} style={{ ...S.display, fontSize:"0.83rem", color:"#fca5a5", fontStyle:"italic", margin:"0 0 0.4rem 0", lineHeight:1.5 }}>"{s.slice(0,120)}{s.length>120?"...":""}"</blockquote>
            ))}
          </div>
        )}
        {patterns.stackedParas.length > 0 && (
          <div>
            <div style={{ ...S.mono, fontSize:"0.62rem", color:"#f97316", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.4rem" }}>{patterns.stackedParas.length} paragraph{patterns.stackedParas.length>1?"s":""} with stacked list sentences</div>
            <p style={{ ...S.mono, fontSize:"0.62rem", color:"#64748b", margin:0 }}>Vary sentence structure within these paragraphs — mix lists with simple action beats.</p>
          </div>
        )}
      </PatternRow>

      {/* 3. Metaphor / personification stacking */}
      <PatternRow label={`Figurative Language  ·  ${patterns.allFigurative.length} detected${hasFigStack?" — stacking found":""}`} count={hasFigStack?patterns.figStacks.length:0} color="#a855f7">
        <p style={{ ...S.mono, fontSize:"0.65rem", color:"#94a3b8", marginBottom:"0.75rem", lineHeight:1.6 }}>
          Two or more metaphors, similes, or personifications in quick succession dilute each other. Let one land before reaching for the next.
        </p>
        {patterns.figStacks.slice(0,5).map((stack,i)=>(
          <div key={i} style={{ background:"#0f172a", border:"1px solid #7c3aed44", borderLeft:"3px solid #a855f7", borderRadius:"3px", padding:"0.65rem 0.75rem", marginBottom:"0.5rem" }}>
            <blockquote style={{ ...S.display, fontSize:"0.83rem", color:"#d8b4fe", fontStyle:"italic", margin:"0 0 0.35rem 0", lineHeight:1.5 }}>"{stack.context.slice(0,140)}{stack.context.length>140?"...":""}"</blockquote>
            <div style={{ display:"flex", gap:"0.5rem", flexWrap:"wrap" }}>
              <PatternPill text={stack.a.type} color="#a855f7"/>
              <PatternPill text={stack.b.type} color="#a855f7"/>
            </div>
          </div>
        ))}
        {patterns.allFigurative.length > 0 && patterns.figStacks.length === 0 && (
          <p style={{ ...S.mono, fontSize:"0.65rem", color:"#4ade80", margin:0 }}>✓ Figurative language is well-spaced — no stacking detected.</p>
        )}
      </PatternRow>

      {/* 4. Contrast structures */}
      <PatternRow label={`Contrast Structures  ·  ${patterns.contrasts.length} detected${hasContrastStack?" — stacking found":""}`} count={hasContrastStack?patterns.contrastStacks.length:0} color="#f97316">
        <p style={{ ...S.mono, fontSize:"0.65rem", color:"#94a3b8", marginBottom:"0.75rem", lineHeight:1.6 }}>
          "Not X, but Y" and "rather than X" constructions are rhetorical tools — effective once, flat when repeated. Multiple contrast structures in quick succession read as a stylistic tic.
        </p>
        {patterns.contrasts.length > 0 && (
          <div style={{ marginBottom:"0.75rem" }}>
            <div style={{ ...S.mono, fontSize:"0.62rem", color:"#f97316", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.4rem" }}>All contrast patterns found</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:"0.3rem" }}>
              {patterns.contrasts.slice(0,12).map((c,i)=>(
                <span key={i} style={{ ...S.mono, fontSize:"0.62rem", color:"#fed7aa", background:"rgba(249,115,22,0.1)", border:"1px solid rgba(249,115,22,0.25)", borderRadius:"3px", padding:"0.15rem 0.5rem" }}>{c.text.slice(0,50)}{c.text.length>50?"...":""}</span>
              ))}
            </div>
          </div>
        )}
        {hasContrastStack && (
          <div>
            <div style={{ ...S.mono, fontSize:"0.62rem", color:"#ef4444", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.4rem" }}>Stacked contrasts (within 300 chars of each other)</div>
            {patterns.contrastStacks.slice(0,3).map((pair,i)=>(
              <div key={i} style={{ marginBottom:"0.5rem" }}>
                <blockquote style={{ ...S.display, fontSize:"0.83rem", color:"#fdba74", fontStyle:"italic", margin:"0 0 0.2rem 0" }}>"{pair[0].text}"</blockquote>
                <blockquote style={{ ...S.display, fontSize:"0.83rem", color:"#fdba74", fontStyle:"italic", margin:0 }}>"{pair[1].text}"</blockquote>
              </div>
            ))}
          </div>
        )}
        {!hasContrastStack && patterns.contrasts.length > 0 && (
          <p style={{ ...S.mono, fontSize:"0.65rem", color:"#4ade80", margin:0, marginTop:"0.5rem" }}>✓ Contrast structures are well-distributed — no stacking detected.</p>
        )}
      </PatternRow>

      {/* 5. Clean pivot sentences */}
      <PatternRow label={`Clean Pivot Sentences  ·  ${patterns.pivots.length} detected`} count={patterns.pivots.length} color="#06b6d4">
        <p style={{ ...S.mono, fontSize:"0.65rem", color:"#94a3b8", marginBottom:"0.75rem", lineHeight:1.6 }}>
          Formulaic wrap-up lines — "With that,", "That changed everything.", "There was no going back." — are a hallmark of AI prose. They close scenes too neatly, robbing the reader of ambiguity and weight. Replace with a specific, concrete beat.
        </p>
        {patterns.pivots.slice(0,10).map((p,i)=>(
          <div key={i} style={{ background:"#0f172a", border:"1px solid #0e7490", borderLeft:"3px solid #06b6d4", borderRadius:"3px", padding:"0.6rem 0.75rem", marginBottom:"0.4rem" }}>
            <div style={{ ...S.mono, fontSize:"0.65rem", color:"#22d3ee", marginBottom:"0.25rem" }}>"{p.text}"</div>
            <p style={{ ...S.serif, fontSize:"0.78rem", color:"#64748b", margin:0, fontStyle:"italic", lineHeight:1.5 }}>{p.sentence.slice(0,110)}{p.sentence.length>110?"...":""}</p>
          </div>
        ))}
        {patterns.pivots.length > 10 && <p style={{ ...S.mono, fontSize:"0.62rem", color:"#475569", marginTop:"0.5rem" }}>…and {patterns.pivots.length-10} more</p>}
      </PatternRow>

      {/* 6. Emotional shorthand stacking */}
      <PatternRow label={`Emotional Shorthand  ·  ${patterns.allShorthand.length} detected${hasShorthandStack?" — stacking found":""}`} count={hasShorthandStack?patterns.shorthandStacks.length:0} color="#ec4899">
        <p style={{ ...S.mono, fontSize:"0.65rem", color:"#94a3b8", marginBottom:"0.75rem", lineHeight:1.6 }}>
          Pre-packaged physical emotion signals — "heart sank", "breath caught", "stomach dropped" — are useful shorthand but become AI-typical when stacked. Two or more in close proximity flattens the emotional impact of both. Space them out or replace with specific physical behaviour.
        </p>
        {patterns.shorthandStacks.length > 0 && (
          <div style={{ marginBottom:"0.75rem" }}>
            <div style={{ ...S.mono, fontSize:"0.62rem", color:"#ec4899", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.5rem" }}>Stacked instances</div>
            {patterns.shorthandStacks.slice(0,5).map((stack,i)=>(
              <div key={i} style={{ background:"#0f172a", border:"1px solid #be185d44", borderLeft:"3px solid #ec4899", borderRadius:"3px", padding:"0.6rem 0.75rem", marginBottom:"0.5rem" }}>
                <blockquote style={{ ...S.display, fontSize:"0.83rem", color:"#f9a8d4", fontStyle:"italic", margin:"0 0 0.4rem 0", lineHeight:1.5 }}>"{stack.context.slice(0,150)}{stack.context.length>150?"...":""}"</blockquote>
                <div style={{ display:"flex", gap:"0.4rem", flexWrap:"wrap" }}>
                  <PatternPill text={stack.a.label} color="#ec4899"/>
                  <PatternPill text={stack.b.label} color="#ec4899"/>
                </div>
              </div>
            ))}
          </div>
        )}
        {patterns.allShorthand.length > 0 && (
          <div>
            <div style={{ ...S.mono, fontSize:"0.62rem", color:"#475569", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.4rem" }}>All shorthand detected</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:"0.3rem" }}>
              {patterns.allShorthand.slice(0,16).map((s,i)=>(
                <span key={i} style={{ ...S.mono, fontSize:"0.6rem", color:"#f9a8d4", background:"rgba(236,72,153,0.1)", border:"1px solid rgba(236,72,153,0.25)", borderRadius:"3px", padding:"0.15rem 0.45rem" }}>{s.text.slice(0,40)}</span>
              ))}
              {patterns.allShorthand.length > 16 && <span style={{ ...S.mono, fontSize:"0.6rem", color:"#475569" }}>+{patterns.allShorthand.length-16} more</span>}
            </div>
          </div>
        )}
        {patterns.allShorthand.length === 0 && (
          <p style={{ ...S.mono, fontSize:"0.65rem", color:"#4ade80", margin:0 }}>✓ No emotional shorthand detected.</p>
        )}
      </PatternRow>
    </div>
  );
}

// ─── TAB 4: SHOW vs TELL ─────────────────────────────────────────────────────

const ST_SYS=`Analyse fiction for show-vs-tell balance. TELLING=naming emotions/states, info-dumping, declaring traits. SHOWING=sensory detail, physical action, dialogue revealing character. Return ONLY valid JSON, no fences: {"showCount":<int>,"tellCount":<int>,"ratio":<0-100 % showing>,"summary":"2-3 sentence assessment","tellingExamples":[{"text":"<exact>","issue":"<what>","rewrite":"<show it>"}],"showingExamples":[{"text":"<exact>","strength":"<what works>"}]}. Max 6 telling, 3 showing. Only flag weak telling that should be shown.`;

function ShowTellTab({text,wordCount,result,setResult}) {
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);

  async function run() {
    setLoading(true); setError(null); setResult(null);
    try{setResult(await apiCall(ST_SYS,`Analyse:\n\n${text}`,3000));}
    catch(e){setError(e.message);}
    setLoading(false);
  }

  if (wordCount<50) return <Empty msg="Paste at least 50 words to run Show vs Tell analysis"/>;
  if (!result&&!loading) return <div><p style={{...S.mono,fontSize:"0.7rem",color:"#64748b",lineHeight:1.7,marginBottom:"1rem"}}>Analyses balance of showing vs telling. Results saved for Word export.</p><RunButton onClick={run} label="◆ Run Show vs Tell Analysis"/>{error&&<p style={{...S.mono,fontSize:"0.7rem",color:"#ef4444",marginTop:"0.5rem"}}>{error}</p>}</div>;
  if (loading) return <div style={{textAlign:"center",padding:"2rem 0"}}><div style={{...S.display,fontSize:"1.1rem",color:"#ef4444",fontStyle:"italic"}}>Weighing show against tell...</div></div>;

  const rc=result.ratio>=70?"#4ade80":result.ratio>=50?"#facc15":"#ef4444";
  const rl=result.ratio>=75?"Strongly Shown":result.ratio>=60?"Mostly Shown":result.ratio>=45?"Balanced":result.ratio>=30?"Too Much Telling":"Heavily Told";

  return (
    <div>
      <div style={{...S.card,marginBottom:"1rem"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:"0.4rem"}}>
          <span style={S.label}>Show / Tell Ratio</span>
          <span style={{...S.display,fontSize:"1.3rem",color:rc,fontWeight:700}}>{result.ratio}% shown</span>
        </div>
        <div style={{display:"flex",height:8,borderRadius:2,overflow:"hidden",background:"#1e293b",marginBottom:"0.5rem"}}>
          <div style={{width:`${result.ratio}%`,background:"#4ade80"}}/><div style={{width:`${100-result.ratio}%`,background:"#ef4444"}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",...S.mono,fontSize:"0.6rem",color:"#475569",marginBottom:"1rem"}}>
          <span>SHOW · {result.showCount}</span><span style={{color:rc}}>{rl}</span><span>TELL · {result.tellCount}</span>
        </div>
        <p style={{...S.serif,fontSize:"0.85rem",color:"#94a3b8",margin:0,lineHeight:1.7,fontStyle:"italic"}}>{result.summary}</p>
      </div>
      {result.tellingExamples?.length>0&&(
        <div style={{marginBottom:"1rem"}}>
          <div style={{...S.label,marginBottom:"0.6rem"}}>Weak Telling — Convert to Showing</div>
          {result.tellingExamples.map((e,i)=>(
            <div key={i} style={{background:"#0f172a",border:"1px solid #1e293b",borderLeft:"3px solid #ef4444",borderRadius:"4px",padding:"0.85rem 1rem",marginBottom:"0.5rem"}}>
              <blockquote style={{...S.display,fontSize:"0.85rem",color:"#fca5a5",margin:"0 0 0.4rem",fontStyle:"italic",lineHeight:1.5}}>"{e.text}"</blockquote>
              <p style={{...S.mono,fontSize:"0.65rem",color:"#94a3b8",margin:"0 0 0.6rem"}}>{e.issue}</p>
              <div style={{background:"#0d2d1a",border:"1px solid #166534",borderRadius:"3px",padding:"0.6rem"}}>
                <div style={{...S.mono,fontSize:"0.55rem",color:"#4ade80",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"0.3rem"}}>✦ Show it</div>
                <p style={{...S.display,fontSize:"0.82rem",color:"#86efac",margin:0,fontStyle:"italic",lineHeight:1.6}}>"{e.rewrite}"</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {result.showingExamples?.length>0&&(
        <div style={{marginBottom:"1rem"}}>
          <div style={{...S.label,marginBottom:"0.6rem"}}>Strong Showing — What's Working</div>
          {result.showingExamples.map((e,i)=>(
            <div key={i} style={{background:"#0d2d1a",border:"1px solid #166534",borderLeft:"3px solid #4ade80",borderRadius:"4px",padding:"0.75rem 1rem",marginBottom:"0.5rem"}}>
              <blockquote style={{...S.display,fontSize:"0.85rem",color:"#86efac",margin:"0 0 0.4rem",fontStyle:"italic",lineHeight:1.5}}>"{e.text}"</blockquote>
              <p style={{...S.mono,fontSize:"0.6rem",color:"#4ade80",margin:0}}>{e.strength}</p>
            </div>
          ))}
        </div>
      )}
      <RerunButton onClick={()=>setResult(null)}/>
    </div>
  );
}

// ─── TAB 5: DIALOGUE ─────────────────────────────────────────────────────────

const DIALOGUE_SYS=`You are an expert fiction editor analysing dialogue craft. Evaluate the dialogue in the provided excerpt for:
- Said-bookisms: verbs other than "said/asked" used as dialogue tags when they don't work (exclaimed, retorted, breathed, smiled, laughed as tags, etc.)
- On-the-nose dialogue: characters explicitly stating emotions, motivations, or information they wouldn't naturally say aloud
- Monologue risk: any single character speaking for too long without beats, reaction, or interruption
- Dialogue beats vs tags: overuse of action beats as filler, or underuse of beats leaving talking heads
- Subtext absence: dialogue that says exactly what's meant with no subtext or tension underneath
- Dialect/voice consistency: characters who sound identical or inconsistent

Also identify what's working well in the dialogue.

Return ONLY valid JSON, no fences:
{
  "dialogueRatio": <int 0-100, estimated % of text that is dialogue>,
  "lineCount": <int, approximate number of dialogue exchanges>,
  "proseDialogueBalance": "<brief label e.g. 'dialogue-heavy' / 'balanced' / 'prose-heavy'>",
  "summary": "2-3 sentence overall assessment of dialogue quality",
  "flags": [{"id":<int>,"type":"<category>","original":"<exact quoted passage>","reason":"<why it's a problem>","suggestion":"<rewrite>"}],
  "strengths": ["<what works well>"]
}
Max 8 flags, max 4 strengths. Only flag genuine problems.`;

function DialogueTab({text,wordCount,result,setResult,dialogueMeta}) {
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);

  async function run() {
    setLoading(true); setError(null); setResult(null);
    try{setResult(await apiCall(DIALOGUE_SYS,`Analyse dialogue in this excerpt:\n\n${text}`,3500));}
    catch(e){setError(e.message);}
    setLoading(false);
  }

  if (wordCount<50) return <Empty msg="Paste at least 50 words to run dialogue analysis"/>;

  const diagColor="#3b82f6";

  if (!result&&!loading) return (
    <div>
      {dialogueMeta&&(
        <div style={{...S.card,marginBottom:"1rem"}}>
          <div style={{...S.label,marginBottom:"0.5rem"}}>Quick Dialogue Scan</div>
          <div style={{display:"flex",gap:"1rem",flexWrap:"wrap"}}>
            {[["Dialogue",`~${dialogueMeta.ratio}%`,diagColor],["Prose",`~${100-dialogueMeta.ratio}%`,"#64748b"],["Exchanges",`~${dialogueMeta.lineCount}`,"#94a3b8"]].map(([l,v,c])=>(
              <div key={l} style={{textAlign:"center",flex:1}}>
                <div style={{...S.display,fontSize:"1.2rem",color:c,fontWeight:700}}>{v}</div>
                <div style={{...S.mono,fontSize:"0.58rem",color:"#475569",textTransform:"uppercase",marginTop:"0.2rem"}}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <p style={{...S.mono,fontSize:"0.7rem",color:"#64748b",lineHeight:1.7,marginBottom:"1rem"}}>Deep dialogue analysis: said-bookisms, on-the-nose writing, subtext, voice consistency, and more.</p>
      <RunButton onClick={run} label="◆ Run Dialogue Analysis" loading={loading} loadingLabel="◆ Reading dialogue..."/>
      {error&&<p style={{...S.mono,fontSize:"0.7rem",color:"#ef4444",marginTop:"0.5rem"}}>{error}</p>}
    </div>
  );

  if (loading) return <div style={{textAlign:"center",padding:"2rem 0"}}><div style={{...S.display,fontSize:"1.1rem",color:diagColor,fontStyle:"italic"}}>Listening to your characters...</div></div>;

  const balColor=result.dialogueRatio>=60?"#3b82f6":result.dialogueRatio>=30?"#4ade80":"#64748b";

  return (
    <div>
      <div style={{...S.card,marginBottom:"1rem"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:"0.6rem"}}>
          <span style={S.label}>Dialogue Balance</span>
          <span style={{...S.display,fontSize:"1.3rem",color:balColor,fontWeight:700}}>{result.dialogueRatio}% dialogue</span>
        </div>
        <div style={{display:"flex",height:8,borderRadius:2,overflow:"hidden",background:"#1e293b",marginBottom:"0.5rem"}}>
          <div style={{width:`${result.dialogueRatio}%`,background:diagColor}}/><div style={{width:`${100-result.dialogueRatio}%`,background:"#334155"}}/>
        </div>
        <div style={{...S.mono,fontSize:"0.6rem",color:"#475569",marginBottom:"1rem"}}>{result.lineCount} exchanges · {result.proseDialogueBalance}</div>
        <p style={{...S.serif,fontSize:"0.85rem",color:"#94a3b8",margin:0,lineHeight:1.7,fontStyle:"italic"}}>{result.summary}</p>
      </div>

      {result.flags?.length>0&&(
        <div style={{marginBottom:"1rem"}}>
          <div style={{...S.label,marginBottom:"0.6rem"}}>Dialogue Flags ({result.flags.length})</div>
          {result.flags.map((f,i)=><FlagCard key={f.id||i} flag={f} index={i} accentColor={diagColor}/>)}
        </div>
      )}

      {result.strengths?.length>0&&(
        <div style={{...S.card,marginBottom:"1rem"}}>
          <div style={{...S.label,marginBottom:"0.6rem"}}>What's Working</div>
          {result.strengths.map((s,i)=>(
            <div key={i} style={{display:"flex",gap:"0.6rem",marginBottom:"0.5rem",padding:"0.6rem 0.75rem",background:"#0d2d1a",border:"1px solid #166534",borderRadius:"4px"}}>
              <span style={{color:"#4ade80",fontSize:"0.85rem"}}>✓</span>
              <p style={{...S.serif,fontSize:"0.82rem",color:"#86efac",margin:0,lineHeight:1.6}}>{s}</p>
            </div>
          ))}
        </div>
      )}
      <RerunButton onClick={()=>setResult(null)}/>
    </div>
  );
}

// ─── TAB 6: TENSION & STAKES ─────────────────────────────────────────────────

const TENSION_SYS=`You are a structural fiction editor assessing tension, stakes, and narrative drive in a chapter or scene excerpt.

Evaluate:
- Overall tension score (1-10): how much does the reader feel compelled to keep reading?
- Scene/chapter arc: does tension build, plateau, sag, or resolve? Describe the shape.
- Hook: how effectively does the opening engage? Does it earn immediate attention?
- Sag points: where specifically does tension drop? What causes it?
- Stakes clarity: are the stakes (physical, emotional, social, narrative) clear and present?
- Chapter ending: does it compel turning the page? Hook, question, consequence, revelation?
- Pacing of tension: is tension sustained or does it arrive too late / leave too early?

Return ONLY valid JSON, no fences:
{
  "tensionScore": <1-10>,
  "arc": "<one of: Rising / Falling / Plateau / Peak-Valley / Flat / Strong Build>",
  "summary": "2-3 sentence structural assessment",
  "hook": "<assessment of the opening hook>",
  "hookStrength": <1-10>,
  "sagPoints": ["<specific passage or moment where tension drops, with reason>"],
  "stakesAssessment": "<are stakes clear, present, and felt?>",
  "ending": "<assessment of how the excerpt closes>",
  "endingStrength": <1-10>,
  "recommendations": ["<specific, actionable suggestion to raise tension>"]
}
Max 4 sag points, max 4 recommendations. Be specific — quote or reference actual moments from the text.`;

function TensionTab({text,wordCount,result,setResult}) {
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);

  async function run() {
    setLoading(true); setError(null); setResult(null);
    try{setResult(await apiCall(TENSION_SYS,`Assess tension and stakes in this excerpt:\n\n${text}`,3000));}
    catch(e){setError(e.message);}
    setLoading(false);
  }

  if (wordCount<100) return <Empty msg="Paste at least 100 words for a meaningful tension analysis"/>;
  if (!result&&!loading) return (
    <div>
      <p style={{...S.mono,fontSize:"0.7rem",color:"#64748b",lineHeight:1.7,marginBottom:"1rem"}}>Structural analysis of scene arc, hook strength, sag points, stakes clarity, and chapter ending. Best used on a complete scene or chapter.</p>
      <RunButton onClick={run} label="◆ Run Tension Analysis" loading={loading} loadingLabel="◆ Feeling the tension..."/>
      {error&&<p style={{...S.mono,fontSize:"0.7rem",color:"#ef4444",marginTop:"0.5rem"}}>{error}</p>}
    </div>
  );
  if (loading) return <div style={{textAlign:"center",padding:"2rem 0"}}><div style={{...S.display,fontSize:"1.1rem",color:"#8b5cf6",fontStyle:"italic"}}>Charting the scene arc...</div></div>;

  const tc=result.tensionScore>=7?"#4ade80":result.tensionScore>=5?"#facc15":result.tensionScore>=3?"#fb923c":"#ef4444";
  const ARC_SHAPES={"Rising":"↗","Falling":"↘","Plateau":"→","Peak-Valley":"∿","Flat":"—","Strong Build":"↑"};
  const arcSymbol=ARC_SHAPES[result.arc]||"~";

  return (
    <div>
      {/* Score row */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"0.5rem",marginBottom:"1rem"}}>
        {[
          ["Tension Score",`${result.tensionScore}/10`,tc],
          ["Scene Arc",`${arcSymbol} ${result.arc}`,"#8b5cf6"],
          ["Hook",`${result.hookStrength}/10`,result.hookStrength>=7?"#4ade80":result.hookStrength>=5?"#facc15":"#ef4444"],
        ].map(([l,v,c])=>(
          <div key={l} style={{...S.card,padding:"0.75rem",textAlign:"center"}}>
            <div style={{...S.display,fontSize:"1.2rem",color:c,fontWeight:700}}>{v}</div>
            <div style={{...S.mono,fontSize:"0.55rem",color:"#475569",textTransform:"uppercase",letterSpacing:"0.08em",marginTop:"0.2rem"}}>{l}</div>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div style={{...S.card,marginBottom:"1rem"}}>
        <p style={{...S.serif,fontSize:"0.85rem",color:"#94a3b8",margin:0,lineHeight:1.7,fontStyle:"italic"}}>{result.summary}</p>
      </div>

      {/* Hook */}
      <div style={{...S.card,marginBottom:"1rem",borderLeft:`3px solid ${result.hookStrength>=7?"#4ade80":result.hookStrength>=5?"#facc15":"#ef4444"}`}}>
        <div style={{...S.label,marginBottom:"0.5rem"}}>Chapter Hook</div>
        <p style={{...S.serif,fontSize:"0.82rem",color:"#94a3b8",margin:0,lineHeight:1.6}}>{result.hook}</p>
      </div>

      {/* Stakes */}
      <div style={{...S.card,marginBottom:"1rem"}}>
        <div style={{...S.label,marginBottom:"0.5rem"}}>Stakes Assessment</div>
        <p style={{...S.serif,fontSize:"0.82rem",color:"#94a3b8",margin:0,lineHeight:1.6}}>{result.stakesAssessment}</p>
      </div>

      {/* Sag points */}
      {result.sagPoints?.length>0&&(
        <div style={{marginBottom:"1rem"}}>
          <div style={{...S.label,marginBottom:"0.6rem",color:"#f59e0b"}}>⚠ Where Tension Sags</div>
          {result.sagPoints.map((s,i)=>(
            <div key={i} style={{background:"#0f172a",borderLeft:"3px solid #f59e0b",borderRadius:"4px",padding:"0.75rem 1rem",marginBottom:"0.5rem"}}>
              <p style={{...S.serif,fontSize:"0.82rem",color:"#94a3b8",margin:0,lineHeight:1.6}}>{s}</p>
            </div>
          ))}
        </div>
      )}

      {/* Ending */}
      <div style={{...S.card,marginBottom:"1rem",borderLeft:`3px solid ${result.endingStrength>=7?"#4ade80":result.endingStrength>=5?"#facc15":"#ef4444"}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:"0.5rem"}}>
          <div style={S.label}>Chapter Ending</div>
          <span style={{...S.display,fontSize:"1rem",color:result.endingStrength>=7?"#4ade80":result.endingStrength>=5?"#facc15":"#ef4444",fontWeight:700}}>{result.endingStrength}/10</span>
        </div>
        <p style={{...S.serif,fontSize:"0.82rem",color:"#94a3b8",margin:0,lineHeight:1.6}}>{result.ending}</p>
      </div>

      {/* Recommendations */}
      {result.recommendations?.length>0&&(
        <div style={{...S.card,marginBottom:"1rem"}}>
          <div style={{...S.label,marginBottom:"0.75rem"}}>Recommendations</div>
          {result.recommendations.map((r,i)=>(
            <div key={i} style={{display:"flex",gap:"0.6rem",marginBottom:"0.6rem",paddingBottom:"0.6rem",borderBottom:i<result.recommendations.length-1?"1px solid #1e293b":"none"}}>
              <span style={{color:"#8b5cf6",fontSize:"0.9rem",lineHeight:1.4}}>→</span>
              <p style={{...S.serif,fontSize:"0.82rem",color:"#94a3b8",margin:0,lineHeight:1.6}}>{r}</p>
            </div>
          ))}
        </div>
      )}

      <RerunButton onClick={()=>setResult(null)}/>
    </div>
  );
}

// ─── TAB 7: RATING ────────────────────────────────────────────────────────────

function computeRating({ aiisms, pacing, repeats, patterns, showTell, dialogue, tension }) {
  const scores = [];
  const breakdown = [];
  const issues = [];
  const strengths = [];

  // AI-isms (0–100, from humanity score 1–10)
  if (aiisms) {
    const s = Math.round((aiisms.score / 10) * 100);
    scores.push({ weight: 2, val: s });
    breakdown.push({ label: "AI-isms", score: s, note: aiisms.score >= 8 ? "Strong human voice" : aiisms.score >= 6 ? "Mostly clean" : aiisms.score >= 4 ? `${aiisms.flags?.length||0} patterns to fix` : "Heavy AI patterns", color: s>=70?"#4ade80":s>=50?"#facc15":"#ef4444", api: true });
    if (aiisms.score < 6) issues.push(`${aiisms.flags?.length||0} AI-ism flags — run the AI-isms tab for rewrites`);
    if (aiisms.score >= 8) strengths.push("Strong human voice — minimal AI-ism patterns");
  }

  // Pacing (burstiness, monotony runs, starters)
  if (pacing) {
    let s = 100;
    if (pacing.burstiness < 0.35) s -= 35;
    else if (pacing.burstiness < 0.55) s -= 10;
    s -= Math.min(pacing.runs.length * 8, 24);
    s -= Math.min((pacing.starters?.overused?.length||0) * 8, 24);
    s -= Math.min((pacing.starters?.consecRuns?.length||0) * 6, 18);
    s = Math.max(0, Math.min(100, s));
    scores.push({ weight: 1, val: s });
    breakdown.push({ label: "Pacing", score: s, note: s>=80?"Good rhythm & variation":s>=60?"Some monotony detected":`${pacing.runs.length} monotony runs`, color: s>=70?"#4ade80":s>=50?"#facc15":"#ef4444", api: false });
    if (pacing.burstiness < 0.35) issues.push("Sentence lengths too uniform — vary structure more");
    if ((pacing.starters?.overused?.length||0) > 0) issues.push(`${pacing.starters.overused.map(s=>s.word).join(', ')} overused as sentence openers`);
    if (pacing.burstiness >= 0.55 && !pacing.runs.length) strengths.push("Natural sentence rhythm with good length variation");
  }

  // Repeats
  if (repeats) {
    let s = 100;
    s -= Math.min(repeats.crutchHits.length * 6, 36);
    s -= Math.min(repeats.echoes.length * 3, 24);
    s = Math.max(0, Math.min(100, s));
    scores.push({ weight: 1, val: s });
    breakdown.push({ label: "Word Usage", score: s, note: s>=80?"Clean vocabulary":s>=60?`${repeats.crutchHits.length} crutch words`:`${repeats.crutchHits.length} crutch, ${repeats.echoes.length} echoes`, color: s>=70?"#4ade80":s>=50?"#facc15":"#ef4444", api: false });
    if (repeats.crutchHits.length > 3) issues.push(`Overused crutch words: ${repeats.crutchHits.slice(0,3).map(h=>h.word).join(', ')}${repeats.crutchHits.length>3?'…':''}`);
    if (repeats.crutchHits.length === 0 && repeats.echoes.length < 3) strengths.push("Good word variety — no significant crutch words");
  }

  // Patterns
  if (patterns) {
    const triIssue = patterns.tricolons.length > Math.max(Math.floor(patterns.totalWords/300),2);
    const flagCount = [
      triIssue, patterns.stackedParas.length>0||patterns.doubleStacks.length>0,
      patterns.figStacks.length>0, patterns.contrastStacks.length>0,
      patterns.pivots.length>0, patterns.shorthandStacks.length>0
    ].filter(Boolean).length;
    const s = Math.max(0, 100 - flagCount * 16);
    scores.push({ weight: 1, val: s });
    breakdown.push({ label: "Patterns", score: s, note: flagCount===0?"No structural patterns":flagCount===1?"1 pattern flagged":`${flagCount} patterns flagged`, color: s>=70?"#4ade80":s>=50?"#facc15":"#ef4444", api: false });
    if (patterns.pivots.length > 0) issues.push(`${patterns.pivots.length} clean pivot sentence${patterns.pivots.length>1?"s":""} — replace with specific beats`);
    if (patterns.shorthandStacks.length > 0) issues.push("Emotional shorthand stacking detected — space these out");
    if (flagCount === 0) strengths.push("No problematic structural patterns detected");
  }

  // Show vs Tell
  if (showTell) {
    const s = showTell.ratio;
    scores.push({ weight: 1.5, val: s });
    breakdown.push({ label: "Show vs Tell", score: s, note: s>=75?"Strongly shown":s>=60?"Mostly shown":s>=45?"Balanced":s>=30?"Too much telling":"Heavily told", color: s>=70?"#4ade80":s>=50?"#facc15":"#ef4444", api: true });
    if (showTell.ratio < 50) issues.push("High telling ratio — convert emotional declarations to physical action");
    if (showTell.ratio >= 70) strengths.push(`${showTell.ratio}% showing — strong sensory and action grounding`);
  }

  // Dialogue
  if (dialogue) {
    const flagPenalty = Math.min((dialogue.flags?.length||0) * 8, 40);
    const s = Math.max(0, 100 - flagPenalty);
    scores.push({ weight: 1, val: s });
    breakdown.push({ label: "Dialogue", score: s, note: s>=80?"Strong dialogue craft":s>=60?`${dialogue.flags?.length||0} issues flagged`:"Multiple dialogue problems", color: s>=70?"#4ade80":s>=50?"#facc15":"#ef4444", api: true });
    if ((dialogue.flags?.length||0) > 3) issues.push(`${dialogue.flags.length} dialogue issues — check said-bookisms and on-the-nose lines`);
    if (s >= 80) strengths.push("Dialogue craft is solid — good tags, subtext, and voice");
  }

  // Tension
  if (tension) {
    const s = Math.round((tension.tensionScore / 10) * 100);
    scores.push({ weight: 1.5, val: s });
    breakdown.push({ label: "Tension", score: s, note: tension.tensionScore>=7?"Strong narrative drive":tension.tensionScore>=5?"Moderate tension":tension.tensionScore>=3?"Tension needs work":"Low narrative drive", color: s>=70?"#4ade80":s>=50?"#facc15":"#ef4444", api: true });
    if (tension.tensionScore < 5) issues.push(`Tension score ${tension.tensionScore}/10 — address sag points in the scene arc`);
    if (tension.tensionScore >= 7) strengths.push(`Tension score ${tension.tensionScore}/10 — strong narrative drive throughout`);
  }

  if (!scores.length) return null;

  const totalWeight = scores.reduce((a,b)=>a+b.weight,0);
  const overall = Math.round(scores.reduce((a,b)=>a+b.val*b.weight,0)/totalWeight);
  const grade = overall>=90?"A+":overall>=82?"A":overall>=75?"B+":overall>=67?"B":overall>=60?"C+":overall>=52?"C":overall>=44?"D":"F";
  const gradeColor = overall>=75?"#4ade80":overall>=60?"#facc15":overall>=44?"#fb923c":"#ef4444";
  const label = overall>=85?"Ready to submit":overall>=70?"Good draft — minor polish":overall>=55?"Solid bones — needs revision":"Needs significant work";

  return { overall, grade, gradeColor, label, breakdown, issues: issues.slice(0,5), strengths: strengths.slice(0,4), analyzed: scores.length };
}

function RatingTab({ wordCount, aiisms, pacing, repeats, patterns, showTell, dialogue, tension }) {
  if (wordCount < 50) return <Empty msg="Paste at least 50 words to generate a chapter rating"/>;

  const rating = computeRating({ aiisms, pacing, repeats, patterns, showTell, dialogue, tension });

  const apiTabs = [!aiisms && "AI-isms", !showTell && "Show vs Tell", !dialogue && "Dialogue", !tension && "Tension"].filter(Boolean);
  const analyzed = rating?.analyzed || 0;
  const total = 7;

  if (!rating) return (
    <div style={{ ...S.card, textAlign:"center", padding:"2rem" }}>
      <p style={{ ...S.mono, fontSize:"0.7rem", color:"#475569", margin:"0 0 0.5rem 0" }}>Run at least one analysis tab to generate a rating.</p>
    </div>
  );

  return (
    <div>
      {/* Overall score */}
      <div style={{ ...S.card, marginBottom:"1rem", textAlign:"center", padding:"2rem 1.5rem" }}>
        <div style={{ ...S.mono, fontSize:"0.62rem", color:"#475569", letterSpacing:"0.15em", textTransform:"uppercase", marginBottom:"1rem" }}>
          Overall Chapter Rating · {analyzed}/{total} analyses complete
        </div>

        {/* Grade ring */}
        <div style={{ position:"relative", width:"120px", height:"120px", margin:"0 auto 1rem" }}>
          <svg viewBox="0 0 120 120" style={{ width:"120px", height:"120px", transform:"rotate(-90deg)" }}>
            <circle cx="60" cy="60" r="50" fill="none" stroke="#1e293b" strokeWidth="10"/>
            <circle cx="60" cy="60" r="50" fill="none" stroke={rating.gradeColor}
              strokeWidth="10" strokeLinecap="round"
              strokeDasharray={`${2*Math.PI*50}`}
              strokeDashoffset={`${2*Math.PI*50*(1-rating.overall/100)}`}
              style={{ transition:"stroke-dashoffset 1s ease", filter:`drop-shadow(0 0 6px ${rating.gradeColor}88)` }}
            />
          </svg>
          <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
            <span style={{ fontFamily:"Georgia,serif", fontSize:"2.2rem", fontWeight:700, color:rating.gradeColor, lineHeight:1 }}>{rating.grade}</span>
            <span style={{ ...S.mono, fontSize:"0.6rem", color:"#64748b", marginTop:"0.2rem" }}>{rating.overall}%</span>
          </div>
        </div>

        <div style={{ fontFamily:"Georgia,serif", fontSize:"1rem", color:"#f1f5f9", fontWeight:600, marginBottom:"0.3rem" }}>{rating.label}</div>
        {apiTabs.length > 0 && (
          <p style={{ ...S.mono, fontSize:"0.6rem", color:"#475569", margin:"0.5rem 0 0 0", lineHeight:1.5 }}>
            Run {apiTabs.join(', ')} for a more complete score
          </p>
        )}
      </div>

      {/* Category breakdown */}
      <div style={{ ...S.card, marginBottom:"1rem" }}>
        <div style={{ ...S.label, marginBottom:"0.85rem" }}>Score Breakdown</div>
        <div style={{ display:"flex", flexDirection:"column", gap:"0.65rem" }}>
          {rating.breakdown.map(b => (
            <div key={b.label}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:"0.3rem" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"0.4rem" }}>
                  <span style={{ ...S.mono, fontSize:"0.65rem", color:"#cbd5e1" }}>{b.label}</span>
                  {b.api && <span style={{ ...S.mono, fontSize:"0.48rem", color:"#334155" }}>◆</span>}
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:"0.5rem" }}>
                  <span style={{ ...S.mono, fontSize:"0.6rem", color:"#64748b" }}>{b.note}</span>
                  <span style={{ ...S.mono, fontSize:"0.68rem", color:b.color, fontWeight:700, minWidth:"2.5rem", textAlign:"right" }}>{b.score}%</span>
                </div>
              </div>
              <div style={{ height:"4px", background:"#1e293b", borderRadius:"2px", overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${b.score}%`, background:b.color, borderRadius:"2px", boxShadow:`0 0 4px ${b.color}66` }}/>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top issues */}
      {rating.issues.length > 0 && (
        <div style={{ ...S.card, marginBottom:"1rem", borderLeft:"3px solid #ef4444" }}>
          <div style={{ ...S.label, marginBottom:"0.75rem", color:"#ef4444" }}>Top Issues to Address</div>
          {rating.issues.map((issue, i) => (
            <div key={i} style={{ display:"flex", gap:"0.6rem", marginBottom: i < rating.issues.length-1 ? "0.55rem" : 0, paddingBottom: i < rating.issues.length-1 ? "0.55rem" : 0, borderBottom: i < rating.issues.length-1 ? "1px solid #1e293b" : "none" }}>
              <span style={{ ...S.mono, fontSize:"0.7rem", color:"#ef4444", minWidth:"1rem" }}>{i+1}.</span>
              <p style={{ ...S.serif, fontSize:"0.82rem", color:"#94a3b8", margin:0, lineHeight:1.6 }}>{issue}</p>
            </div>
          ))}
        </div>
      )}

      {/* Strengths */}
      {rating.strengths.length > 0 && (
        <div style={{ ...S.card, marginBottom:"1rem", borderLeft:"3px solid #4ade80" }}>
          <div style={{ ...S.label, marginBottom:"0.75rem", color:"#4ade80" }}>What's Working</div>
          {rating.strengths.map((s, i) => (
            <div key={i} style={{ display:"flex", gap:"0.6rem", marginBottom: i < rating.strengths.length-1 ? "0.5rem" : 0 }}>
              <span style={{ color:"#4ade80", fontSize:"0.85rem" }}>✓</span>
              <p style={{ ...S.serif, fontSize:"0.82rem", color:"#86efac", margin:0, lineHeight:1.6 }}>{s}</p>
            </div>
          ))}
        </div>
      )}

      <p style={{ ...S.mono, fontSize:"0.6rem", color:"#334155", textAlign:"center", lineHeight:1.6, marginTop:"0.5rem" }}>
        Run more analyses to refine the score · ◆ = API analysis
      </p>
    </div>
  );
}

// ─── TAB 8: EXPORT ────────────────────────────────────────────────────────────

function ExportTab({wordCount,aiisms,pacing,repeats,showTell,dialogue,tension,fileName}) {
  const [exporting,setExporting]=useState(false);
  const [done,setDone]=useState(false);
  const [err,setErr]=useState(null);

  const checks=[
    {label:"AI-isms Analysis",ready:!!aiisms,api:true,note:aiisms?`Score ${aiisms.score}/10 · ${aiisms.flags?.length||0} flags`:"Run the AI-isms tab first"},
    {label:"Pacing & Starters",ready:!!pacing,api:false,note:pacing?`${pacing.total} sentences · ${pacing.starters?.overused?.length||0} overused openers`:"Paste text to generate"},
    {label:"Word Usage & Repeats",ready:!!repeats,api:false,note:repeats?`${repeats.crutchHits.length} crutch words · ${repeats.echoes.length} echoes`:"Paste text to generate"},
    {label:"Show vs Tell",ready:!!showTell,api:true,note:showTell?`${showTell.ratio}% shown`:"Run Show vs Tell tab first"},
    {label:"Dialogue Health",ready:!!dialogue,api:true,note:dialogue?`${dialogue.dialogueRatio}% dialogue · ${dialogue.flags?.length||0} flags`:"Run Dialogue tab first"},
    {label:"Tension & Stakes",ready:!!tension,api:true,note:tension?`Score ${tension.tensionScore}/10 · Arc: ${tension.arc}`:"Run Tension tab first"},
  ];
  const readyCount=checks.filter(c=>c.ready).length;
  const totalChecks=checks.length;

  async function doExport() {
    setExporting(true); setDone(false); setErr(null);
    try {
      const sourceName=fileName?fileName.replace(/\.docx$/i,''):null;
      await exportDocx({wordCount,aiisms,pacing,repeats,showTell,dialogue,tension,sourceName});
      setDone(true);
    } catch(e){setErr(e.message);}
    setExporting(false);
  }

  if (wordCount<50) return <Empty msg="Paste your manuscript text to enable export"/>;

  return (
    <div>
      <div style={{...S.card,marginBottom:"1rem"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:"0.75rem"}}>
          <div style={S.label}>Analysis Status</div>
          <span style={{...S.mono,fontSize:"0.65rem",color:readyCount===totalChecks?"#4ade80":"#64748b"}}>{readyCount}/{totalChecks} complete</span>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:"0.4rem"}}>
          {checks.map(c=>(
            <div key={c.label} style={{display:"flex",alignItems:"flex-start",gap:"0.75rem",padding:"0.55rem 0.75rem",background:"#0f172a",borderRadius:"4px",border:`1px solid ${c.ready?"#166534":"#1e293b"}`}}>
              <span style={{fontSize:"0.85rem",lineHeight:1,marginTop:"0.1rem",color:c.ready?"#4ade80":"#334155"}}>{c.ready?"✓":"○"}</span>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:"0.4rem"}}>
                  <span style={{...S.mono,fontSize:"0.66rem",color:c.ready?"#f1f5f9":"#475569"}}>{c.label}</span>
                  {c.api&&<span style={{...S.mono,fontSize:"0.48rem",color:"#334155"}}>◆ API</span>}
                </div>
                <span style={{...S.mono,fontSize:"0.58rem",color:c.ready?"#4ade80":"#475569"}}>{c.note}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{...S.card,marginBottom:"1.25rem",borderColor:"#166534"}}>
        <div style={{...S.mono,fontSize:"0.6rem",color:"#4ade80",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"0.5rem"}}>What's in the document</div>
        <p style={{...S.serif,fontSize:"0.82rem",color:"#94a3b8",margin:0,lineHeight:1.7}}>
          A structured Word document with one clearly headed section per completed analysis — all flags with original phrases and suggested rewrites, pacing rhythm notes, crutch word list, sentence starter breakdown, show/tell examples, dialogue flags and strengths, tension arc assessment, sag points, and structural recommendations.
          {readyCount<totalChecks&&<span style={{color:"#f59e0b"}}> {totalChecks-readyCount} analysis{totalChecks-readyCount>1?"es":""} not yet run will be omitted.</span>}
        </p>
      </div>
      <button onClick={doExport} disabled={exporting||readyCount===0} style={{width:"100%",padding:"1rem",background:exporting?"#1e293b":readyCount===0?"#0f172a":"#4ade80",border:"none",borderRadius:"4px",cursor:exporting||readyCount===0?"not-allowed":"pointer",...S.mono,fontSize:"0.78rem",letterSpacing:"0.15em",textTransform:"uppercase",color:exporting?"#475569":readyCount===0?"#334155":"#0a1628",fontWeight:700}}>
        {exporting?"◆ Building document...":done?"✓ Downloaded":"⬇ Download .docx Report"}
      </button>
      {err&&<p style={{...S.mono,fontSize:"0.7rem",color:"#ef4444",marginTop:"0.6rem"}}>{err}</p>}
      {done&&<p style={{...S.mono,fontSize:"0.68rem",color:"#4ade80",marginTop:"0.6rem",textAlign:"center"}}>File saved — check your downloads folder.</p>}
      <p style={{...S.mono,fontSize:"0.58rem",color:"#334155",marginTop:"0.75rem",textAlign:"center",lineHeight:1.6}}>Opens in Word, LibreOffice, and Pages. Re-run any analysis and re-export anytime.</p>
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────

export default function RedPen() {
  const [text,setText]=useState("");
  const [tab,setTab]=useState("aiisms");
  const [fileName,setFileName]=useState('');
  const [aiisms,setAiisms]=useState(null);
  const [showTell,setShowTell]=useState(null);
  const [dialogue,setDialogue]=useState(null);
  const [tension,setTension]=useState(null);

  const wordCount=useMemo(()=>countWords(text),[text]);
  const pacing=useMemo(()=>computePacing(text,wordCount),[text,wordCount]);
  const repeats=useMemo(()=>computeRepeats(text,wordCount),[text,wordCount]);
  const dialogueMeta=useMemo(()=>computeDialogueMeta(text,wordCount),[text,wordCount]);
  const patterns=useMemo(()=>computePatterns(text,wordCount),[text,wordCount]);

  const handleTextChange=t=>{
    setText(t);
    if(Math.abs(countWords(t)-wordCount)>20){setAiisms(null);setShowTell(null);setDialogue(null);setTension(null);}
  };

  return (
    <div style={{minHeight:"100vh",background:"#020817",color:"#e2e8f0",padding:"2rem 1.5rem",boxSizing:"border-box",fontFamily:"Georgia, serif"}}>
      <div style={{position:"fixed",inset:0,opacity:0.03,pointerEvents:"none",backgroundImage:`url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`}}/>
      <div style={{maxWidth:"780px",margin:"0 auto",position:"relative"}}>
        <div style={{marginBottom:"1.5rem"}}>
          <div style={{...S.mono,fontSize:"0.65rem",color:"#ef4444",letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:"0.5rem"}}>◆ Editorial Analysis Suite · v2</div>
          <h1 style={{...S.display,fontSize:"clamp(1.8rem,5vw,2.6rem)",fontWeight:700,margin:"0 0 0.4rem 0",lineHeight:1.1,background:"linear-gradient(135deg,#f1f5f9 0%,#94a3b8 100%)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>The Red Pen</h1>
          <p style={{...S.mono,fontSize:"0.7rem",color:"#475569",margin:0,letterSpacing:"0.05em"}}>AI-isms · Pacing · Repeats · Patterns · Show vs Tell · Dialogue · Tension</p>
        </div>
        <TextInput text={text} setText={handleTextChange} wordCount={wordCount} fileName={fileName} setFileName={setFileName}/>
        <TabBar active={tab} onChange={setTab}/>
        {tab==="aiisms"   &&<AIismsTab   text={text} wordCount={wordCount} result={aiisms}   setResult={setAiisms}/>}
        {tab==="pacing"   &&<PacingTab   wordCount={wordCount} pacing={pacing}/>}
        {tab==="repeats"  &&<RepeatsTab  wordCount={wordCount} repeats={repeats}/>}
        {tab==="patterns" &&<PatternsTab wordCount={wordCount} patterns={patterns}/>}
        {tab==="show-tell"&&<ShowTellTab text={text} wordCount={wordCount} result={showTell} setResult={setShowTell}/>}
        {tab==="dialogue" &&<DialogueTab text={text} wordCount={wordCount} result={dialogue} setResult={setDialogue} dialogueMeta={dialogueMeta}/>}
        {tab==="tension"  &&<TensionTab  text={text} wordCount={wordCount} result={tension}  setResult={setTension}/>}
        {tab==="rating"   &&<RatingTab   wordCount={wordCount} aiisms={aiisms} pacing={pacing} repeats={repeats} patterns={patterns} showTell={showTell} dialogue={dialogue} tension={tension}/>}
        {tab==="export"   &&<ExportTab   wordCount={wordCount} aiisms={aiisms} pacing={pacing} repeats={repeats} showTell={showTell} dialogue={dialogue} tension={tension} fileName={fileName}/>}
        <div style={{marginTop:"3rem",paddingTop:"1rem",borderTop:"1px solid #0f172a",textAlign:"center"}}>
          <p style={{...S.mono,fontSize:"0.55rem",color:"#1e293b",letterSpacing:"0.1em"}}>Signal9 Studio · The Red Pen v2 · ◆ = uses Claude API</p>
        </div>
      </div>
    </div>
  );
}
