// This is the main server logic for the signaling service.

const WebSocket = require('ws');
const express = require('express');
const http = require('http');

// Production-level logging utility
const Logger = {
  levels: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
  },
  currentLevel: 1, // INFO level by default
  
  formatMessage(level, component, message, data = null) {
    const timestamp = new Date().toISOString();
    const logLevel = Object.keys(this.levels)[level];
    
    // Get function call information
    const stack = new Error().stack;
    const caller = this.getCallerInfo(stack);
    
    const prefix = `[${timestamp}] [${logLevel}] [${component}] [${caller}]`;
    
    if (data) {
      return [`${prefix} ${message}`, data];
    }
    return [`${prefix} ${message}`];
  },
  
  getCallerInfo(stack) {
    try {
      const lines = stack.split('\n');
      if (lines.length >= 4) {
        const callerLine = lines[3];
        const match = callerLine.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
        if (match) {
          const functionName = match[1];
          const filePath = match[2];
          const lineNumber = match[3];
          
          const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
          
          return `${functionName}@${fileName}:${lineNumber}`;
        }
      }
      return 'unknown';
    } catch (error) {
      return 'unknown';
    }
  },
  
  debug(component, message, data = null) {
    if (this.currentLevel <= this.levels.DEBUG) {
      console.debug(...this.formatMessage(this.levels.DEBUG, component, message, data));
    }
  },
  
  info(component, message, data = null) {
    if (this.currentLevel <= this.levels.INFO) {
      console.info(...this.formatMessage(this.levels.INFO, component, message, data));
    }
  },
  
  warn(component, message, data = null) {
    if (this.currentLevel <= this.levels.WARN) {
      console.warn(...this.formatMessage(this.levels.WARN, component, message, data));
    }
  },
  
  error(component, message, error = null, data = null) {
    if (this.currentLevel <= this.levels.ERROR) {
      console.error(...this.formatMessage(this.levels.ERROR, component, message, data));
      if (error) {
        console.error('Error details:', error);
        console.error('Error stack:', error.stack);
      }
    }
  }
};

const ServerState = {
  startTime: new Date().toISOString(),
  totalConnections: 0,
  activeConnections: 0,
  totalMessages: 0,
  totalErrors: 0,
  clients: new Map(),
  sfus: new Map(),
  
  updateStats(type, value = 1) {
    switch(type) {
      case 'connection':
        this.totalConnections += value;
        this.activeConnections += value;
        break;
      case 'disconnection':
        this.activeConnections = Math.max(0, this.activeConnections - value);
        break;
      case 'message':
        this.totalMessages += value;
        break;
      case 'error':
        this.totalErrors += value;
        break;
    }
  },
  
  getStats() {
    return {
      startTime: this.startTime,
      uptime: Date.now() - new Date(this.startTime).getTime(),
      totalConnections: this.totalConnections,
      activeConnections: this.activeConnections,
      totalMessages: this.totalMessages,
      totalErrors: this.totalErrors,
      clientsCount: this.clients.size,
      sfusCount: this.sfus.size
    };
  }
};

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

Logger.info('SERVER', 'Signaling server initializing', {
  port: process.env.PORT || 8080,
  nodeVersion: process.version,
  platform: process.platform,
  pid: process.pid
});

const redis = require('../utils/datamanagement/redis');

const { MeetingsConsumer, safeKafkaSend, setSFUCommandHandler, checkKafkaHealth } = require('./utils/communication');
const { AddSignalingServerToRedis, RegisterClientSfu, ClientJoinsMeeting, ClientLeavesMeeting, WebRTCHandler, SfuSignalToClient, WebSocketDisconnectClient, WebSocketDisconnectSfu, startHeartbeat, handleChatMessage, broadcastToMeeting } = require('./utils/signal-helpers');
const { identifyMessageSource } = require('./utils/message-identification');

// Store WebSocket connections (clients and SFUs)
const clients = new Map(); 
const sfus = new Map();    

// Update global state references
ServerState.clients = clients;
ServerState.sfus = sfus;

// Start heartbeat interval
Logger.info('HEARTBEAT', 'Starting heartbeat system');
const heartbeatInterval = startHeartbeat(clients);



