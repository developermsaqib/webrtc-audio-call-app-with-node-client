const io = require('socket.io-client');
const fs = require('fs');
const { RTCPeerConnection, MediaStream, RTCSessionDescription, RTCIceCandidate, nonstandard } = require('@roamhq/wrtc');
const wrtc = require("@roamhq/wrtc");
const path = require('path');
const wav = require('node-wav');

const socket = io('https://4138-182-183-88-254.ngrok-free.app', {
  rejectUnauthorized: false
});

let peer = null;
let currentCall = null;
let audioSource = null;

const configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
  ]
};

socket.on('connect', () => {
  console.log('Connected to server with ID:', socket.id);
});

function isValidWavFile(buffer) {
  // Check RIFF header
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') return false;
  // Check WAVE format
  if (buffer.toString('ascii', 8, 12) !== 'WAVE') return false;
  return true;
}

async function streamAudioFile(audioFilePath) {
  // Wait for peer connection to be ready
  if (!peer) {
    console.error("No peer connection exists!");
    return;
  }

  // Wait for ICE connection to be established
  if (peer.iceConnectionState !== 'connected') {
    console.log('Waiting for connection to be established...');
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000); // 10 second timeout

      const checkState = () => {
        if (peer.iceConnectionState === 'connected') {
          clearTimeout(timeout);
          resolve();
        } else if (peer.iceConnectionState === 'failed' || peer.iceConnectionState === 'closed') {
          clearTimeout(timeout);
          reject(new Error('Connection failed'));
        }
      };

      peer.addEventListener('iceconnectionstatechange', checkState);
    });
  }

  try {
    const audioFile = fs.readFileSync(audioFilePath);
    
    // Validate WAV file
    if (!isValidWavFile(audioFile)) {
      throw new Error('Invalid or unsupported WAV file format');
    }

    console.log('WAV file validation passed, attempting to decode...');
    
    // Try to decode the WAV file
    let decoded;
    try {
      decoded = wav.decode(audioFile);
    } catch (decodeError) {
      console.error('WAV decode error:', decodeError);
      throw new Error('Failed to decode WAV file. Please ensure it is a valid WAV file (PCM format).');
    }

    // Validate decoded data
    if (!decoded || !decoded.channelData || !decoded.channelData.length) {
      throw new Error('Invalid WAV file structure');
    }

    console.log('WAV file decoded successfully');
    console.log('Sample rate:', decoded.sampleRate);
    console.log('Channels:', decoded.channelData.length);
    console.log('Sample length:', decoded.channelData[0].length);

    // Create audio source and track immediately
    const audioSource = new nonstandard.RTCAudioSource();
    const track = audioSource.createTrack();

    // Wait for the track to be added before starting to send data
    await new Promise((resolve, reject) => {
      try {
        const senders = peer.getSenders();
        const audioSender = senders.find(sender => sender.track?.kind === 'audio');
        
        if (audioSender) {
          audioSender.replaceTrack(track).then(resolve);
        } else {
          peer.addTrack(track, new MediaStream([track]));
          resolve();
        }
      } catch (err) {
        reject(err);
      }
    });

    console.log('Audio track added to peer connection');

    // Configure audio parameters
    const sampleRate = 48000;
    const frameDuration = 0.010;
    const samplesPerFrame = 480;

    // Ensure mono audio
    let audioData = decoded.channelData[0];
    if (decoded.channelData.length > 1) {
      audioData = new Float32Array(decoded.channelData[0].length);
      for (let i = 0; i < audioData.length; i++) {
        audioData[i] = (decoded.channelData[0][i] + decoded.channelData[1][i]) / 2;
      }
    }

    // Resample to 48kHz
    const resampledData = new Float32Array(Math.floor(audioData.length * (sampleRate / decoded.sampleRate)));
    for (let i = 0; i < resampledData.length; i++) {
      const originalIndex = i * (decoded.sampleRate / sampleRate);
      const index = Math.floor(originalIndex);
      resampledData[i] = audioData[index];
    }

    let currentFrame = 0;
    const totalFrames = Math.floor(resampledData.length / samplesPerFrame);

    // Clear any existing interval
    if (currentCall && currentCall.audioInterval) {
      clearInterval(currentCall.audioInterval);
    }

    function sendAudioFrame() {
      if (currentFrame >= totalFrames) {
        console.log('Audio playback completed');
        clearInterval(frameInterval);
        return;
      }

      const startSample = currentFrame * samplesPerFrame;
      const samples = new Int16Array(samplesPerFrame);

      for (let i = 0; i < samplesPerFrame && (startSample + i) < resampledData.length; i++) {
        // Increase volume and add some compression
        const floatSample = resampledData[startSample + i];
        const compressed = Math.sign(floatSample) * Math.pow(Math.abs(floatSample), 0.8); // Soft compression
        const amplified = compressed * 2.0; // Double the volume
        samples[i] = Math.max(-32768, Math.min(32767, Math.floor(amplified * 32767)));
      }

      const audioData = {
        samples: samples,
        sampleRate: sampleRate,
        channelCount: 1,
        timestamp: currentFrame * frameDuration * 1000
      };

      try {
        audioSource.onData(audioData);
      } catch (error) {
        console.error('Error sending audio frame:', error);
        clearInterval(frameInterval);
      }

      currentFrame++;
    }

    // Add a small delay before starting to send frames
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const frameInterval = setInterval(sendAudioFrame, frameDuration * 1000);
    
    if (currentCall) {
      currentCall.audioInterval = frameInterval;
      currentCall.audioTrack = track;
    }

    console.log('Started streaming audio file');
    return track;

  } catch (error) {
    console.error('Error streaming audio file:', error);
    throw error;
  }
}

