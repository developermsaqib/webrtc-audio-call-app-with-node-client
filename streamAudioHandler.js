const wrtc = require('@roamhq/wrtc');
const fs = require('fs');
const path = require('path');

function streamAudio(peerConnection, audioFilePath) {
  const { RTCAudioSource } = wrtc.nonstandard;
  const audioSource = new RTCAudioSource();
  
  const sampleRate = 48000;
  const samplesPerFrame = 480;
  const playbackSpeed = 1.75;
  
  const audioFile = fs.readFileSync(audioFilePath);
  const audioData = new Int16Array(audioFile.buffer);
  let currentIndex = 0;
  
  const track = audioSource.createTrack();
  const stream = new wrtc.MediaStream([track]);
  peerConnection.addTrack(track, stream);
  
  const samples = new Int16Array(samplesPerFrame);
  
  const audioInterval = setInterval(() => {
    for (let i = 0; i < samplesPerFrame; i++) {
      const sourceIndex = Math.floor((currentIndex + i * playbackSpeed) % audioData.length);
      samples[i] = audioData[sourceIndex];
    }
    
    audioSource.onData({
      samples: samples,
      sampleRate: sampleRate,
      channels: 1,
      bitsPerSample: 16
    });

    currentIndex = Math.floor((currentIndex + samplesPerFrame * playbackSpeed) % audioData.length);
  }, 7);

  return { audioSource, audioInterval };
}

module.exports = { streamAudio };
