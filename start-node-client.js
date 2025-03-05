const { callUser, socket } = require('./node-client');

// Wait for connection and users list
socket.on('users-list', (users) => {
  if (users.length > 0) {
    // Call the first available user
    callUser("tNovHls5Z5HHNeOHAAAB");
  }
}); 