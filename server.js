const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./users.db');

function deleteUser(username, callback) {
  db.run(`DELETE FROM users WHERE username = ?`, [username], function (err) {
    if (err) {
      console.error('Error deleting user from database:', err);
      callback(err);
    } else {
      console.log(`User ${username} deleted from database.`);
      callback(null);
    }
  });
}


db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )`);
});


const app = express();

// Use body-parser middleware
app.use(bodyParser.json());

// Configure session middleware
app.use(session({
  genid: () => uuidv4(),
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: {
    httpOnly: true,
    secure: false, // Set to true if using HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Simple in-memory storage for users and sessions
let users = {};
let messages = {};
const adminUsers = new Set(['huyckkid14']);

let credentials = {};

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from the "public" directory
app.use(express.static('public'));

app.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);

  db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hashedPassword], function (err) {
    if (err) {
      return res.status(400).json({ message: 'User already exists' });
    }
    return res.status(201).json({ message: 'User created successfully' });
  });
});


app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  db.get(`SELECT password FROM users WHERE username = ?`, [username], async (err, row) => {
    if (err || !row || !(await bcrypt.compare(password, row.password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    req.session.username = username;
    return res.status(200).json({ message: 'Login successful' });
  });
});


app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: 'Logout failed' });
    }
    res.clearCookie('connect.sid'); // Replace 'connect.sid' with your session cookie name if different
    return res.status(200).json({ message: 'Logout successful' });
  });
});

app.get('/session', (req, res) => {
  if (req.session.username) {
    return res.status(200).json({ username: req.session.username });
  }
  return res.status(401).json({ message: 'Not authenticated' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
const badWords = ["shit", "fuck", "ass", "stupid", "hell"];
const replacement = "CHAT";
const banThreshold = 2; // Threshold for banning users
const banDuration = 3000; // Ban duration in milliseconds (3 seconds)

const userWordCount = {}; // To track the count of inappropriate words per user
const bannedUsers = {}; // To track banned users and their unban time

function sanitizeMessage(message) {
  let sanitizedMessage = message;
  badWords.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    sanitizedMessage = sanitizedMessage.replace(regex, replacement);
  });
  return sanitizedMessage;
}

function incrementWordCount(username) {
  if (!userWordCount[username]) {
    userWordCount[username] = 0;
  }
  userWordCount[username]++;
  if (userWordCount[username] > banThreshold) {
    bannedUsers[username] = Date.now() + banDuration;
    userWordCount[username] = 0; // Reset count after ban
    return true; // Return true if the user is now banned
  }
  return false;
}

function isUserBanned(username) {
  if (!bannedUsers[username]) {
    return false;
  }
  if (Date.now() > bannedUsers[username]) {
    delete bannedUsers[username];
    return false;
  }
  return true;
}


// WebSocket handling
wss.on('connection', (ws, req) => {
  const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  console.log(`WebSocket connection from IP: ${clientIp}`);

  ws.on('message', (message) => {
    console.log('Received message:', message);

    let msg;
    try {
      msg = JSON.parse(message);
    } catch (e) {
      console.error('Error parsing message:', e);
      return;
    }

    switch (msg.type) {
      case 'login':
        console.log('User logged in:', msg.name);
        users[msg.name] = ws;
        ws.name = msg.name;

        broadcastUsers();

        if (messages[msg.name]) {
          messages[msg.name].forEach((message) => {
            ws.send(JSON.stringify(message));
          });
          delete messages[msg.name];
        }
        break;


case 'chat':
        if (isUserBanned(ws.name)) {
          ws.send(JSON.stringify({ type: 'error', message: 'You are temporarily banned from chatting.' }));
          return;
        }

        if (msg.to === 'system') {
          const parts = msg.message.match(/^\/ban p user (\S+) (.+)$/);
          if (parts && adminUsers.has(ws.name)) {
            const usernameToBan = parts[1];
            const adminMessage = parts[2];

            if (users[usernameToBan]) {
              // Ban the user
              users[usernameToBan].send(JSON.stringify({
                type: 'permanentBan',
                adminName: ws.name,
                adminMessage: adminMessage
              }));
              users[usernameToBan].close();
              delete users[usernameToBan];
              broadcastUsers();
              
              // Delete user from database
              deleteUser(usernameToBan, (err) => {
                if (err) {
                  ws.send(JSON.stringify({ type: 'error', message: `Error deleting user ${usernameToBan}.` }));
                } else {
                  // Send success message
                  const successMessage = { type: 'chat', from: 'system', message: `${usernameToBan} permanently banned and data deleted.` };
                  ws.send(JSON.stringify(successMessage));
                }
              });
            } else {
              // Send error message
              const errorMessage = { type: 'chat', from: 'system', message: `Ban Error: ${usernameToBan} is not found in the server.` };
              ws.send(JSON.stringify(errorMessage));
            }
          } else if (msg.message.startsWith('/ban user ') && adminUsers.has(ws.name)) {
            const usernameToBan = msg.message.split(' ')[2];
            if (users[usernameToBan]) {
              // Ban the user
              users[usernameToBan].send(JSON.stringify({
                type: 'banned',
                adminName: ws.name
              }));
              users[usernameToBan].close();
              delete users[usernameToBan];
              broadcastUsers();
              
              // Send success message
              const successMessage = { type: 'chat', from: 'system', message: `${usernameToBan} banned` };
              ws.send(JSON.stringify(successMessage));
            } else {
              // Send error message
              const errorMessage = { type: 'chat', from: 'system', message: `Ban Error: ${usernameToBan} is not found in the server.` };
              ws.send(JSON.stringify(errorMessage));
            }
          } else {
            // Handle other system messages like "/time-date"
            if (msg.message === "/time-date") {
              const now = new Date();
              const dateTimeString = `Date: ${now.toLocaleDateString()}, Time: ${now.toLocaleTimeString()}`;
              ws.send(JSON.stringify({ type: 'chat', from: 'system', message: dateTimeString }));
            } else {
              // Send command error message
              const errorMsg = `Command Error: ${msg.message} is not a defined command. Type "/commands" for list of commands`;
              ws.send(JSON.stringify({ type: 'chat', from: 'system', message: errorMsg }));
            }
          }
        } else {
          // Regular chat message handling
          console.log('Chat message from:', ws.name, 'to:', msg.to);
          
          let containsBadWord = badWords.some(word => new RegExp(`\\b${word}\\b`, 'gi').test(msg.message));
          
          if (containsBadWord) {
            if (incrementWordCount(ws.name)) {
              console.log(`User ${ws.name} banned for using inappropriate language.`);
              ws.send(JSON.stringify({ type: 'error', message: 'You have been temporarily banned for using inappropriate language.' }));
              return;
            }
          }
          
          const sanitizedMessage = sanitizeMessage(msg.message);
          const isAdmin = adminUsers.has(ws.name);
          const messageToSend = { 
            type: 'chat',
            from: ws.name, 
            to: msg.to,
            message: sanitizedMessage,
            isAdmin: isAdmin
          };
          
          if (users[msg.to]) {
            users[msg.to].send(JSON.stringify(messageToSend));
          } else {
            console.log('User not online:', msg.to);
            if (!messages[msg.to]) {
              messages[msg.to] = [];
            }
            messages[msg.to].push(messageToSend);
          }

          // Send the message to all admins
          adminUsers.forEach(admin => {
            if (users[admin]) {
              users[admin].send(JSON.stringify({
                type: 'chat',
                from: ws.name,
                to: msg.to,
                message: sanitizedMessage,
                isAdmin: isAdmin
              }));
            }
          });
        }
        break;




case 'ban':
  if (adminUsers.has(ws.name)) {
    const userToBan = msg.user;
    if (users[userToBan]) {
      users[userToBan].send(JSON.stringify({ 
        type: 'banned', 
        adminName: ws.name 
      }));
      users[userToBan].close();
      delete users[userToBan];
      broadcastUsers();
    }
  }
  break;case 'typing':
        console.log('Typing indicator from:', msg.from, 'to:', msg.to);
        if (users[msg.to]) {
          users[msg.to].send(JSON.stringify({ type: 'typing', from: msg.from, to: msg.to }));
        }
        break;

      case 'stopTyping':
        console.log('Stop typing indicator from:', msg.from, 'to:', msg.to);
        if (users[msg.to]) {
          users[msg.to].send(JSON.stringify({ type: 'stopTyping', from: msg.from, to: msg.to }));
        }
        break;

      default:
        console.log('Unknown message type:', msg.type);
    }
  });

  ws.on('close', () => {
    console.log('User disconnected:', ws.name);
    delete users[ws.name];
    broadcastUsers();
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

function broadcastUsers() {
  const onlineUsers = Object.keys(users);
  const message = { type: 'updateUsers', users: onlineUsers };
  Object.values(users).forEach(user => user.send(JSON.stringify(message)));
}

// 404 handler (must be the last middleware)
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// 500 error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).sendFile(path.join(__dirname, 'public', '500.html'));
});

app.get(['/privacy-policy', '/privacy-policy.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy-policy.html'));
});

app.get(['/terms-of-use', '/terms-of-use.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms-of-use.html'));
});


server.listen(1010, '0.0.0.0', () => {
  console.log('Server is listening on port 1010');
});