// Modify the call-accepted handler to ensure audio starts immediately
socket.on("call-accepted", async (signal) => {
  console.log('Call accepted');
  
  try {
    await peer.setRemoteDescription(new RTCSessionDescription(signal));
    console.log('Remote description set');
    
    // Wait for ICE connection before starting audio
    console.log('Waiting for ICE connection...');
    if (peer.iceConnectionState !== 'connected') {
      await new Promise(resolve => {
        const checkState = () => {
          if (peer.iceConnectionState === 'connected') {
            peer.removeEventListener('iceconnectionstatechange', checkState);
            resolve();
          }
        };
        peer.addEventListener('iceconnectionstatechange', checkState);
      });
    }
    
    // if (currentCall) {
    //     console.log('Starting audio stream...');
    //     await startStreamingAudio();
    // }
  } catch (error) {
    console.error("Error in call-accepted:", error);
  }
});

// Update startStreamingAudio function
async function startStreamingAudio(stream) {
  try {
    const audioPath = path.join(__dirname, 'converted.wav');
    
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found at: ${audioPath}`);
    }
    
    console.log('Audio file found at:', audioPath);
    
    // Clear any existing audio stream
    if (currentCall && currentCall.audioInterval) {
      clearInterval(currentCall.audioInterval);
      currentCall.audioInterval = null;
    }
    
    // Wait for the audio to start streaming
    await streamAudioFile(audioPath);
    console.log('Audio streaming started successfully');

  } catch (err) {
    console.error('Error starting audio stream:', err);
  }
}

// Update the callUser function to better handle the connection
async function callUser(userToCall) {
    try {
      console.log('Calling user:', userToCall);
      console.log("Configurationnnn: ",configuration);
      
      
      peer = new RTCPeerConnection(configuration);
      const stream = new MediaStream();
      
      // Set up ice candidate handling
      peer.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('Sending ICE candidate');
          socket.emit("ice-candidate", {
            to: userToCall,
            candidate: event.candidate
          });
        }
      };
  
      peer.oniceconnectionstatechange = () => {
        console.log('ICE Connection State:', peer.iceConnectionState);
        
        if (peer.iceConnectionState === 'connected') {
          console.log('WebRTC connection established, starting audio...');
          startStreamingAudio().catch(err => {
            console.error('Error starting audio after connection:', err);
          });
        }
      };

      peer.onconnectionstatechange = () => {
        console.log('Connection State:', peer.connectionState);
      };
  
      const offer = await peer.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      });
      
      await peer.setLocalDescription(offer);
      
      socket.emit("call-user", {
        userToCall,
        signalData: offer
      });
      
      currentCall = {
        to: userToCall,
        status: 'calling',
        stream: stream
      };
      
      console.log('Call offer sent');
    } catch (err) {
      console.error('Error in callUser:', err);
      if (peer) {
        peer.close();
        peer = null;
      }
      currentCall = null;
    }
}

// Handle call rejection
socket.on("call-rejected", () => {
  console.log('Call rejected');
  stopAudio();
  if (peer) {
    peer.close();
    peer = null;
  }
  currentCall = null;
});

// Update the stopAudio function to be more thorough
function stopAudio() {
  if (currentCall) {
    if (currentCall.audioInterval) {
      clearInterval(currentCall.audioInterval);
      currentCall.audioInterval = null;
    }
    if (currentCall.audioTrack) {
      currentCall.audioTrack.stop();
      currentCall.audioTrack = null;
    }
  }
}

// Handle ICE candidates
socket.on("ice-candidate", async ({ from, candidate }) => {
  try {
    if (peer && peer.iceConnectionState !== 'closed') {
      const iceCandidate = new RTCIceCandidate(candidate);
      await peer.addIceCandidate(iceCandidate);
      console.log("ICE Candidate: ",iceCandidate)
      console.log('Added ICE candidate successfully');
    }
  } catch (error) {
    console.error("Error adding ICE candidate:", error);
  }
});

// Modify the call-ended handler to properly clean up
socket.on("call-ended", () => {
  console.log('Call ended');
  stopAudio();
  if (peer) {
    // Remove the connection state change listener before closing
    peer.oniceconnectionstatechange = null;
    peer.close();
    peer = null;
  }
  currentCall = null;
});

// Get list of connected users
socket.on("users-list", (users) => {
  console.log('Connected users:', users);
});

// Example usage:
// To call a user, use their ID:
// callUser('user-id-here');

// Export functions for external use
module.exports = {
  callUser,
  socket,
  streamAudioFile
}; 