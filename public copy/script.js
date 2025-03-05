const socket = io();
let localStream, peer;
let mediaRecorder;
let audioChunks = [];
let iceCandidatesQueue = []; // Queue for ICE candidates
let audioContext;
let fileAudioStream = null;
let isStreamingFile = false;
let isMuted = false;
let currentCall = null;
let ringtone = new Audio('./ring.mp3');
ringtone.loop = true;
let callStartTime = null;
let callDurationInterval = null;

// Define the configuration for the RTCPeerConnection
const configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
  ],
};

socket.on("your-id", (id) => {
  console.log("Your ID:", id); // Debugging: Log the user's ID
  document.getElementById("userId").value = id;
});

navigator.mediaDevices
  .getUserMedia({ 
    audio: true,
    echoCancellation: true,
    noiseSuppression: true
  })
  .then((stream) => {
    localStream = stream;
    console.log("Local stream obtained with tracks:", stream.getTracks().length);
  })
  .catch((error) => {
    console.error("Error accessing media devices:", error);
    alert("Error accessing microphone. Please ensure microphone permissions are granted.");
  });

function callUser() {
  const userToCall = document.getElementById("userId").value;
  if (!userToCall) {
    alert("Please enter a user ID to call");
    return;
  }

  peer = new RTCPeerConnection(configuration);
  
  // Add local stream tracks to peer connection
  localStream.getTracks().forEach(track => {
    peer.addTrack(track, localStream);
    console.log("Added local track:", track.kind);
  });

  // Handle incoming stream
  peer.ontrack = (event) => {
    console.log("Received remote track:", event.track.kind);
    const remoteAudio = new Audio();
    remoteAudio.srcObject = event.streams[0];
    remoteAudio.autoplay = true;
    remoteAudio.play().catch(err => console.error("Audio play error:", err));
  };

  // Handle ICE candidates
  peer.onicecandidate = (event) => {
    if (event.candidate) {
      console.log("Sending ICE candidate");
      socket.emit("ice-candidate", {
        to: userToCall,
        candidate: event.candidate.toJSON()
      });
    }
  };

  peer.oniceconnectionstatechange = () => {
    console.log("ICE Connection State:", peer.iceConnectionState);
  };

  // Create and send offer
  peer.createOffer()
    .then(offer => {
      console.log("Created offer");
      return peer.setLocalDescription(offer);
    })
    .then(() => {
      console.log("Set local description");
      socket.emit("call-user", {
        userToCall,
        signalData: peer.localDescription
      });
      
      document.getElementById('callStatusText').textContent = 'Calling...';
      document.getElementById('callStatus').style.display = 'block';
      ringtone.play();
    })
    .catch(err => console.error("Error in call process:", err));

  currentCall = {
    to: userToCall,
    status: 'calling'
  };
}

// Handle incoming calls
socket.on("incoming-call", async (data) => {
  console.log("Incoming call from:", data.from);
  
  currentCall = {
    from: data.from,
    status: 'incoming',
    signal: data.signal
  };

  // Show incoming call UI
  document.getElementById('callerId').textContent = data.from;
  document.getElementById('incomingCall').style.display = 'block';
  ringtone.play();
});

function acceptCall() {
  if (!currentCall || !currentCall.from) return;

  ringtone.pause();
  document.getElementById('incomingCall').style.display = 'none';
  document.getElementById('callStatus').style.display = 'block';
  document.getElementById('callStatusText').textContent = 'Connected';
  document.getElementById('muteButton').disabled = false;

  peer = new RTCPeerConnection(configuration);

  // Add local stream tracks to peer connection
  localStream.getTracks().forEach(track => {
    peer.addTrack(track, localStream);
    console.log("Added local track:", track.kind);
  });

  // Handle incoming stream
  peer.ontrack = (event) => {
    console.log("Received remote track:", event.track.kind);
    const remoteAudio = new Audio();
    remoteAudio.srcObject = event.streams[0];
    remoteAudio.autoplay = true;
    remoteAudio.play().catch(err => console.error("Audio play error:", err));
  };

  // Handle ICE candidates
  peer.onicecandidate = (event) => {
    if (event.candidate) {
      console.log("Sending ICE candidate");
      socket.emit("ice-candidate", {
        to: currentCall.from,
        candidate: event.candidate.toJSON()
      });
    }
  };

  peer.oniceconnectionstatechange = () => {
    console.log("ICE Connection State:", peer.iceConnectionState);
  };

  // Accept the call
  peer.setRemoteDescription(new RTCSessionDescription(currentCall.signal))
    .then(() => {
      console.log("Set remote description");
      return peer.createAnswer();
    })
    .then(answer => {
      console.log("Created answer");
      return peer.setLocalDescription(answer);
    })
    .then(() => {
      console.log("Set local description");
      socket.emit("answer-call", {
        to: currentCall.from,
        signal: peer.localDescription
      });
    })
    .catch(err => console.error("Error in accept process:", err));

  // Start call duration timer
  callStartTime = Date.now();
  callDurationInterval = setInterval(updateCallDuration, 1000);
}

function rejectCall() {
  if (!currentCall || !currentCall.from) return;

  ringtone.pause();
  document.getElementById('incomingCall').style.display = 'none';
  socket.emit("reject-call", { to: currentCall.from });
  currentCall = null;
}

