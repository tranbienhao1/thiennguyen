/*
 * Browser worker for local DSF and uncompressed DSDIFF/DFF to PCM WAV.
 * DSD decimation is adapted from dsd2pcm by Sebastian Gesemann (2009, 2011)
 * and bit-order additions by Adrian Smith (2013); see DSD-LICENSE.txt.
 */
'use strict';

const DEFAULT_TARGET_RATE = 44100;
const PCM_RATE_FAMILIES = [[44100, 88200, 176400], [48000, 96000, 192000]];
const SUPPORTED_TARGET_RATES = PCM_RATE_FAMILIES.flat();
const SUPPORTED_DSD_MULTIPLIERS = [32, 64, 128, 256, 512];
function dsdSourceInfo(rate) {
  for (const baseRate of [44100, 48000]) {
    const multiplier = rate / baseRate;
    if (Number.isInteger(multiplier) && SUPPORTED_DSD_MULTIPLIERS.includes(multiplier)) return {baseRate, multiplier};
  }
  return null;
}
const MAX_PCM_BYTES = 256 * 1024 * 1024;
const HTAPS = [
  0.09950731974056658, 0.09562845727714668, 0.08819647126516944, 0.07782552527068175,
  0.06534876523171299, 0.05172629311427257, 0.0379429484910187, 0.02490921351762261,
  0.0133774746265897, 0.003883043418804416, -0.003284703416210726, -0.008080250212687497,
  -0.01067241812471033, -0.01139427235000863, -0.0106813877974587, -0.009007905078766049,
  -0.006828859761015335, -0.004535184322001496, -0.002425035959059578, -0.0006922187080790708,
  0.0005700762133516592, 0.001353838005269448, 0.001713709169690937, 0.001742046839472948,
  0.001545601648013235, 0.001226696225277855, 0.0008704322683580222, 0.0005381636200535649,
  0.000266446345425276, 7.002968738383528e-05, -5.279407053811266e-05, -0.0001140625650874684,
  -0.0001304796361231895, -0.0001189970287491285, -9.396247155265073e-05, -6.577634378272832e-05,
  -4.07492895872535e-05, -2.17407957554587e-05, -9.163058931391722e-06, -2.017460145032201e-06,
  1.249721855219005e-06, 2.166655190537392e-06, 1.930520892991082e-06, 1.319400334374195e-06,
  7.410039764949091e-07, 3.423230509967409e-07, 1.244182214744588e-07, 3.130441005359396e-08
];

const reverseBits = new Uint8Array(256), lookup = Array.from({length:6}, () => new Float32Array(256));
for(let value=0;value<256;value++) { let reversed=0; for(let bit=0;bit<8;bit++) reversed=(reversed<<1)|((value>>bit)&1); reverseBits[value]=reversed; }
for(let table=0;table<6;table++) for(let value=0;value<256;value++) {
  let sum=0; for(let bit=0;bit<Math.min(8,48-table*8);bit++) sum+=(((value>>(7-bit))&1)*2-1)*HTAPS[table*8+bit];
  lookup[5-table][value]=sum;
}
function newDsdState(){return {fifo:new Uint8Array(16).fill(0x69),position:0};}
function decodeByte(state,value,lsb) {
  const fifo=state.fifo, position=state.position, current=lsb?reverseBits[value]:value;
  fifo[position]=current;
  const reverseIndex=(position-6)&15; fifo[reverseIndex]=reverseBits[fifo[reverseIndex]];
  let result=0; for(let i=0;i<6;i++) result+=lookup[i][fifo[(position-i)&15]]+lookup[i][fifo[(position-11+i)&15]];
  state.position=(position+1)&15; return result;
}
function newDecimator(){
  const taps=new Float64Array(96), center=47.5; let total=0;
  for(let i=0;i<taps.length;i++){const x=i-center,sinc=x===0?.44:Math.sin(Math.PI*.44*x)/(Math.PI*x),window=.42-.5*Math.cos(2*Math.PI*i/95)+.08*Math.cos(4*Math.PI*i/95);taps[i]=sinc*window;total+=taps[i];}
  for(let i=0;i<taps.length;i++)taps[i]/=total;
  return {taps,ring:new Float32Array(96),position:0,phase:0};
}
function decimate(state,sample){
  const ring=state.ring,taps=state.taps; ring[state.position]=sample; state.position=(state.position+1)%96;
  state.phase^=1; if(state.phase)return null;
  let result=0; for(let i=0;i<48;i++){const left=(state.position-1-i+96)%96,right=(state.position+i)%96;result+=(ring[left]+ring[right])*taps[i];}
  return result;
}

