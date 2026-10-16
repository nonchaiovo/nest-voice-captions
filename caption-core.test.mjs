import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAlignment, alignRecognizedWords, voiceRevealTimes, voiceTextUnits, normalizeVoiceMp3Seek } from './caption-core.mjs';

test('graphemes preserve a combined accent and a family emoji', () => {
  assert.deepEqual(voiceTextUnits('e\u0301👨‍👩‍👧‍👦'), [{char:'e\u0301'},{char:'👨‍👩‍👧‍👦'}]);
});
test('forced alignment preserves introductory and internal audio gaps', () => {
  const cues = normalizeAlignment('你好，回来。',{characters:[{text:'你',start:2,end:2.4},{text:'好',start:2.4,end:2.8},{text:'回',start:5,end:5.4},{text:'来',start:5.4,end:5.8}]});
  assert.deepEqual(cues.map(c=>c.start),[2,2.4,2.8,5,5.4,5.8]);
});
test('mismatched or reversed alignment is rejected', () => {
  assert.equal(normalizeAlignment('你好',{characters:[{text:'你错',start:1,end:2}]}),null);
  assert.equal(normalizeAlignment('你好',{characters:[{text:'你',start:2,end:3},{text:'好',start:1,end:2}]}),null);
  assert.equal(normalizeAlignment('你好',{}),null);
});
test('word timing remains measured while visual reveal subdivides the word', () => {
  const cues=alignRecognizedWords('你好，回来。',[{word:'你好',start:2,end:2.8,confidence:.99},{word:'回来',start:5,end:5.8,confidence:.99}]);
  assert.deepEqual(cues.map(c=>c.start),[2,2,null,5,5,null]);
  assert.deepEqual(voiceRevealTimes(cues,'deepgram-word-timestamps'),[2,2.4,null,5,5.4,null]);
  assert.deepEqual(cues.map(c=>c.start),[2,2,null,5,5,null]);
  assert.deepEqual(voiceRevealTimes(cues,'elevenlabs-forced-alignment'),[2,2,null,5,5,null]);
});
test('low-confidence recognition does not produce seek times', () => {
  assert.equal(alignRecognizedWords('你好',[{word:'你好',start:0,end:1,confidence:.3}]),null);
});
test('saved partial alignment keeps an anchored phrase and leaves the rest untimed', () => {
  const text='这是一段测试文字example未对齐部分';
  const words=[{word:'这是一段测试文字',start:.2,end:2,confidence:.99}];
  assert.equal(alignRecognizedWords(text,words),null);
  const cues=alignRecognizedWords(text,words,{allowPartial:true});
  assert.equal(cues[0].start,.2);assert.equal(cues.at(-1).start,null);
});
test('sparse coincidental matches do not satisfy partial alignment', () => {
  const words=['甲','丙','戊','庚'].map((word,i)=>({word,start:i*2,end:i*2+1,confidence:.99}));
  assert.equal(alignRecognizedWords('甲乙丙丁戊己庚辛壬癸',words,{allowPartial:true}),null);
});
function frame(marker){const b=new Uint8Array(576);b.set([255,251,152,192]);if(marker)b.set(Buffer.from(marker),21);return b;}
const join=(...parts)=>new Uint8Array(Buffer.concat(parts.map(x=>Buffer.from(x))));
test('multiple MP3 indexes are disabled without moving or changing speech frames', () => {
  const bytes=join(frame('Info'),frame(),frame('Info'),frame(),frame('Xing'),frame());
  const fixed=normalizeVoiceMp3Seek(bytes),expected=bytes.slice();
  for(const at of [21,1173,2325])expected.fill(0,at,at+4);
  assert.notEqual(fixed,bytes);assert.deepEqual(fixed,expected);
  assert.equal(Buffer.from(bytes.slice(21,25)).toString(),'Info');
});
test('single MP3 indexes and marker-like speech bytes remain unchanged', () => {
  const bytes=join(frame('Info'),frame());bytes.set(Buffer.from('Info'),650);
  assert.equal(normalizeVoiceMp3Seek(bytes),bytes);
});
test('malformed and truncated MP3 data remain unchanged', () => {
  const bytes=join(frame('Info'),frame('Info'),new Uint8Array([1,2,3]));
  assert.equal(normalizeVoiceMp3Seek(bytes),bytes);
  const fake=new Uint8Array(Buffer.from('Info fake Info'));assert.equal(normalizeVoiceMp3Seek(fake),fake);
});
test('ID3-prefixed segments keep tag bytes and offsets intact', () => {
  const id3=new Uint8Array([73,68,51,4,0,0,0,0,0,0]);
  const bytes=join(id3,frame('Info'),frame(),id3,frame('Xing'),frame());
  const fixed=normalizeVoiceMp3Seek(bytes);
  assert.notEqual(fixed,bytes);assert.deepEqual(fixed.slice(0,10),id3);assert.deepEqual(Array.from(fixed.slice(31,35)),[0,0,0,0]);
});