// Set up SFU command handler for Kafka messages
setSFUCommandHandler((sfuCommand) => {
  const sourceInfo = identifyMessageSource(sfuCommand.payload?.senderId);
  Logger.info('KAFKA', 'Handling SFU command from Kafka', {
    commandType: sfuCommand.type,
    hasPayload: !!sfuCommand.payload,
    sourceInfo: sourceInfo
  });
  
  if (sfuCommand.type === 'sfuSignalToClient') {
    const targetInfo = identifyMessageSource(sfuCommand.payload?.targetClientId);
    Logger.info('KAFKA', 'Processing SFU signal to client', {
      sourceType: 'sfu',
      targetInfo: targetInfo,
      signalType: sfuCommand.payload?.signalType,
      meetingId: sfuCommand.payload?.meetingId
    });
    SfuSignalToClient(sfuCommand.payload, clients);
  } else if (sfuCommand.type === 'webrtcSignal') {
    Logger.info('KAFKA', 'Processing WebRTC signal from client to SFU', {
      sourceInfo: sourceInfo,
      signalType: sfuCommand.payload.type,
      meetingId: sfuCommand.payload.meetingId
    });
    

    Logger.debug('KAFKA', 'WebRTC signal forwarded to SFU via Kafka', {
      sourceInfo: sourceInfo,
      signalType: sfuCommand.payload.type,
      meetingId: sfuCommand.payload.meetingId
    });
  } else if (sfuCommand.type === 'meetingEvent') {
    const { meetingId, eventType, eventData } = sfuCommand.payload;
    
    Logger.info('KAFKA', 'Processing meeting event from SFU', {
      meetingId,
      eventType,
      eventData
    });
    
    broadcastToMeeting(meetingId, null, {
      type: 'meetingEvent',
      payload: {
        type: eventType,
        payload: eventData
      }
    }, clients);
    
    Logger.debug('KAFKA', 'Meeting event broadcasted to clients', {
      meetingId,
      eventType,
      clientsCount: clients.size
    });
  } else if (sfuCommand.type === 'prepareMeeting') {
    Logger.info('KAFKA', 'Processing prepare meeting command', sfuCommand.payload);
  } else {
    Logger.warn('KAFKA', 'Unknown SFU command type', {
      commandType: sfuCommand.type,
      payload: sfuCommand.payload
    });
  }
});

wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const timestamp = new Date().toISOString();
  const connectionId = `${ws._socket?.remoteAddress}:${ws._socket?.remotePort}`;
  
  ServerState.updateStats('connection');
  
  Logger.info('WEBSOCKET', 'New WebSocket connection established', {
    clientIP,
    userAgent,
    connectionId,
    timestamp,
    totalConnections: ServerState.totalConnections,
    activeConnections: ServerState.activeConnections
  });
  
  try {
    AddSignalingServerToRedis();
    Logger.debug('REDIS', 'Signaling server added to Redis');
  } catch (error) {
    Logger.error('REDIS', 'Failed to add signaling server to Redis', error);
  }

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      const { type, payload, senderId, targetId, meetingId } = data;

      ServerState.updateStats('message');
      
      const sourceInfo = identifyMessageSource(senderId);
      Logger.debug('MESSAGE', 'Received WebSocket message', {
        type,
        senderId,
        sourceInfo: sourceInfo,
        targetId,
        meetingId,
        messageSize: message.length,
        totalMessages: ServerState.totalMessages
      });

      // --- Handle initial registration (client or SFU) ---
      if (type === 'register') {
        Logger.info('REGISTER', 'Processing registration request', {
          id: payload.id,
          role: payload.role,
          clientIP
        });
        
        RegisterClientSfu(payload, ws, clients, sfus);
        Logger.info('REGISTER', 'Registration completed', {
          id: payload.id,
          role: payload.role,
          clientsCount: clients.size,
          sfusCount: sfus.size
        });
        return;
      }

      // Ensure senderId is present for subsequent messages
      if (!senderId) {
        ServerState.updateStats('error');
        Logger.warn('MESSAGE', 'Message received without senderId', {
          type,
          payload,
          clientIP
        });
        return;
      }

      // --- Handle meeting join/leave (from client) ---
      if (type === 'joinMeeting') {
        Logger.info('MEETING', 'Client joining meeting', {
          senderId,
          meetingId: payload.meetingId,
          clientIP
        });
        
        ClientJoinsMeeting(ws, payload, senderId, clients);
        return;
      }      

      if (type === 'leaveMeeting') {
        Logger.info('MEETING', 'Client leaving meeting', {
          senderId,
          meetingId: payload.meetingId,
          clientIP
        });
        
        ClientLeavesMeeting(payload, senderId, clients);
        return;
      }

      // --- Handle chat messages ---
      if (type === 'chat') {
        Logger.debug('CHAT', 'Processing chat message', {
          senderId,
          meetingId: payload.meetingId,
          messageLength: payload.message?.length
        });
        
        handleChatMessage(payload, senderId, clients);
        return;
      }

      // --- Handle WebRTC signaling messages ---
      if (type === 'offer' || type === 'answer' || type === 'candidate') {
        const sourceInfo = identifyMessageSource(senderId);
        Logger.debug('WEBRTC', 'Processing WebRTC signal', {
          type,
          senderId,
          sourceInfo: sourceInfo,
          meetingId,
          hasSdp: !!payload.sdp,
          hasCandidate: !!payload.candidate
        });
        
        WebRTCHandler(payload, senderId, type, meetingId);
        return;
      }

      // --- Handle SFU's responses to clients (offers/answers/candidates) ---
      if (type === 'sfuSignalToClient') {
        Logger.debug('SFU', 'Processing SFU signal to client', {
          targetClientId: payload.targetClientId,
          signalType: payload.signalType,
          meetingId: payload.meetingId
        });
        
        SfuSignalToClient(payload, clients);
        return;
      }

      // --- Handle SFU's meeting events (e.g., active speaker) ---
      if (type === 'sfuMeetingEvent') {
        const { meetingId: sfuMeetingId, eventType, eventData } = payload;
        
        Logger.info('SFU', 'Processing SFU meeting event', {
          meetingId: sfuMeetingId,
          eventType,
          eventData
        });
        
        // Publish this event to all clients in the meeting via Redis Pub/Sub
        // redis.publish(`meeting_events:${sfuMeetingId}`, JSON.stringify({
        //   type: eventType,
        //   payload: eventData
        // }));

        await safeKafkaSend('meeting-events', [
            { key: sfuMeetingId, value: JSON.stringify({ type: eventType, payload: eventData }) }
        ]);
        
        Logger.debug('SFU', 'Meeting event published to Kafka', {
          meetingId: sfuMeetingId,
          eventType
        });
        return;
      }

      Logger.warn('MESSAGE', 'Unhandled message type', {
        type,
        senderId,
        payload
      });

    } catch (e) {
      ServerState.updateStats('error');
      Logger.error('MESSAGE', 'Error processing WebSocket message', e, {
        message: message.toString(),
        clientIP,
        senderId: data?.senderId
      });
      
      try {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format.' }));
      } catch (sendError) {
        Logger.error('MESSAGE', 'Failed to send error response to client', sendError);
      }
    }
  });

  ws.on('close', async () => {
    ServerState.updateStats('disconnection');
    
    Logger.info('WEBSOCKET', 'WebSocket connection closed', {
      clientId: ws.clientId,
      sfuId: ws.sfuId,
      clientIP: ws.clientIP,
      connectedAt: ws.connectedAt,
      activeConnections: ServerState.activeConnections
    });
    
    try {
      if (ws.clientId) {
        WebSocketDisconnectClient(ws, clients);
      } else if (ws.sfuId) {
        WebSocketDisconnectSfu(ws, sfus);
      }
    } catch (error) {
      Logger.error('WEBSOCKET', 'Error during disconnect cleanup', error, {
        clientId: ws.clientId,
        sfuId: ws.sfuId
      });
    }
  });

  ws.on('error', (error) => {
    ServerState.updateStats('error');
    Logger.error('WEBSOCKET', 'WebSocket error occurred', error, {
      clientId: ws.clientId,
      sfuId: ws.sfuId,
      clientIP: ws.clientIP
    });
  });
});