// DSD decoding runs off the UI thread; each file slice is read incrementally.
self.onmessage = event => run(event.data).catch(error => self.postMessage({type:'error', message:error.message || String(error)}));
function text(view, offset, length) { let out=''; for (let i=0;i<length;i++) out+=String.fromCharCode(view.getUint8(offset+i)); return out; }
function u64(view, offset, little) { const n=view.getBigUint64(offset,little); if(n>BigInt(Number.MAX_SAFE_INTEGER)) throw Error('Chunk DSD vượt giới hạn kích thước.'); return Number(n); }
async function parseDsf(file) {
  if(file.size<92) throw Error('Header DSF không hợp lệ.');
  const root=new DataView(await file.slice(0,28).arrayBuffer());
  if(root.byteLength<28||text(root,0,4)!=='DSD ') throw Error('Header DSF không hợp lệ.');
  let offset=28,rate=0,channels=0,sampleCount=0,blockSize=0,dataOffset=0,dataSize=0,lsb=true;
  while(offset+12<=file.size) {
    const headerBytes=await file.slice(offset,offset+12).arrayBuffer();
    if(headerBytes.byteLength!==12) throw Error('Header chunk DSF bị cắt.');
    const header=new DataView(headerBytes),id=text(header,0,4),size=u64(header,4,true);
    if(size<12||offset+size>file.size) throw Error('Chunk DSF bị cắt hoặc vượt quá kích thước file.');
    if(id==='fmt ') {
      if(size<52) throw Error('Chunk fmt DSF không đầy đủ.');
      const fmtBytes=await file.slice(offset,offset+52).arrayBuffer();
      if(fmtBytes.byteLength!==52) throw Error('Chunk fmt DSF không đầy đủ.');
      const fmt=new DataView(fmtBytes);
      channels=fmt.getUint32(24,true);rate=fmt.getUint32(28,true);
      sampleCount=u64(fmt,36,true);blockSize=fmt.getUint32(44,true);
      const bitOrder=fmt.getUint32(32,true);
      if(bitOrder!==1&&bitOrder!==8) throw Error('DSF dùng cờ bit order không hỗ trợ.');
      lsb=bitOrder===1;
    } else if(id==='data') {dataOffset=offset+12;dataSize=size-12;break;}
    offset+=size;
  }
  if(!rate||!channels||!sampleCount||!blockSize||!dataOffset) throw Error('Thiếu thông tin âm thanh DSF.');
  const requiredBytes=Math.ceil(sampleCount/8)*channels;
  if(dataSize<requiredBytes) throw Error('Chunk data DSF ngắn hơn số mẫu được khai báo trong fmt.');
  return {kind:'dsf',rate,channels,sampleCount,blockSize,dataOffset,dataSize,lsb};
}
function parseDffHeader(view) {
  if(view.byteLength<16||text(view,0,4)!=='FRM8'||text(view,12,4)!=='DSD ') throw Error('Header DSDIFF không hợp lệ.');
  return {rootEnd:u64(view,4,false)+12};
}
async function parseDff(file,view) {
  const {rootEnd}=parseDffHeader(view);
  if(rootEnd>file.size) throw Error('Header DSDIFF khai báo kích thước lớn hơn file.');
  let rate=0,channels=0,compression='',dataOffset=0,dataSize=0,offset=16;
  while(offset+12<=rootEnd) {
    if(offset+12>file.size) throw Error('Header DSDIFF bị cắt.');
    const head=new DataView(await file.slice(offset,offset+12).arrayBuffer());
    const id=text(head,0,4),size=u64(head,4,false),payload=offset+12;
    if(payload+size>rootEnd) throw Error('Chunk DSDIFF vượt quá kích thước FRM8.');
    if(id==='DST ') compression='DST ';
    if(id==='DSD '||id==='DST ') {dataOffset=payload;dataSize=size;break;}
    if(id==='PROP') {
      const kind=new Uint8Array(await file.slice(payload,payload+4).arrayBuffer());
      if(text(new DataView(kind.buffer),0,4)==='SND ') for(let child=payload+4;child+12<=payload+size;) {
        const childHead=new DataView(await file.slice(child,child+12).arrayBuffer());
        const sub=text(childHead,0,4),length=u64(childHead,4,false),data=child+12;
        if(data+length>payload+size) throw Error('Chunk con PROP DSDIFF không hợp lệ.');
        if(sub==='FS  '&&length>=4) {const bytes=await file.slice(data,data+4).arrayBuffer();rate=new DataView(bytes).getUint32(0,false);}
        if(sub==='CHNL'&&length>=2) {const bytes=await file.slice(data,data+2).arrayBuffer();channels=new DataView(bytes).getUint16(0,false);}
        if(sub==='CMPR'&&length>=4) {const bytes=new Uint8Array(await file.slice(data,data+4).arrayBuffer());compression=String.fromCharCode(...bytes);}
        child+=12+length+(length&1);
      }
    }
    offset=payload+size+(size&1);
  }
  if(offset+12>rootEnd) throw Error('Không tìm thấy chunk DSD/DST trong DSDIFF.');
  if(!rate||!channels) throw Error('Thiếu FS/CHNL trong DSDIFF.');
  if(!dataOffset&&compression==='') throw Error('Không tìm thấy chunk DSD/DST trong DSDIFF.');
  if(compression&&compression!=='DSD ') throw Error(`DFF dùng nén ${compression.trim()} (DST chưa hỗ trợ).`);
  if(dataOffset+dataSize>file.size||dataOffset+dataSize>rootEnd) throw Error('Chunk DSD DFF bị cắt hoặc vượt quá kích thước file.');
  return {kind:'dff',rate,channels,dataOffset,dataSize,lsb:false};
}
async function run({file,format,targetRate=DEFAULT_TARGET_RATE,bitDepth=16}) {
  if(!file) throw Error('Không nhận được file DSD.');
  targetRate=Number(targetRate); bitDepth=Number(bitDepth);
  if(!SUPPORTED_TARGET_RATES.includes(targetRate)) throw Error('PCM chỉ hỗ trợ 44.1/88.2/176.4 hoặc 48/96/192 kHz.');
  if(![16,24].includes(bitDepth)) throw Error('PCM chỉ hỗ trợ 16-bit hoặc 24-bit.');
  const info=format==='dsf'?await parseDsf(file):await parseDff(file,new DataView(await file.slice(0,Math.min(file.size,64*1024)).arrayBuffer()));
  const sourceInfo=dsdSourceInfo(info.rate);
  if(!sourceInfo) throw Error(`Tốc độ DSD nguồn ${info.rate} Hz chưa được hỗ trợ; hỗ trợ DSD32–DSD512 trong họ 44.1/48 kHz.`);
  const {baseRate:sourceBaseRate,multiplier:dsdMultiplier}=sourceInfo;
  const targetFamily=PCM_RATE_FAMILIES.find(rates=>rates.includes(targetRate));
  if(!targetFamily||targetFamily[0]!==sourceBaseRate) throw Error(`DSD${dsdMultiplier} thuộc họ ${sourceBaseRate/1000} kHz; hãy chọn PCM ${sourceBaseRate/1000}, ${(sourceBaseRate*2)/1000} hoặc ${(sourceBaseRate*4)/1000} kHz.`);
  const multiplier=info.rate/targetRate;
  if(!Number.isInteger(multiplier)||![8,16,32,64,128,256,512].includes(multiplier)) throw Error(`DSD${dsdMultiplier} không thể chuyển sang PCM ${targetRate/1000} kHz.`);
  if(info.channels<1||info.channels>8) throw Error(`Số kênh DSD không hợp lệ: ${info.channels}.`);
  if(info.kind==='dff'&&info.dataSize%info.channels) throw Error('Kích thước DFF không chia hết cho số kênh.');
  const channelBytes=info.kind==='dsf'?Math.ceil(info.sampleCount/8):info.dataSize/info.channels;
  const estimatedFrames=Math.ceil(channelBytes*8*targetRate/info.rate);
  const estimatedBytes=estimatedFrames*info.channels*(bitDepth/8);
  if(!Number.isSafeInteger(estimatedBytes)||estimatedBytes>MAX_PCM_BYTES||estimatedBytes>0xffffffff-36) throw Error(`PCM ${targetRate/1000} kHz/${bitDepth}-bit dự kiến vượt giới hạn WAV/bộ nhớ. Hãy chọn tần số hoặc độ sâu bit thấp hơn.`);
  const stages=Math.log2(multiplier)-3;
  const states=Array.from({length:info.channels},()=>({decoder:newDsdState(),filters:Array.from({length:stages},newDecimator)}));
  const bytesPerSample=bitDepth/8,chunks=[];let outputBytes=0,outputFrames=0,processed=0;
  function pack(channels) {
    if(!channels.length)return;
    const frames=Math.min(...channels.map(channel=>channel.length)); if(!frames)return;
    const bytes=new Uint8Array(frames*info.channels*bytesPerSample),view=new DataView(bytes.buffer);
    for(let frame=0;frame<frames;frame++)for(let channel=0;channel<info.channels;channel++) {
      const value=Math.max(-1,Math.min(1-1/(2**(bitDepth-1)),channels[channel][frame]));
      const sampleIndex=frame*info.channels+channel,integer=Math.round(value*2**(bitDepth-1)),offset=sampleIndex*bytesPerSample;
      if(bitDepth===16)view.setInt16(offset,integer,true);
      else {view.setUint8(offset,integer&255);view.setUint8(offset+1,(integer>>8)&255);view.setUint8(offset+2,(integer>>16)&255);}
    }
    outputBytes+=bytes.length;outputFrames+=frames;
    if(outputBytes>MAX_PCM_BYTES) throw Error('PCM sau chuyển đổi vượt 256 MB; hãy chọn chất lượng thấp hơn.');
    chunks.push(bytes);
  }
  function process(bytes,state) {
    const values=new Float32Array(Math.ceil(bytes.length/(2**stages))+2);let count=0;
    for(let i=0;i<bytes.length;i++) {
      let sample=decodeByte(state.decoder,bytes[i],info.lsb);
      for(const filter of state.filters){sample=decimate(filter,sample);if(sample===null)break;}
      if(sample!==null)values[count++]=sample;
    }
    return values.subarray(0,count);
  }
  if(info.kind==='dsf') {
    const channelBytes=Math.ceil(info.sampleCount/8),blocks=Math.ceil(channelBytes/info.blockSize);
    for(let block=0;block<blocks;block++) {
      if(self.cancelled) return;
      const rawChannels=[];
      for(let channel=0;channel<info.channels;channel++) {
        const start=info.dataOffset+block*info.blockSize*info.channels+channel*info.blockSize;
        const length=Math.min(info.blockSize,channelBytes-block*info.blockSize);
        const bytes=new Uint8Array(await file.slice(start,start+length).arrayBuffer());
        if(bytes.length!==length) throw Error('Không đọc đủ dữ liệu DSF.');
        rawChannels.push(bytes);
      }
      const commonLength=Math.min(...rawChannels.map(bytes=>bytes.length));
      const channels=rawChannels.map(bytes=>bytes.subarray(0,commonLength));
      pack(channels.map((bytes,channel)=>process(bytes,states[channel])));
      processed=Math.min(info.dataSize,(block+1)*info.blockSize*info.channels);
      self.postMessage({type:'progress',progress:Math.min(.99,processed/info.dataSize)});
    }
  } else {
    if(info.dataSize%info.channels) throw Error('Kích thước DFF không chia hết cho số kênh.');
    const groupBytes=Math.floor((256*1024)/info.channels)*info.channels;
    for(let offset=0;offset<info.dataSize;offset+=groupBytes) {
      if(self.cancelled) return;
      const length=Math.min(groupBytes,info.dataSize-offset);
      const raw=new Uint8Array(await file.slice(info.dataOffset+offset,info.dataOffset+offset+length).arrayBuffer());
      const channelBytes=raw.length/info.channels;
      const channels=Array.from({length:info.channels},()=>new Uint8Array(channelBytes));
      for(let i=0;i<raw.length;i+=info.channels)for(let channel=0;channel<info.channels;channel++)channels[channel][i/info.channels]=raw[i+channel];
      pack(channels.map((bytes,channel)=>process(bytes,states[channel])));
      processed+=raw.length;
      self.postMessage({type:'progress',progress:Math.min(.99,processed/info.dataSize)});
    }
  }
  if(!outputBytes)throw Error('Không giải mã được mẫu DSD.');
  if(outputBytes>0xffffffff-36)throw Error('WAV PCM sau chuyển đổi vượt 4 GB.');
  const header=new ArrayBuffer(44),wav=new DataView(header),blockAlign=info.channels*bytesPerSample;
  const tag=(offset,value)=>{for(let i=0;i<value.length;i++)wav.setUint8(offset+i,value.charCodeAt(i));};
  tag(0,'RIFF');wav.setUint32(4,36+outputBytes,true);tag(8,'WAVE');tag(12,'fmt ');wav.setUint32(16,16,true);wav.setUint16(20,1,true);
  wav.setUint16(22,info.channels,true);wav.setUint32(24,targetRate,true);wav.setUint32(28,targetRate*blockAlign,true);
  wav.setUint16(32,blockAlign,true);wav.setUint16(34,bitDepth,true);tag(36,'data');wav.setUint32(40,outputBytes,true);
  self.postMessage({type:'done',blob:new Blob([header,...chunks],{type:'audio/wav'}),duration:outputFrames/targetRate,rate:info.rate,targetRate,bitDepth,channels:info.channels,multiplier:dsdMultiplier,decimation:multiplier});
}
self.onmessage=event=>{if(event.data&&event.data.type==='cancel'){self.cancelled=true;return;}self.cancelled=false;run(event.data).catch(error=>self.postMessage({type:'error',message:error.message||String(error)}));};
// Decoder converts local DSD to selectable PCM rates/depths in browser memory; no audio is uploaded.

