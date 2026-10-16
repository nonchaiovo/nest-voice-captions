// Reusable caption algorithms extracted from NEST for this reference package.
// Pure algorithms only. No credentials, recordings, conversations or backend calls.
// See ./IMPLEMENTATION.md for integration contracts and limits.
const graphemes = text => Array.from(new Intl.Segmenter(undefined, {granularity:'grapheme'}).segment(text), x => x.segment);
const letters = text => Array.from(text.normalize('NFKC').toLowerCase()).filter(c => /[\p{L}\p{N}]/u.test(c));
export function normalizeAlignment(text, result) {
  if (!Array.isArray(result?.characters) || !result.characters.length) return null;
  const spoken = [];
  let previous = 0;
  for (const item of result.characters) {
    if (typeof item.text !== 'string' || !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < previous || item.end < item.start || item.end > 3600) return null;
    previous = item.start;
    for (const char of letters(item.text)) spoken.push({char, start:item.start, end:item.end});
  }
  const units = graphemes(text);
  if (units.flatMap(letters).join('') !== spoken.map(x=>x.char).join('') || !spoken.length) return null;
  let index = 0, lastEnd = spoken[0].start;
  return units.map(char => {
    const count = letters(char).length;
    if (!count) return {text:char, start:lastEnd, end:lastEnd};
    const first = spoken[index], last = spoken[index + count - 1];
    index += count; lastEnd = last.end;
    return {text:char, start:first.start, end:last.end};
  });
}
// STT fallback is word-level: every character in a recognized word shares that
// word's real start. Unmatched text stays untimed; never interpolate over sounds.
export function alignRecognizedWords(text, words, {allowPartial = false} = {}) {
  if (!Array.isArray(words)) return null;
  const units = graphemes(text), input = units.flatMap((char,index)=>letters(char).map(c=>({char:c,index})));
  const heard = []; let previous = 0;
  for (const [token,w] of words.entries()) {
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < previous || w.end < w.start || w.end > 3600) return null;
    previous = w.start;
    if (!(w.confidence >= .7)) continue;
    for (const char of letters(w.word || '')) heard.push({char,start:w.start,end:w.end,token});
  }
  if (!input.length || !heard.length || input.length*heard.length>4000000) return null;
  const n=input.length,m=heard.length,cols=m+1,dp=new Uint16Array((n+1)*cols);
  for(let i=n-1;i>=0;i--) for(let k=m-1;k>=0;k--) dp[i*cols+k]=input[i].char===heard[k].char?1+dp[(i+1)*cols+k+1]:Math.max(dp[(i+1)*cols+k],dp[i*cols+k+1]);
  const matches=new Map();let i=0,k=0;
  while(i<n&&k<m){if(input[i].char===heard[k].char){matches.set(i,heard[k]);i++;k++;}else if(dp[(i+1)*cols+k]>=dp[i*cols+k+1])i++;else k++;}
  // Keep only fully matched provider words; matching a letter inside another word is unsafe.
  const totals=new Map(),matched=new Map();for(const h of heard)totals.set(h.token,(totals.get(h.token)||0)+1);for(const h of matches.values())matched.set(h.token,(matched.get(h.token)||0)+1);
  for(const [index,h] of matches)if(totals.get(h.token)!==matched.get(h.token))matches.delete(index);
  if(matches.size/n<.8) {
    // Saved mixed-language clips can contain spelling/pronunciation that STT
    // misses. Retain a substantial contiguous, measured phrase, not isolated
    // coincidental letters. Unmatched text remains explicitly untimed.
    let run=0,longest=0,previousInput=-2,previousHeard=-2;
    const heardIndex=new Map(heard.map((h,index)=>[h,index]));
    for(const [index,h] of matches) {
      const hi=heardIndex.get(h);
      run=index===previousInput+1 && hi===previousHeard+1?run+1:1;
      longest=Math.max(longest,run);previousInput=index;previousHeard=hi;
    }
    if(!allowPartial || matches.size/n<.35 || longest<6)return null;
  }
  const byUnit=new Map();for(const [index,h] of matches){const u=input[index].index;if(!byUnit.has(u))byUnit.set(u,h);}
  return units.map((char,index)=>({text:char,start:byUnit.get(index)?.start??null,end:byUnit.get(index)?.end??null}));
}


export function voiceRevealTimes(timing, source) {
  const times = timing.map(t => t.start);
  if (!['deepgram-word-timestamps','groq-word-timestamps'].includes(source)) return times;
  for (let i=0;i<timing.length;) {
    const item=timing[i]; let end=i+1;
    if (!Number.isFinite(item.start) || !(item.end > item.start)) { i++; continue; }
    while(end<timing.length && timing[end].start===item.start && timing[end].end===item.end) end++;
    for(let k=i;k<end;k++) times[k]=item.start+(item.end-item.start)*(k-i)/(end-i);
    i=end;
  }
  return times;
}
export function voiceTextUnits(text) {
  return (typeof Intl.Segmenter === 'function'
    ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), s => s.segment)
    : Array.from(text)).map(char => ({char}));
}

export function normalizeVoiceMp3Seek(bytes) {
  const markers = [];
  let offset = 0;
  const tag = (at, text) => at + text.length <= bytes.length && Array.from(text).every((c,i) => bytes[at+i] === c.charCodeAt(0));
  while (offset < bytes.length) {
    if (tag(offset, 'ID3') && offset + 10 <= bytes.length) {
      const size = ((bytes[offset+6]&127)<<21)|((bytes[offset+7]&127)<<14)|((bytes[offset+8]&127)<<7)|(bytes[offset+9]&127);
      offset += 10 + size + ((bytes[offset+5]&16) ? 10 : 0);
      continue;
    }
    if (offset + 128 === bytes.length && tag(offset, 'TAG')) break;
    if (offset + 4 > bytes.length || bytes[offset] !== 255 || (bytes[offset+1]&224) !== 224) return bytes;
    const version = (bytes[offset+1]>>3)&3, layer = (bytes[offset+1]>>1)&3;
    const rateIndex = bytes[offset+2]>>4, sampleIndex = (bytes[offset+2]>>2)&3;
    if (version === 1 || layer !== 1 || rateIndex === 0 || rateIndex === 15 || sampleIndex === 3) return bytes;
    const rate = (version === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[rateIndex] * 1000;
    const sampleRate = [44100,48000,32000][sampleIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const length = Math.floor((version === 3 ? 144 : 72) * rate / sampleRate) + ((bytes[offset+2]>>1)&1);
    if (offset + length > bytes.length) return bytes;
    const mono = (bytes[offset+3]>>6) === 3;
    const sideInfo = version === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    const xing = offset + 4 + ((bytes[offset+1]&1) ? 0 : 2) + sideInfo;
    if (xing + 4 <= offset + length && (tag(xing,'Info') || tag(xing,'Xing'))) markers.push(xing);
    const vbri = offset + 36;
    if (vbri + 4 <= offset + length && tag(vbri,'VBRI')) markers.push(vbri);
    offset += length;
  }
  if (markers.length < 2) return bytes;
  const normalized = bytes.slice();
  for (const at of markers) normalized.fill(0, at, at + 4);
  return normalized;
}
