const socket = io();
let localStream, peer;
let mediaRecorder;
let audioChunks = [];
let iceCandidatesQueue = []; // Queue for ICE candidates

// Define the configuration for the RTCPeerConnection
const configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }, // STUN server
    // Uncomment and configure a TURN server if needed
    // {
    //   urls: "turn:your.turn.server:3478", // Replace with your TURN server
    //   username: "your_username", // Replace with your TURN server username
    //   credential: "your_password" // Replace with your TURN server password
    // }
  ],
};

socket.on("your-id", (id) => {
  console.log("Your ID:", id); // Debugging: Log the user's ID
  document.getElementById("userId").value = id;
});

navigator.mediaDevices
  .getUserMedia({ audio: true })
  .then((stream) => {
    localStream = stream;
    console.log("Local stream obtained"); // Debugging: Log when local stream is obtained
  })
  .catch((error) => {
    console.error("Error accessing media devices.", error); // Debugging: Log any errors
  });

function callUser() {
  const userToCall = document.getElementById("userId").value;
  peer = new RTCPeerConnection(configuration); // Use the configuration with STUN server
  localStream.getTracks().forEach((track) => peer.addTrack(track, localStream));

  peer.onicecandidate = (e) => {
    if (e.candidate) {
      console.log("ICE candidate generated:", e.candidate); // Debugging: Log ICE candidates
      if (peer.remoteDescription) {
        socket.emit("ice-candidate", {
          to: userToCall,
          candidate: e.candidate,
        });
      } else {
        iceCandidatesQueue.push(e.candidate); // Queue until remote description is set
      }
    }
  };

  peer.ontrack = (e) => {
    const audio = new Audio();
    audio.srcObject = e.streams[0];
    audio.play();

    // Create a new MediaStream to combine local and remote audio
    const combinedStream = new MediaStream();

    // Add remote audio track
    combinedStream.addTrack(e.track);

    // Add local audio tracks
    localStream.getTracks().forEach((track) => combinedStream.addTrack(track));

    // Start recording the combined audio stream
    mediaRecorder = new MediaRecorder(combinedStream);
    mediaRecorder.start();

    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
      // Convert audioChunks to a Blob and send it to the server
      const audioBlob = new Blob(audioChunks, { type: "audio/wav" });
      socket.emit("audio-data", audioBlob); // Send audio data to server
      audioChunks = []; // Clear the chunks after sending
    };
  };

  peer
    .createOffer()
    .then((offer) => {
      console.log("SDP Offer created:", offer); // Debugging: Log the SDP offer
      return peer.setLocalDescription(offer);
    })
    .then(() => {
      console.log("Local description set. Emitting call-user."); // Debugging: Log when local description is set
      socket.emit("call-user", {
        userToCall,
        signalData: peer.localDescription,
      });
    })
    .catch((error) => {
      console.error("Error during call setup:", error); // Debugging: Log any errors during setup
    });
}

socket.on("call-user", (data) => {
  console.log("Call user signal received:", data); // Debugging: Log when a call user signal is received
  peer = new RTCPeerConnection(configuration); // Use the configuration with STUN server
  localStream.getTracks().forEach((track) => peer.addTrack(track, localStream));

  peer.onicecandidate = (e) => {
    if (e.candidate) {
      console.log("ICE candidate generated:", e.candidate); // Debugging: Log ICE candidates
      socket.emit("ice-candidate", { to: data.from, candidate: e.candidate });
    }
  };

  peer.ontrack = (e) => {
    const audio = new Audio();
    audio.srcObject = e.streams[0];
    audio.play();

    // Create a new MediaStream to combine local and remote audio
    const combinedStream = new MediaStream();

    // Add remote audio track
    combinedStream.addTrack(e.track);

    // Add local audio tracks
    localStream.getTracks().forEach((track) => combinedStream.addTrack(track));

    // Start recording the combined audio stream
    mediaRecorder = new MediaRecorder(combinedStream);
    mediaRecorder.start();

    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
      // Convert audioChunks to a Blob and send it to the server
      const audioBlob = new Blob(audioChunks, { type: "audio/wav" });
      socket.emit("audio-data", audioBlob); // Send audio data to server
      audioChunks = []; // Clear the chunks after sending
    };
  };

  peer
    .setRemoteDescription(new RTCSessionDescription(data.signal))
    .then(() => {
      console.log("Remote description set. Creating answer."); // Debugging: Log when remote description is set
      return peer.createAnswer();
    })
    .then((answer) => {
      console.log("SDP Answer created:", answer); // Debugging: Log the SDP answer
      return peer.setLocalDescription(answer);
    })
    .then(() => {
      console.log("Local description set. Emitting answer-call."); // Debugging: Log when local description is set
      socket.emit("answer-call", {
        to: data.from,
        signal: peer.localDescription,
      });
    })
    .catch((error) => {
      console.error("Error during call response:", error); // Debugging: Log any errors during response
    });
});

socket.on("call-accepted", (signal) => {
  console.log("Call accepted signal received:", signal); // Debugging: Log when call accepted signal is received
  peer
    .setRemoteDescription(new RTCSessionDescription(signal))
    .then(() => {
      console.log("Remote description set after call accepted."); // Debugging: Log when remote description is set
    })
    .catch((error) => {
      console.error(
        "Error setting remote description after call accepted:",
        error
      ); // Debugging: Log any errors
    });
});

socket.on("ice-candidate", (data) => {
  console.log("ICE candidate received:", data); // Debugging: Log received ICE candidates
  peer
    .addIceCandidate(new RTCIceCandidate(data))
    .then(() => {
      console.log("ICE candidate added successfully."); // Debugging: Log successful addition of ICE candidate
    })
    .catch((error) => {
      console.error("Error adding ICE candidate:", error); // Debugging: Log any errors
    });
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
