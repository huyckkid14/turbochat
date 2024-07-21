let socket;
let username;
let isAdmin = false; // Assume this is set correctly during login
let onlineUsers = new Set();
let typingTimeout;
let typingInterval;

const badWords = ["shit", "fuck", "ass", "stupid", "hell"];
const replacement = "CHAT";

function sanitizeMessage(message) {
  let sanitizedMessage = message;
  badWords.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    sanitizedMessage = sanitizedMessage.replace(regex, replacement);
  });
  return sanitizedMessage;
}

function handleErrorMessage(errorMsg) {
  alert(errorMsg);
  // Optionally, you could disable the chat input or take other actions here
}
function sendMessage() {
  const to = document.getElementById('to').value;
  const message = document.getElementById('message').value;
  const sanitizedMessage = sanitizeMessage(message); // Sanitize the message
  if (to && sanitizedMessage) {
    if (to === 'system' || onlineUsers.has(to)) {
      sendChatMessage(to, sanitizedMessage);
    } else {
      const confirmed = confirm(`${to} is offline. Do you still want to send? The messages will be piled up.`);
      if (confirmed) {
        sendChatMessage(to, sanitizedMessage);
      }
    }
    document.getElementById('message').value = '';
  }
}

function sendChatMessage(to, message) {
  console.log('Sending message:', { to, message });
  if (to === 'system') {
    if (message === "/commands") {
      displaySystemMessage('Commands list');
      displaySystemMessage('/ban user <username>: Bans a certain user and forces them to log out');
      displaySystemMessage('/time-date: Displays the current date and time');
      displaySystemMessage('/ban p <username> "message": Permenantly bans a certain user, removes its data from the server, displays error message with the admin message, and makes them wait for 5 seconds before signing up again');
    } else if (message === "/time-date") {
      const now = new Date();
      const dateTimeString = `Date: ${now.toLocaleDateString()}, Time: ${now.toLocaleTimeString()}`;
      displaySystemMessage(dateTimeString);
    } else if (username !== "huyckkid14" && message.includes('/ban user')) {
      displaySystemMessage('Forbidden: You need to be admin to use this command.');
    } else if (!isValidCommand(message)) {
      const errorMsg = `Command Error: ${message} is not a defined command. Type "/commands" for list of commands`;
      displaySystemMessage(errorMsg);
      socket.send(JSON.stringify({ type: 'chat', to: 'system', message: errorMsg }));
    } else {
      socket.send(JSON.stringify({ type: 'chat', to, message }));
    }
  } else {
    socket.send(JSON.stringify({ type: 'chat', to, message }));
  }
}

function displaySystemMessage(message) {
  setTimeout(() => {
    const messagesDiv = document.getElementById('messages');
    messagesDiv.innerHTML += `<div class="system-message"><strong>system:</strong> ${message}</div>`;
  }, 100);
}


function isValidCommand(message) {
  const validCommandPatterns = [
    /^\/ban user \S+$/,          // Match "/ban user <username>"
    /^\/ban p user \S+.*$/,      // Match "/ban p user <username> "message""
    /^\/time-date$/              // Match "/time-date"
  ];

  return validCommandPatterns.some(pattern => pattern.test(message));
}


function isBanCommand(message) {
  const banCommandPattern = /^\/ban user \S+$/;
  return banCommandPattern.test(message);
}


document.addEventListener('DOMContentLoaded', (event) => {
  const rememberedUsername = localStorage.getItem('username');
  if (rememberedUsername) {
    document.getElementById('login-username').value = rememberedUsername;
  }
  checkSession();
});

function checkSession() {
  fetch('/session', {
    method: 'GET',
    credentials: 'include'
  })
  .then(response => response.json())
  .then(data => {
    if (data.username) {
      username = data.username;
      startWebSocket();
      document.getElementById('login').style.display = 'none';
      document.getElementById('chat').style.display = 'block';
      document.getElementById('current-user').innerText = `Logged in as: ${username}`;
    } else {
      localStorage.removeItem('username');
    }
  })
  .catch(error => {
    console.error('Error:', error);
    localStorage.removeItem('username');
  });
}

