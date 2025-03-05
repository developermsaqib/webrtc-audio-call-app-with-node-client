const fs = require("fs");
const https = require("https");
const express = require("express");
const { Server } = require("socket.io");
const { Writable } = require("stream");
const cors = require("cors");

const app = express();
const server = https.createServer(
  {
    key: fs.readFileSync("key.pem"),
    cert: fs.readFileSync("cert.pem"),
  },
  app
);
const io = new Server(server);

app.use(express.static("public"));
app.use(cors());

const audioStream = new Writable({
  write(chunk, encoding, callback) {
    fs.appendFile("recording.wav", chunk, callback);
  },
});

const connectedUsers = new Map(); // Store connected users

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // Store user connection
  connectedUsers.set(socket.id, { id: socket.id });
  
  // Emit to all clients the updated users list, excluding the requesting client
  const emitUsersList = (requestingSocketId) => {
    const filteredUsers = Array.from(connectedUsers.values())
      .filter(user => user.id !== requestingSocketId);
    
    socket.emit("users-list", filteredUsers);
  };

  // Send initial users list to the new client (excluding themselves)
  emitUsersList(socket.id);
  
  // Broadcast to other clients that a new user has connected
  socket.broadcast.emit("users-list", Array.from(connectedUsers.values()));
  
  // Send the ID to the newly connected user
  socket.emit("your-id", socket.id);

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    connectedUsers.delete(socket.id);
    // Broadcast updated list to all remaining clients
    io.emit("users-list", Array.from(connectedUsers.values()));
  });

  // Handle initial call request
  socket.on("call-user", ({ userToCall, signalData }) => {
    console.log(`Call request from ${socket.id} to ${userToCall}`);
    socket.to(userToCall).emit("incoming-call", {
      from: socket.id,
      signal: signalData
    });
  });

  // Handle call acceptance
  socket.on("answer-call", ({ to, signal }) => {
    console.log(`Call answered by ${socket.id} to ${to}`);
    socket.to(to).emit("call-accepted", signal);
    
  });

  // Handle call rejection
  socket.on("reject-call", ({ to }) => {
    console.log(`Call rejected by ${socket.id}`);
    socket.to(to).emit("call-rejected");
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    console.log(`Relaying ICE candidate to ${to}`);
    socket.to(to).emit("ice-candidate", {
      from: socket.id,
      candidate: candidate
    });
  });
  socket.on("start-recording", () => {
    audioStream.write(Buffer.from([])); // Clear previous data if any
    socket.on("audio-data", (data) => {
      const buffer = Buffer.from(new Uint8Array(data)); // Convert to Buffer
      audioStream.write(buffer); // Write the incoming audio data to the file
    });
  });
  socket.on("stop-recording", () => {
    audioStream.end();
  });
  socket.on("error", (error) => {
    console.error("Socket error:", error);
  });
  socket.on("request-audio-file", () => {
    const audioFileStream = fs.createReadStream("stream.wav");

    audioFileStream.on("data", (chunk) => {
      socket.emit("audio-file-chunk", chunk);
    });

    audioFileStream.on("end", () => {
      socket.emit("audio-file-complete");
    });

    audioFileStream.on("error", (error) => {
      console.error("Error streaming audio file:", error);
      socket.emit("audio-file-error", error.message);
    });
  });

  // Add handler for end-call event
  socket.on("end-call", ({ to }) => {
    console.log(`Call ended by ${socket.id}`);
    socket.to(to).emit("call-ended");
  });
});

server.listen(80, () =>
  console.log("Server running on https://localhost:80")
);