// Handle call acceptance
socket.on("call-accepted", (signal) => {
  ringtone.pause();
  document.getElementById('callStatusText').textContent = 'Connected';
  document.getElementById('muteButton').disabled = false;
  
  // Start call duration timer
  callStartTime = Date.now();
  callDurationInterval = setInterval(updateCallDuration, 1000);
  
  peer.setRemoteDescription(new RTCSessionDescription(signal))
    .catch(error => console.error("Error setting remote description:", error));
});

// Handle call rejection
socket.on("call-rejected", () => {
  ringtone.pause();
  document.getElementById('callStatus').style.display = 'none';
  document.getElementById('callStatusText').textContent = '';
  currentCall = null;
  alert('Call was rejected');
});

// Call this function to start recording
function startRecording() {
  socket.emit("start-recording");
}

// Call this function to stop recording
function stopRecording() {
  mediaRecorder.stop();
  mediaRecorder.onstop = () => {
    const audioBlob = new Blob(audioChunks, { type: "audio/wav" });
    socket.emit("audio-data", audioBlob); // Send audio data to server
    audioChunks = []; // Clear the chunks after sending
  };
}

// Add buttons to start and stop recording
document.getElementById("startRecording").onclick = startRecording;
document.getElementById("stopRecording").onclick = stopRecording;

// Add this function to stream audio file
async function streamAudioFile(event) {
  if (!peer) {
    alert("Please establish a call first!");
    return;
  }

  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  const file = event.target.files[0];
  if (!file) return;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Create audio source for the file
    const fileSource = audioContext.createBufferSource();
    fileSource.buffer = audioBuffer;

    // Create a gain node for the file audio (to control volume if needed)
    const fileGain = audioContext.createGain();
    fileGain.gain.value = 1.0; // Adjust this value to change file audio volume

    // Create audio source for the microphone
    const micStream = audioContext.createMediaStreamSource(localStream);
    const micGain = audioContext.createGain();
    micGain.gain.value = 1.0; // Adjust this value to change microphone volume

    // Create a merger node to combine both audio sources
    const merger = audioContext.createChannelMerger(2);

    // Connect the audio graph
    fileSource.connect(fileGain);
    fileGain.connect(merger, 0, 0);
    micStream.connect(micGain);
    micGain.connect(merger, 0, 1);

    // Create a media stream destination
    const streamDestination = audioContext.createMediaStreamDestination();
    merger.connect(streamDestination);

    // Replace the audio track in the peer connection
    const senders = peer.getSenders();
    const audioSender = senders.find((sender) => sender.track.kind === "audio");
    if (audioSender) {
      await audioSender.replaceTrack(
        streamDestination.stream.getAudioTracks()[0]
      );
    }

    // Start playing the file audio
    fileSource.start();
    isStreamingFile = true;

    // When file playback ends
    fileSource.onended = async () => {
      isStreamingFile = false;
      // Restore original microphone track
      if (audioSender) {
        await audioSender.replaceTrack(localStream.getAudioTracks()[0]);
      }
      // Clean up audio nodes
      fileSource.disconnect();
      fileGain.disconnect();
      micStream.disconnect();
      micGain.disconnect();
      merger.disconnect();
      streamDestination.disconnect();
    };
  } catch (error) {
    console.error("Error streaming audio file:", error);
    alert("Error streaming audio file. Please try again.");
  }
}

// Add this event listener at the bottom of the file
document
  .getElementById("audioFileInput")
  .addEventListener("change", streamAudioFile);

function toggleMute() {
  if (!localStream) return;
  
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(track => {
    track.enabled = !isMuted;
  });
  
  document.getElementById('muteButton').textContent = isMuted ? 'Unmute' : 'Mute';
}

socket.on('user-busy', () => {
  document.getElementById('callStatus').style.display = 'none';
  document.getElementById('callStatusText').textContent = '';
  currentCall = null;
  alert('User is busy');
});

// Update ICE candidate handling
socket.on("ice-candidate", async ({ from, candidate }) => {
  try {
    if (peer) {
      console.log("Received ICE candidate");
      await peer.addIceCandidate(new RTCIceCandidate(candidate));
      console.log("Successfully added ICE candidate");
    }
  } catch (error) {
    console.error("Error adding ICE candidate:", error);
  }
});

// Add this function to update call duration
function updateCallDuration() {
  if (!callStartTime) return;
  
  const duration = Math.floor((Date.now() - callStartTime) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  document.getElementById('callDuration').textContent = 
    `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Add function to end call
function endCall() {
  if (!currentCall) return;

  // Stop duration timer
  if (callDurationInterval) {
    clearInterval(callDurationInterval);
    callDurationInterval = null;
  }
  callStartTime = null;

  // Close peer connection
  if (peer) {
    peer.close();
    peer = null;
  }

  // Reset UI
  document.getElementById('callStatus').style.display = 'none';
  document.getElementById('callStatusText').textContent = '';
  document.getElementById('callDuration').textContent = '';
  document.getElementById('muteButton').disabled = true;

  // Emit end-call event
  const otherUser = currentCall.to || currentCall.from;
  socket.emit('end-call', { to: otherUser });

  // Reset current call
  currentCall = null;
  ringtone.pause();
}

// Add handler for call-ended event
socket.on("call-ended", () => {
  endCall();
  alert('Call ended');
});
