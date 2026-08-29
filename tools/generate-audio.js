const fs = require('fs');
const path = require('path');

const RATE = 22050;
let seed = 0x13572468;
function noise() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff * 2 - 1;
}

function writeWav(name, seconds, sampleFn) {
  const count = Math.floor(RATE * seconds);
  const dataSize = count * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataSize, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(RATE, 24); buffer.writeUInt32LE(RATE * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < count; i += 1) {
    const t = i / RATE;
    const sample = Math.max(-1, Math.min(1, sampleFn(t, seconds)));
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'resources', 'audio', `${name}.wav`), buffer);
}

fs.mkdirSync(path.join(__dirname, '..', 'assets', 'resources', 'audio'), { recursive: true });
writeWav('m16', 0.18, (t, d) => {
  const env = Math.exp(-t * 24);
  return (noise() * 0.78 + Math.sin(2 * Math.PI * (150 - t * 430) * t) * 0.38) * env;
});
writeWav('akm', 0.23, (t) => {
  const env = Math.exp(-t * 17);
  return (noise() * 0.7 + Math.sin(2 * Math.PI * (105 - t * 180) * t) * 0.52) * env;
});
writeWav('mp5', 0.13, (t) => (noise() * 0.55 + Math.sin(2 * Math.PI * 205 * t) * 0.28) * Math.exp(-t * 31));
writeWav('m249', 0.21, (t) => (noise() * 0.72 + Math.sin(2 * Math.PI * 118 * t) * 0.42) * Math.exp(-t * 19));
writeWav('aks74u', 0.17, (t) => (noise() * 0.65 + Math.sin(2 * Math.PI * 155 * t) * 0.36) * Math.exp(-t * 24));
writeWav('pkm', 0.25, (t) => (noise() * 0.74 + Math.sin(2 * Math.PI * 92 * t) * 0.48) * Math.exp(-t * 16));
writeWav('glock17', 0.12, (t) => (noise() * 0.48 + Math.sin(2 * Math.PI * 245 * t) * 0.34) * Math.exp(-t * 34));
let filtered = 0;
writeWav('explosion', 0.72, (t) => {
  filtered = filtered * 0.86 + noise() * 0.14;
  return (filtered * 1.2 + Math.sin(2 * Math.PI * 46 * t) * 0.28) * Math.exp(-t * 5.2);
});
writeWav('hit', 0.09, (t) => (noise() * 0.25 + Math.sin(2 * Math.PI * 720 * t) * 0.55) * Math.exp(-t * 42));
writeWav('reload', 0.48, (t) => {
  const clicks = [0.02, 0.2, 0.39].reduce((sum, at) => sum + Math.exp(-Math.abs(t - at) * 150), 0);
  return (noise() * 0.34 + Math.sin(2 * Math.PI * 1100 * t) * 0.2) * Math.min(1, clicks);
});

let indoorTail = 0;
writeWav('weapon-tail-indoor', 0.31, (t) => {
  indoorTail = indoorTail * 0.78 + noise() * 0.22;
  const slap = Math.exp(-Math.abs(t - 0.045) * 46) + Math.exp(-Math.abs(t - 0.13) * 32) * 0.6;
  return (indoorTail * 0.36 + Math.sin(2 * Math.PI * 92 * t) * 0.18) * Math.exp(-t * 8.4) * slap;
});
let outdoorTail = 0;
writeWav('weapon-tail-outdoor', 0.58, (t) => {
  outdoorTail = outdoorTail * 0.9 + noise() * 0.1;
  return (outdoorTail * 0.42 + Math.sin(2 * Math.PI * 63 * t) * 0.12) * Math.exp(-t * 5.2);
});
writeWav('footstep-concrete', 0.16, (t) => (noise() * 0.25 + Math.sin(2 * Math.PI * 125 * t) * 0.34) * Math.exp(-t * 27));
writeWav('footstep-metal', 0.2, (t) => (noise() * 0.18 + Math.sin(2 * Math.PI * 410 * t) * 0.34 + Math.sin(2 * Math.PI * 730 * t) * 0.15) * Math.exp(-t * 18));
let dirtStep = 0;
writeWav('footstep-dirt', 0.19, (t) => { dirtStep=dirtStep*0.62+noise()*0.38;return dirtStep*0.48*Math.exp(-t*24); });
writeWav('impact-body', 0.1, (t) => (noise()*0.22+Math.sin(2*Math.PI*105*t)*0.38)*Math.exp(-t*35));
writeWav('impact-metal', 0.18, (t) => (noise()*0.16+Math.sin(2*Math.PI*920*t)*0.36+Math.sin(2*Math.PI*1380*t)*0.18)*Math.exp(-t*22));
writeWav('impact-concrete', 0.14, (t) => (noise()*0.42+Math.sin(2*Math.PI*180*t)*0.17)*Math.exp(-t*31));

console.log('generated 18 audio clips');