function signup() {
  const username = document.getElementById('signup-username').value;
  const password = document.getElementById('signup-password').value;
  
  fetch('/signup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username, password })
  })
  .then(response => response.json())
  .then(data => {
    if (data.message === 'User created successfully') {
      triggerConfetti();
      setTimeout(() => {
        alert('Signup successful! Please login.');
      }, 500);
      document.getElementById('signup').style.display = 'none';
      document.getElementById('login').style.display = 'block';
    } else {
      alert(data.message);
    }
  })
  .catch(error => console.error('Error:', error));
}

function triggerConfetti() {
  confetti({
    particleCount: 1000,
    spread: 200,
    origin: { y: 0.6 }
  });
}

function login() {
  username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const doNotRememberMe = document.getElementById('do-not-remember-me').checked;
  
  fetch('/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username, password }),
    credentials: 'include'
  })
  .then(response => response.json())
  .then(data => {
    if (data.message === 'Login successful') {
      if (!doNotRememberMe) {
        localStorage.setItem('username', username);
      } else {
        localStorage.removeItem('username');
      }
      startWebSocket();
      document.getElementById('login').style.display = 'none';
      document.getElementById('chat').style.display = 'block';
      document.getElementById('current-user').innerText = `Logged in as: ${username}`;
    } else {
      alert(data.message);
    }
  })
  .catch(error => console.error('Error:', error));
}

function startWebSocket() {
  socket = new WebSocket('ws://turbochat.com:1010');
  
  socket.onopen = () => {
    console.log('WebSocket connection opened');
    socket.send(JSON.stringify({ type: 'login', name: username }));
  };

socket.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === 'error') {
    handleErrorMessage(msg.message);
  } else if (msg.type === 'updateUsers') {
    onlineUsers = new Set(msg.users);
    updateOnlineUsers(msg.users);
  } else if (msg.type === 'typing' && msg.to === username) {
    showTypingIndicator(msg.from);
  } else if (msg.type === 'stopTyping' && msg.to === username) {
    hideTypingIndicator();
  } else if (msg.type === 'banned') {
    alert(`${msg.adminName} has banned you. Please log in again.`);
    logout();
  } else {
    // Handle chat messages
    const messagesDiv = document.getElementById('messages');
    const adminPrefix = msg.isAdmin ? '[Admin] ' : '';
    const messageClass = msg.isAdmin ? 'admin-message' : 'user-message';
    messagesDiv.innerHTML += `<div class="${messageClass}"><strong>${adminPrefix}${msg.from} to ${msg.to}:</strong> ${msg.message}</div>`;
  }
};
socket.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === 'error') {
    handleErrorMessage(msg.message);
  } else if (msg.type === 'updateUsers') {
    onlineUsers = new Set(msg.users);
    updateOnlineUsers(msg.users);
  } else if (msg.type === 'typing' && msg.to === username) {
    showTypingIndicator(msg.from);
  } else if (msg.type === 'stopTyping' && msg.to === username) {
    hideTypingIndicator();
  } else if (msg.type === 'banned') {
    alert(`${msg.adminName} has banned you. Please log in again.`);
    logout();
  } else if (msg.type === 'permanentBan') {
    showPermanentBanMessage(msg.adminName, msg.adminMessage);
    logout();
  } else {
    // Handle chat messages
    const messagesDiv = document.getElementById('messages');
    const adminPrefix = msg.isAdmin ? '[Admin] ' : '';
    const messageClass = msg.isAdmin ? 'admin-message' : 'user-message';
    messagesDiv.innerHTML += `<div class="${messageClass}"><strong>${adminPrefix}${msg.from} to ${msg.to}:</strong> ${msg.message}</div>`;
  }
};

