const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: ["https://blackboard-ix875cva3-mrmightys-projects.vercel.app","http://localhost:5173"],
    methods: ["GET"],
  },
});

app.use(cors());

app.get("/", (req, res) => {
  res.json({ message: "Server Deployed" });
});

const rooms = new Map();
const drawings = {};
const chatMessages = {};
const undoStacks = {};
const redoStacks = {};

io.on("connection", (socket) => {
  console.log("a user connected");

  socket.on("group", (roomId, callback) => {
    socket.join(roomId);
    console.log(`User joined room: ${roomId}`);

    socket.emit("handshake", `${roomId} joined`);

    const roomClients = io.sockets.adapter.rooms.get(roomId);
    console.log(`Room ${roomId} has ${roomClients.size} clients`);
    callback(`Room ${roomId} has ${roomClients.size} clients`);
    if (drawings[roomId]) {
      socket.emit("initDrawing", drawings[roomId]);
    }
    if (chatMessages[roomId]) {
      socket.emit("initChat", chatMessages[roomId]);
    }
  });

  socket.on("chatConnect", ({ username, roomId, id }) => {
    console.log({ username, roomId, id });
    socket.join(roomId);

    // Update or add user info to chatUserInfo
    if (!chatMessages[roomId]) {
      chatMessages[roomId] = [];
    }
    socket.emit("initChat", chatMessages[roomId]);
  });

  socket.on("createRoom", (data, callback) => {
    console.log({ roomId: data.roomId, password: data.password });
    if (!rooms.has(data.roomId)) {
      rooms.set(data.roomId, {
        password: data.password,
        participants: new Set([socket.id, data.username]),
        drawings: [],
      });
      undoStacks[data.roomId] = [];
      redoStacks[data.roomId] = [];
      socket.join(data.roomId);
      console.log("create", socket.rooms);
      socket.emit("roomCreated", data.roomId);
      console.log(`Room ${data.roomId} created`);
      callback(data.roomId);
    } else {
      callback("Room already exists");
    }
  });

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

  socket.on("startLine", (data) => {
    const { roomId, lineId, color, strokeWidth } = data;
    if (!drawings[roomId]) {
      drawings[roomId] = [];
    }
    drawings[roomId].push({
      lineId,
      points: [],
      color,
      strokeWidth,
    });
    undoStacks[roomId].push([...drawings[roomId]]);
    redoStacks[roomId] = [];
    socket.to(roomId).emit("startLine", data);
  });

  socket.on("drawing", (data) => {
    const { points, roomId, lineId } = data;

    console.log(data.type);
    if (data.type) {
      // Handle shapes (rectangles, circles, etc.)
      if (!drawings[roomId]) {
        drawings[roomId] = [];
      }

      // Find the shape in the drawings array and update or add it
      let shapeIndex = drawings[roomId].findIndex(
        (shape) => shape.id === data.id
      );
      if (shapeIndex !== -1) {
        // Update existing shape
        drawings[roomId][shapeIndex] = {
          ...drawings[roomId][shapeIndex],
          ...data,
        };
      } else {
        // Add new shape
        drawings[roomId].push({
          ...data,
        });
      }

      // Emit "drawing" event to all clients in the room
      socket.to(roomId).emit("drawing", data);
    } else {
      // Handle lines
      if (!drawings[roomId]) {
        drawings[roomId] = [];
      }

      // Find the line in the drawings array and update or add it
      let lineIndex = drawings[roomId].findIndex(
        (line) => line.lineId === lineId
      );
      if (lineIndex !== -1) {
        // Update existing line
        drawings[roomId][lineIndex] = {
          ...drawings[roomId][lineIndex],
          points: [...drawings[roomId][lineIndex].points, ...points],
        };
      } else {
        // Add new line
        drawings[roomId].push({
          lineId,
          points,
          color: data.color,
          strokeWidth: data.strokeWidth,
        });
      }

      // Emit "drawing" event to all clients in the room
      socket.to(roomId).emit("drawing", data);
    }
  });

  socket.on("undo", (roomId) => {
    if (undoStacks[roomId] && undoStacks[roomId].length > 0) {
      const lastState = undoStacks[roomId].pop();
      redoStacks[roomId].push([...drawings[roomId]]);
      drawings[roomId] = lastState || [];
      io.to(roomId).emit("drawingUpdate", drawings[roomId]);
    }
  });

  socket.on("redo", (roomId) => {
    if (redoStacks[roomId] && redoStacks[roomId].length > 0) {
      const lastState = redoStacks[roomId].pop();
      undoStacks[roomId].push([...drawings[roomId]]);
      drawings[roomId] = lastState || [];
      io.to(roomId).emit("drawingUpdate", drawings[roomId]);
    }
  });

  socket.on("chatMessage", (data) => {
    const { username, message, roomId } = data;
    console.log("log", chatMessages);
    console.log("message on server", data);
    if (message.trim()) {
      console.log("message on server", data);
      if (!chatMessages[roomId]) {
        chatMessages[roomId] = [];
      }
      chatMessages[roomId].push({ username, message });
      io.to(roomId).emit("chatMessage", { username, message });
    }
  });

  socket.on("disconnect", () => {
    console.log("user disconnected");
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;
