const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: ["https://blackboard-ix875cva3-mrmightys-projects.vercel.app", "http://localhost:5173"],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  },
});

const corsOptions = {
  origin: ["https://blackboard-ix875cva3-mrmightys-projects.vercel.app", "http://localhost:5173"],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));

app.get("/", (req, res) => {
  res.json({ message: "Server Deployed" });
});

const rooms = new Map();
const drawings = {}; // Track drawings per room
const chatMessages = {}; // Track chat messages per room
const undoStacks = {}; // Undo stacks for drawings per room
const redoStacks = {}; // Redo stacks for drawings per room

io.on("connection", (socket) => {
  console.log("a user connected");

  // Event: Joining a room
  socket.on("group", (roomId, callback) => {
    socket.join(roomId);
    console.log(`User joined room: ${roomId}`);

    socket.emit("handshake", `${roomId} joined`);

    const roomClients = io.sockets.adapter.rooms.get(roomId);
    console.log(`Room ${roomId} has ${roomClients.size} clients`);
    callback(`Room ${roomId} has ${roomClients.size} clients`);

    // Initialize drawings and chat messages if they exist for the room
    if (drawings[roomId]) {
      socket.emit("initDrawing", drawings[roomId]);
    }
    if (chatMessages[roomId]) {
      socket.emit("initChat", chatMessages[roomId]);
    }
  });

  // Event: Connecting to chat
  socket.on("chatConnect", ({ username, roomId, id }) => {
    console.log({ username, roomId, id });
    socket.join(roomId);

    // Initialize or update chat messages for the room
    if (!chatMessages[roomId]) {
      chatMessages[roomId] = [];
    }
    socket.emit("initChat", chatMessages[roomId]);
  });

  // Event: Creating a room
  socket.on("createRoom", (data, callback) => {
    console.log({ roomId: data.roomId, password: data.password });
    if (!rooms.has(data.roomId)) {
      rooms.set(data.roomId, {
        password: data.password,
        participants: new Set([socket.id, data.username]),
        drawings: [], // Initialize drawings array for the room
      });
      undoStacks[data.roomId] = []; // Initialize undo stack for the room
      redoStacks[data.roomId] = []; // Initialize redo stack for the room
      socket.join(data.roomId);
      console.log("create", socket.rooms);
      socket.emit("roomCreated", data.roomId);
      console.log(`Room ${data.roomId} created`);
      callback(data.roomId);
    } else {
      callback("Room already exists");
    }
  });

  // Event: Joining a room
  socket.on("joinRoom", (data, callback) => {
    console.log({ roomId: data.roomId, password: data.password });
    const roomData = rooms.get(data.roomId);
    console.log(roomData);
    if (roomData && roomData.password === data.password) {
      roomData.participants.add(socket.id);
      roomData.participants.add(data.username);

      socket.join(data.roomId);
      console.log("join", socket.rooms);
      socket.emit("roomJoined", data.roomId);
      console.log(`User joined room ${data.roomId}`);

      // Initialize drawings and chat messages if they exist for the room
      if (drawings[data.roomId]) {
        socket.emit("initDrawing", drawings[data.roomId]);
      }
      if (chatMessages[data.roomId]) {
        socket.emit("initChat", chatMessages[data.roomId]);
      }

      callback({ id: data.roomId, ...roomData });
    } else {
      callback("Invalid room ID or password");
      console.log(roomData);
    }
  });

  // Event: Starting a new line
  socket.on("startLine", (data) => {
    const { roomId, color, strokeWidth } = data;
    if (!drawings[roomId]) {
      drawings[roomId] = [];
    }
    const lineId = generateLineId(); // Function to generate a unique line ID
    drawings[roomId].push({
      lineId,
      points: [],
      color,
      strokeWidth,
    });
    undoStacks[roomId].push([...drawings[roomId]]);
    redoStacks[roomId] = [];
    socket.to(roomId).emit("startLine", { ...data, lineId });
  });

  // Event: Handling drawing updates (lines and shapes)
  socket.on("drawing", (data) => {
    const { roomId, points } = data;

    // Handle lines
    if (!drawings[roomId]) {
      drawings[roomId] = [];
    }

    // Find the last drawn line and update it
    const lastLineIndex = drawings[roomId].length - 1;
    if (lastLineIndex >= 0) {
      drawings[roomId][lastLineIndex].points.push(...points);
    }

    // Emit "drawing" event to all clients in the room
    socket.to(roomId).emit("drawing", data);
  });

  // Event: Undoing drawing actions
  socket.on("undo", (roomId) => {
    if (undoStacks[roomId] && undoStacks[roomId].length > 0) {
      const lastState = undoStacks[roomId].pop();
      redoStacks[roomId].push([...drawings[roomId]]);
      drawings[roomId] = lastState || [];
      io.to(roomId).emit("drawingUpdate", drawings[roomId]);
    }
  });

  // Event: Redoing drawing actions
  socket.on("redo", (roomId) => {
    if (redoStacks[roomId] && redoStacks[roomId].length > 0) {
      const lastState = redoStacks[roomId].pop();
      undoStacks[roomId].push([...drawings[roomId]]);
      drawings[roomId] = lastState || [];
      io.to(roomId).emit("drawingUpdate", drawings[roomId]);
    }
  });

  // Event: Sending chat messages
  socket.on("chatMessage", (data) => {
    const { username, message, roomId } = data;
    console.log("log", chatMessages);
    console.log("message on server", data);
    if (message.trim()) {
      if (!chatMessages[roomId]) {
        chatMessages[roomId] = [];
      }
      chatMessages[roomId].push({ username, message });
      io.to(roomId).emit("chatMessage", { username, message });
    }
  });

  // Event: Handling disconnection
  socket.on("disconnect", () => {
    console.log("user disconnected");
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;