// Health check endpoints
app.get('/health', async (req, res) => {
  try {
    const kafkaHealth = await checkKafkaHealth();
    const serverStats = ServerState.getStats();
    
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      server: {
        uptime: serverStats.uptime,
        activeConnections: serverStats.activeConnections,
        totalConnections: serverStats.totalConnections,
        totalMessages: serverStats.totalMessages,
        totalErrors: serverStats.totalErrors
      },
      kafka: kafkaHealth,
      redis: {
        connected: redis.status === 'ready'
      }
    };
    
    Logger.info('HEALTH', 'Health check requested', health);
    res.json(health);
  } catch (error) {
    Logger.error('HEALTH', 'Health check failed', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

app.get('/health/kafka', async (req, res) => {
  try {
    const kafkaHealth = await checkKafkaHealth();
    Logger.info('HEALTH', 'Kafka health check requested', kafkaHealth);
    res.json(kafkaHealth);
  } catch (error) {
    Logger.error('HEALTH', 'Kafka health check failed', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

app.get('/health/server', (req, res) => {
  const serverStats = ServerState.getStats();
  Logger.info('HEALTH', 'Server health check requested', serverStats);
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    ...serverStats
  });
});

// Serve static files (like your frontend HTML/JS)
app.use(express.static('public')); // Assuming your frontend files are in a 'public' directory

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  Logger.info('SERVER', 'Signaling server started successfully', {
    port: PORT,
    pid: process.pid,
    uptime: 0
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  Logger.info('SERVER', 'Shutting down signaling server...', ServerState.getStats());
  
  clearInterval(heartbeatInterval);
  wss.close(() => {
    server.close(() => {
      redis.quit();
      MeetingsConsumer.disconnect();
      Logger.info('SERVER', 'Signaling server gracefully shut down');
      process.exit(0);
    });
  });
});

// Export for debugging
module.exports = { Logger, ServerState };