function showPermanentBanMessage(adminName, adminMessage) {
  let countdown = 5;

  // Create the overlay
  const overlay = document.createElement('div');
  overlay.id = 'ban-overlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)'; // Semi-transparent background
  overlay.style.zIndex = '999'; // Lower than the ban message

  // Create the ban message
  const banMessage = document.createElement('div');
  banMessage.id = 'ban-message';
  banMessage.style.position = 'fixed';
  banMessage.style.top = '50%';
  banMessage.style.left = '50%';
  banMessage.style.transform = 'translate(-50%, -50%)';
  banMessage.style.backgroundColor = 'red';
  banMessage.style.padding = '20px';
  banMessage.style.color = 'white';
  banMessage.style.fontSize = '20px';
  banMessage.style.textAlign = 'center';
  banMessage.style.zIndex = '1000'; // Higher than the overlay

  // Function to update the ban message with the countdown
  function updateBanMessage() {
    if (countdown > 0) {
      banMessage.innerHTML = `ERROR<br>${adminName} has banned you permanently.<br>${adminMessage}<br>Please wait ${countdown} seconds and then sign up again.<br><br><br><br><br>`;
      countdown--;
    } else {
      document.body.removeChild(banMessage);
      document.body.removeChild(overlay);
    }
  }

  // Append overlay and ban message to the body
  document.body.appendChild(overlay);
  document.body.appendChild(banMessage);

  updateBanMessage();
  const countdownInterval = setInterval(() => {
    if (countdown >= 0) {
      updateBanMessage();
    } else {
      clearInterval(countdownInterval);
    }
  }, 1000);
}



  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  socket.onclose = () => {
    console.log('WebSocket connection closed');
    clearSessionData();
  };
}

function updateOnlineUsers(users) {
  const onlineUsersList = document.getElementById('online-users');
  onlineUsersList.innerHTML = '';
  users.forEach(user => {
    const userItem = document.createElement('li');
    userItem.textContent = user;
    if (username === 'huyckkid14' && user !== 'huyckkid14') {
      const banButton = document.createElement('button');
      banButton.textContent = 'Ban';
      banButton.onclick = () => banUser(user);
      userItem.appendChild(banButton);
    }
    onlineUsersList.appendChild(userItem);
  });
}
function banUser(userToBan) {
  if (confirm(`Are you sure you want to ban ${userToBan}?`)) {
    socket.send(JSON.stringify({ type: 'ban', user: userToBan }));
  }
}

function logout() {
  fetch('/logout', {
    method: 'POST',
    credentials: 'include'
  })
  .then(response => response.json())
  .then(data => {
    if (data.message === 'Logout successful') {
      clearSessionData();
    } else {
      alert('Logout failed');
    }
  })
  .catch(error => {
    console.error('Error:', error);
    clearSessionData();
  });
}

function clearSessionData() {
  if (socket) {
    socket.close();
  }
  localStorage.removeItem('username');
  document.getElementById('chat').style.display = 'none';
  document.getElementById('login').style.display = 'block';
  document.getElementById('current-user').innerText = '';
}

document.getElementById('message').addEventListener('input', () => {
  const to = document.getElementById('to').value;
  
  // Clear any existing timeouts
  if (typingTimeout) clearTimeout(typingTimeout);
  
  // If typing indicator isn't shown, show it immediately
  if (!typingInterval) {
    socket.send(JSON.stringify({ type: 'typing', from: username, to: to }));
    showTypingIndicator(username);
  }
  
  // Set a new timeout
  typingTimeout = setTimeout(() => {
    socket.send(JSON.stringify({ type: 'stopTyping', from: username, to: to }));
    hideTypingIndicator();
  }, 1000);
});

function showTypingIndicator(user) {
  const typingIndicator = document.getElementById('typing-indicator');
  typingIndicator.style.display = 'block';
  let dots = 0;

  // Clear any existing interval
  if (typingInterval) clearInterval(typingInterval);

  // Create a new interval to cycle the dots
  typingInterval = setInterval(() => {
    dots = (dots + 1) % 4; // Cycle through 0, 1, 2, 3
    typingIndicator.innerText = `${user} is typing${'.'.repeat(dots)}`;
  }, 300);
}

function hideTypingIndicator() {
  const typingIndicator = document.getElementById('typing-indicator');
  typingIndicator.style.display = 'none';
  if (typingInterval) {
    clearInterval(typingInterval);
    typingInterval = null;
  }
}

function showSignup() {
  document.getElementById('login').style.display = 'none';
  document.getElementById('signup').style.display = 'block';
}

function showLogin() {
  document.getElementById('signup').style.display = 'none';
  document.getElementById('login').style.display = 'block';
}