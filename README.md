# ThinkTogether - AI-Powered Video Conferencing Platform

A scalable video conferencing application with integrated AI assistant capabilities, built with a microservices architecture using WebRTC, Docker, Redis, Kafka, and real-time multimodal AI processing.

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Key Components](#key-components)
- [Data Flow & Script Interactions](#data-flow--script-interactions)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Setup & Installation](#setup--installation)
- [Running the Application](#running-the-application)
- [Component Details](#component-details)
- [Communication Patterns](#communication-patterns)
- [Development Guide](#development-guide)

## Overview

ThinkTogether is a production-ready video conferencing platform designed to provide AI-powered meeting assistance without premium subscription requirements. The system features:

- **Real-time video/audio communication** via WebRTC with SFU architecture
- **Scalable microservices** architecture with Docker containerization
- **Integrated AI pipeline** for multimodal processing (audio, video, screen content)
- **Enterprise-grade infrastructure** with Redis clustering and Kafka event streaming
- **Cross-platform desktop application** built with Electron

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         Electron Desktop Application                      │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │  │
│  │  │   Media      │  │   WebRTC     │  │  Signaling   │  │  │
│  │  │  Manager     │  │   Manager    │  │   Manager    │  │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS/WSS
                            │
┌───────────────────────────┴─────────────────────────────────────┐
│                    ORCHESTRATION LAYER                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │       Orchestration Service (Node.js - Port 8081)        │  │
│  │  • Meeting creation/joining                              │  │
│  │  • Resource assignment (SFU + Signaling Server)          │  │
│  │  • Authentication & authorization                        │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┴───────────────────┐
        │                                       │
┌───────┴────────┐                    ┌─────────┴────────┐
│  SIGNALING     │                    │   SFU (Go)       │
│  SERVERS       │                    │   Port 8090      │
│  Port 8080     │                    │                  │
│  (Node.js)     │                    │  • WebRTC media  │
│                │                    │    routing       │
│  • WebSocket   │◄────Kafka─────────►│  • Track         │
│    signaling   │                    │    management    │
│  • Client/SFU  │                    │  • ICE handling  │
│    registry    │                    └──────────────────┘
└───────┬────────┘
        │
┌───────┴────────────────────────────────────────────────────────┐
│                    INFRASTRUCTURE LAYER                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ Redis        │  │ Kafka        │  │ PostgreSQL/  │        │
│  │ Cluster      │  │ Cluster      │  │ Supabase     │        │
│  │ (6 nodes)    │  │ (3 brokers)  │  │              │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
└────────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────────────┐
│                    AI PIPELINE LAYER                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Conversational AI Pipeline (Python)                     │  │
│  │  • Audio processing (Whisper, VAD)                       │  │
│  │  • Video processing (MediaPipe, CV)                      │  │
│  │  • LLM integration (GPT-4)                               │  │
│  │  • Multimodal context fusion                             │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Client Application (Electron)
**Location:** `client-electronapp/`

The desktop client built with Electron provides the user interface and handles:
- **Media Management** (`modules/media.js`): 
  - Camera, microphone, screen capture via getUserMedia
  - Stream initialization and management
  - Toggle audio/video/screen sharing
- **WebRTC Management** (`modules/webrtc.js`): 
  - RTCPeerConnection creation and management
  - ICE candidate gathering and exchange
  - SDP offer/answer handling
  - Remote track reception and buffering
- **Signaling Management** (`modules/signaling.js`): 
  - WebSocket connection to signaling servers
  - Message sending/receiving (offer, answer, candidate, chat)
  - Client registration and meeting join/leave
- **State Management** (`modules/state.js`): 
  - Application state tracking (connection states, user info, meeting info)
  - Session storage integration
- **Participants Management** (`modules/participants.js`): 
  - Remote video element creation and management
  - Participant list management
  - Video grid layout updates
- **Chat Management** (`modules/chat.js`): 
  - Real-time messaging interface
  - Message sending/receiving
  - Chat history management
- **Logging** (`modules/logger.js`): Structured logging utility
- **Utils** (`modules/utils.js`): Helper functions

**Entry Points:**
- `meeting/meeting-sfu-new.js` - **Main orchestrator (NEW modular architecture)** - Initializes managers, sets up callbacks, handles signaling messages
- `meeting/meeting-sfu.js` - Alternative/legacy implementation
- `preload.js` - Electron preload script for secure IPC (screen sources API)
- `main.js` (root) - Electron main process, creates BrowserWindow

### 2. Orchestration Service
**Location:** `server/index.js`, `server/routes/meeting.js`, `server/routes/auth.js`

The main API server (Node.js/Express) that:
- Handles HTTP requests for authentication, meeting creation/joining
- Assigns SFU and signaling server resources based on load
- Manages JWT authentication and authorization middleware
- Stores meeting metadata in Redis and PostgreSQL/Supabase
- Sends Kafka commands to prepare meetings

**Key Routes:**
- **Authentication** (`/auth`):
  - `POST /auth/signup` - User registration with profile picture upload
  - `POST /auth/login` - User login with JWT token generation
  - `POST /auth/reset` - Password reset functionality
- **Meeting** (`/meeting` - protected):
  - `POST /meeting/create` - Create new meeting, assign resources
  - `POST /meeting/join` - Join existing meeting, get assigned resources
- Resource assignment via `assignMeetingResources()` in `routes/meeting.js`
- Load balancing via `findBestSfu()` and `findBestSignalingServer()` in `utils/meetings/meetings-helpers.js`

### 3. Signaling Servers
**Location:** `server/signaling/signal-server.js`

Node.js WebSocket servers that:
- Maintain WebSocket connections with clients and SFUs
- Route WebRTC signaling messages (offer/answer/candidate) between clients and SFUs
- Use Kafka for message passing to SFUs
- Handle client registration and meeting join/leave events
- Broadcast meeting events to participants

**Key Features:**
- Multiple signaling server instances for load balancing
- Heartbeat system for health monitoring
- Redis pub/sub for cross-instance communication
- Kafka integration for SFU communication

### 4. SFU (Selective Forwarding Unit)
**Location:** `server/ion_sfu/` (Go implementation)

High-performance media server built with Go that:
- Routes WebRTC media streams (video/audio) between clients
- Manages peer connections for each client
- Handles track addition/removal and renegotiation
- Connects to signaling server via WebSocket
- Listens to Kafka commands for meeting preparation

**Key Files:**
- `main.go` - Entry point, initialization, Kafka listener
- `webrtc.go` - Peer connection setup, track management
- `handlers.go` - Command handling from Kafka
- `websocket.go` - Signaling server connection
- `kafka_consumer.go` - Kafka message consumption
- `kafka_producer.go` - Kafka message production

### 5. AI Pipeline
**Location:** `conversational-ai-pipeline/`

Python-based multimodal AI processing system with LangChain integration:
- **Audio Processing**: 
  - OpenAI Whisper for speech-to-text
  - VAD (Voice Activity Detection) using WebRTC VAD
  - Audio recording at 16kHz (mediasources.py)
- **Video Processing**: 
  - MediaPipe for face, pose, and hand tracking
  - Computer vision models for emotion detection
  - Camera recording at 640x480@30fps
- **Screen Processing**: 
  - Screen capture at 1920x1080@30fps
  - Pix2Struct for screen content understanding
  - Llava-Next for screen analysis
- **LLM Integration**: 
  - LangChain agents for conversational AI (langchain/agent.py)
  - GPT-4 for context-aware responses
  - Memory systems with embeddings (FAISS/Chroma)
  - Multimodal message preparation (text + images + videos)
- **Recording Management**: 
  - RecordingManager coordinates audio, camera, and screen recording
  - Threaded recording for concurrent capture
  - Tkinter dashboard for live preview and visualization

**Key Files:**
- `main.py` - Recording dashboard with visual interface
- `mediasources.py` - AudioRecorder, CameraRecorder, ScreenRecorder classes
- `langchain/agent.py` - ConversationalAgent with multimodal support
- `langchain/vision_tools.py` - Video and screen analysis tools
- `models/Audio/` - Audio processing models (Whisper, VAD, TTS)
- `models/ScreenRecord/` - Screen analysis models (Pix2Struct, Llava-Next)

### 6. Infrastructure

#### Redis Clusters
- **Main Redis Cluster** (6 nodes, ports 6379-6384): Session management, signaling server registry, meeting metadata
- **SFU Redis Cluster** (6 nodes, ports 6385-6390): SFU registry, metrics, health monitoring

#### Kafka Cluster
- 3 brokers (ports 9092-9094) with Zookeeper coordination
- Topics:
  - `sfu_commands` - Commands from orchestration/signaling to SFUs
  - `meeting-events` - Meeting events broadcast

## Data Flow & Script Interactions

### Meeting Creation Flow

```
1. Client → Orchestration Service
   POST /meeting/create
   { meetingName, userId (from JWT) }

2. Orchestration Service
   ├─> Creates meeting in Supabase database
   ├─> Queries Redis for available SFUs
   ├─> Calls findBestSfu() - selects SFU with lowest load
   ├─> Calls findBestSignalingServer() - selects signaling server with lowest load
   ├─> Stores assignments in Redis (meeting:{id}:metadata)
   └─> Sends Kafka message to 'sfu_commands' topic
       { type: 'prepareMeeting', payload: { meetingId, sfuId } }

3. SFU (Kafka Consumer)
   ├─> Receives prepareMeeting command
   ├─> Creates meeting structure
   └─> Registers meeting in internal state

4. Orchestration Service → Client
   Returns: { meetingID, meetingCode, sfu, signalingServer }

5. Client stores signalingServer URL in sessionStorage
```

### Client Connection Flow

```
1. Client Initialization (meeting-sfu-new.js)
   ├─> Initialize MediaManager
   ├─> Initialize WebRTCManager
   ├─> Initialize SignalingManager (with URL from sessionStorage)
   ├─> Initialize ParticipantsManager
   └─> Initialize ChatManager

2. Media Acquisition
   MediaManager.initializeVideoStreams()
   └─> getUserMedia() → Local stream ready

3. Signaling Connection
   SignalingManager.connect()
   └─> WebSocket to signalingServer URL
       ├─> onopen: Register client + Join meeting
       │   └─> SignalingManager.register(userId, 'client')
       │   └─> SignalingManager.joinMeeting(meetingId)
       └─> Signaling server receives register + joinMeeting

4. Signaling Server (signal-server.js)
   ├─> RegisterClientSfu() - stores WebSocket in clients Map
   ├─> ClientJoinsMeeting() - adds client to meeting, broadcasts to others
   └─> Sends 'meetingJoined' confirmation to client

5. Client Receives meetingJoined
   └─> WebRTCManager.createPeerConnection(localStream)
       ├─> Creates RTCPeerConnection
       ├─> Adds local tracks
       ├─> Sets up event handlers (onicecandidate, ontrack, etc.)
       └─> onnegotiationneeded fires → Creates offer

6. Client Creates Offer
   ├─> WebRTCManager.createOffer()
   ├─> SignalingManager.sendOffer(sdp)
   └─> WebSocket message to signaling server

7. Signaling Server Routes to SFU
   ├─> WebRTCHandler() receives offer
   ├─> Gets meeting's SFU ID from Redis
   └─> Sends to Kafka topic 'sfu_commands'
       { type: 'webrtcSignal', payload: { type: 'offer', sdp, senderId, meetingId } }

8. SFU Receives Offer (handlers.go)
   ├─> handleWebRTCSignal() processes the offer
   ├─> waitForPeerConnection() - waits for peer connection setup
   ├─> Sets remote description
   ├─> Creates answer
   └─> Sends answer via Kafka → Signaling Server → Client

9. ICE Candidate Exchange
   Client → Signaling Server → Kafka → SFU
   SFU → Kafka → Signaling Server → Client
   (Bidirectional flow)

10. Media Flow Established
    Client ↔ SFU (Direct WebRTC connection)
    ├─> Client sends video/audio tracks
    ├─> SFU receives tracks, creates trackLocals
    ├─> SFU forwards tracks to other clients in meeting
    └─> Clients receive remote tracks via ontrack event
```

### Script Interaction Summary

| Component | Entry Script | Key Responsibilities | Communicates With |
|-----------|-------------|---------------------|-------------------|
| **Client** | `meeting-sfu-new.js` | UI orchestration, manager coordination | Signaling Server (WebSocket) |
| **Media Manager** | `modules/media.js` | Camera/mic/screen capture | Client orchestrator |
| **WebRTC Manager** | `modules/webrtc.js` | Peer connection, SDP, ICE | Signaling Manager |
| **Signaling Manager** | `modules/signaling.js` | WebSocket communication | Signaling Server |
| **Orchestration** | `server/index.js` | HTTP API, resource assignment | Redis, Kafka, Supabase |
| **Signaling Server** | `server/signaling/signal-server.js` | WebSocket routing, message forwarding | Clients, Kafka, Redis |
| **SFU** | `server/ion_sfu/main.go` | Media routing, WebRTC handling | Signaling Server (WebSocket + Kafka) |
| **AI Pipeline** | `conversational-ai-pipeline/main.py` | Multimodal processing | (Independent/optional) |

## Technology Stack

### Frontend
- **Electron** - Cross-platform desktop framework
- **WebRTC API** - Real-time communication
- **JavaScript (ES6+)** - Client-side logic
- **Tailwind CSS** - Styling framework

### Backend
- **Node.js + Express** - API and signaling servers
- **Go (ion-sfu)** - High-performance SFU implementation
- **Python** - AI/ML pipeline
- **WebSocket (ws)** - Real-time bidirectional communication

### Infrastructure
- **Docker + Docker Compose** - Containerization and orchestration
- **Redis Cluster** - Distributed caching and pub/sub
- **Apache Kafka** - Event streaming platform
- **Zookeeper** - Kafka coordination
- **PostgreSQL/Supabase** - Database

### AI/ML
- **OpenAI Whisper** - Speech-to-text
- **MediaPipe** - Computer vision (face, pose, hands)
- **GPT-4** - Language model
- **Various CV/NLP libraries** - Processing pipelines

## Project Structure

```
VideoChat/
├── client-electronapp/          # Electron desktop application
│   ├── meeting/                 # Meeting interface
│   │   ├── meeting-sfu-new.js  # Main orchestrator (NEW modular architecture)
│   │   ├── meeting-sfu.js      # Alternative/legacy implementation
│   │   ├── modules/            # Modular components
│   │   │   ├── media.js        # Media stream management
│   │   │   ├── webrtc.js       # WebRTC connection handling
│   │   │   ├── signaling.js    # WebSocket signaling
│   │   │   ├── participants.js # Remote participant management
│   │   │   ├── chat.js         # Chat functionality
│   │   │   ├── state.js        # Application state
│   │   │   ├── logger.js       # Logging utility
│   │   │   └── utils.js        # Helper functions
│   │   ├── index.html          # Main meeting HTML
│   │   └── ...                 # Other HTML/JS files
│   ├── auth/                   # Authentication pages
│   │   ├── signin/             # Sign in pages (Google OAuth, username/password)
│   │   └── signup/             # Sign up pages
│   ├── home/                   # Home page
│   ├── preload.js              # Electron preload script (IPC security)
│   ├── helper.js               # Helper utilities
│   └── utils/                  # Client utilities
│       └── api-client.js       # API client helpers
│
├── server/                      # Backend services
│   ├── index.js                # Orchestration service entry (Express + WebSocket)
│   ├── routes/                 # API routes
│   │   ├── auth.js             # Authentication routes
│   │   │   ├── POST /signup    # User registration
│   │   │   ├── POST /login     # User login (JWT)
│   │   │   └── POST /reset     # Password reset
│   │   └── meeting.js          # Meeting management routes (protected)
│   │       ├── POST /create    # Create meeting
│   │       └── POST /join      # Join meeting
│   ├── signaling/              # Signaling server
│   │   ├── signal-server.js    # Main signaling server (WebSocket)
│   │   └── utils/              # Signaling utilities
│   │       ├── communication.js # Kafka producer/consumer
│   │       ├── signal-helpers.js # Message handlers
│   │       │   ├── WebRTCHandler()     # Routes WebRTC signals
│   │       │   ├── ClientJoinsMeeting() # Handles client joins
│   │       │   ├── SfuSignalToClient()  # Routes SFU→client signals
│   │       │   └── broadcastToMeeting() # Broadcasts messages
│   │       └── message-identification.js # Source identification
│   ├── ion_sfu/                # SFU implementation (Go)
│   │   ├── main.go             # Entry point, initialization
│   │   ├── webrtc.go           # WebRTC peer connection handling
│   │   ├── handlers.go         # Kafka command handlers
│   │   │   ├── handlePrepareMeeting()
│   │   │   ├── handleClientJoined()
│   │   │   ├── handleWebRTCSignal()
│   │   │   └── handleClientLeft()
│   │   ├── websocket.go        # Signaling server connection
│   │   ├── kafka_consumer.go   # Kafka message consumption
│   │   ├── kafka_producer.go   # Kafka message production
│   │   ├── redis.go            # Redis integration
│   │   ├── logger.go           # Structured logging
│   │   └── types.go            # Type definitions
│   ├── middleware/             # Express middleware
│   │   └── auth.js             # JWT authentication middleware
│   └── utils/                  # Server utilities
│       ├── datamanagement/     # Redis, Supabase clients
│       │   ├── redis.js        # Redis cluster connections
│       │   └── supabase.js     # Supabase client
│       ├── meetings/           # Meeting helpers
│       │   └── meetings-helpers.js # findBestSfu(), findBestSignalingServer()
│       ├── auth/               # Authentication utilities
│       │   └── encrytion.js    # JWT secret encryption
│       └── kafka-utils.js      # Kafka utilities
│
├── conversational-ai-pipeline/  # AI processing system
│   ├── main.py                 # Recording dashboard (Tkinter GUI)
│   ├── mediasources.py         # Media capture classes
│   │   ├── AudioRecorder       # Audio recording at 16kHz
│   │   ├── CameraRecorder      # Camera recording 640x480@30fps
│   │   ├── ScreenRecorder      # Screen recording 1920x1080@30fps
│   │   └── RecordingManager    # Coordinates all recorders
│   ├── MLmodels.py             # ML model integration
│   ├── pipeline.py             # Processing pipeline
│   ├── langchain/              # LangChain agent system
│   │   ├── agent.py            # ConversationalAgent with multimodal support
│   │   ├── vision_tools.py     # Video/screen analysis tools
│   │   └── model_tools.py      # Model registration and calling
│   ├── models/                 # AI models
│   │   ├── Audio/              # Audio processing
│   │   │   ├── Whisper.py      # OpenAI Whisper STT
│   │   │   ├── VAD.py          # Voice Activity Detection
│   │   │   ├── TexttoSpeech.py # TTS models
│   │   │   └── Wav2Vec2EM.py   # Emotion recognition
│   │   ├── Camera/             # Video processing (MediaPipe, etc.)
│   │   └── ScreenRecord/       # Screen analysis
│   │       ├── Pix2Struct.py   # Screen content understanding
│   │       └── Llava-Next.py   # Screen analysis
│   └── utils/                  # AI utilities
│       ├── audio_helpers.py    # Audio processing helpers
│       ├── visual_helpers.py   # Visual processing helpers
│       └── ML_helpers.py       # ML model helpers
│
├── docker-compose.yaml         # Service orchestration
├── configs/                    # Configuration files
│   └── redis/                  # Redis configurations
├── scripts/                    # Setup scripts
│   ├── setup-cluster.sh        # Redis cluster setup
│   └── setup-sfu-cluster.sh    # SFU Redis setup
└── docs/                       # Documentation
```

## Setup & Installation

### Prerequisites

- **Node.js** (v16+)
- **Docker & Docker Compose**
- **Go** (v1.19+) - For SFU development
- **Python 3.8+** - For AI pipeline
- **Git**

### Environment Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd VideoChat
   ```

2. **Install Node.js dependencies**
   ```bash
   npm install
   cd client-electronapp && npm install && cd ..
   ```

3. **Set up environment variables**
   Create a `.env` file in the root directory:
   ```env
   BACKEND_PORT=8081
   JWT_PASSPHRASE=your-secret-passphrase
   SUPABASE_URL=your-supabase-url
   SUPABASE_KEY=your-supabase-key
   REDIS_CLUSTER_NODES=redis-node-1:6379,redis-node-2:6379,...
   SIGNALING_SERVER_URLS=ws://localhost:8080
   ```

4. **Start infrastructure services**
   ```bash
   docker-compose up -d
   ```
   This starts:
   - Redis clusters (6 nodes each)
   - Kafka cluster (3 brokers + Zookeeper)
   - Orchestration service
   - Signaling server(s)
   - SFU instance(s)

5. **Verify services are running**
   ```bash
   docker-compose ps
   ```

## Running the Application

### Development Mode

1. **Start infrastructure** (if not already running)
   ```bash
   docker-compose up -d
   ```

2. **Start the Electron application**
   ```bash
   npm start
   ```
   This command:
   - Starts the orchestration service (Node.js)
   - Launches the Electron desktop app

3. **Access the application**
   - The Electron window will open automatically
   - Navigate to authentication/login
   - Create or join a meeting

### Production Mode

All services run in Docker containers:

```bash
docker-compose up -d
```

Services are accessible on:
- **Orchestration API**: `http://localhost:8081`
- **Signaling Server**: `ws://localhost:8080`
- **SFU**: `ws://localhost:8090` (internal)

## Component Details

### Client-Side Architecture

The client uses a modular architecture with separate managers:

```javascript
// meeting-sfu-new.js - Main orchestrator
initializeManagers() {
  mediaManager = new MediaManager();
  webrtcManager = new WebRTCManager();
  signalingManager = new SignalingManager();
  participantsManager = new ParticipantsManager();
  chatManager = new ChatManager();
}

setupCallbacks() {
  // Media → Signaling: Stream ready → Connect WebSocket
  mediaManager.onStreamReady → signalingManager.connect()
  
  // Signaling → WebRTC: Meeting joined → Create PeerConnection
  signalingManager.onMessage('meetingJoined') → webrtcManager.createPeerConnection()
  
  // WebRTC → Signaling: Offer/Answer/Candidate exchange
  webrtcManager.onNegotiationNeeded → signalingManager.sendOffer()
  signalingManager.onMessage('offer') → webrtcManager.handleSignalingMessage()
  
  // WebRTC → Participants: Remote track → Display video
  webrtcManager.onTrack → participantsManager.addRemoteVideo()
}
```

### Server-Side Communication

#### Orchestration Service → Signaling Server
- Direct HTTP/WebSocket (for client routing)
- Redis (for signaling server discovery)

#### Signaling Server ↔ SFU
- **WebSocket**: Direct connection for real-time signaling
- **Kafka**: Commands and WebRTC signals (offer/answer/candidate)
- **Redis**: Meeting metadata, SFU registry

#### Message Routing Pattern

```
Client → Signaling Server → Kafka → SFU
SFU → Kafka → Signaling Server → Client
```

This pattern allows:
- Horizontal scaling of signaling servers
- Decoupling of signaling from media routing
- Reliable message delivery via Kafka

## Communication Patterns

### WebRTC Signaling Flow

```
1. Client creates offer
   Client → SignalingServer (WebSocket)
   
2. Signaling routes to SFU
   SignalingServer → Kafka (sfu_commands topic)
   
3. SFU processes and creates answer
   SFU receives from Kafka → Processes → Sends answer via Kafka
   
4. Answer routed back to client
   Kafka → SignalingServer → Client (WebSocket)
```

### Meeting Event Broadcast

```
1. Event occurs (client joins/leaves, etc.)
   Source → SignalingServer or SFU
   
2. Event published to Kafka
   meeting-events topic
   
3. All signaling servers consume event
   Broadcast to connected clients in that meeting
```

### Resource Assignment

```
1. Client requests meeting creation
   POST /meeting/create
   
2. Orchestration queries Redis
   - Available SFUs: SMEMBERS available_sfus
   - SFU metrics: HGETALL sfu:{id}:metrics
   - Signaling metrics: HGETALL signaling:{url}:metrics
   
3. Selects best resources
   - Lowest client count
   - Recent heartbeat
   
4. Stores assignment
   Redis: HSET meeting:{id}:metadata sfu_id, signaling_url
   
5. Notifies SFU via Kafka
   prepareMeeting command
```

## Development Guide

### Adding a New Feature

1. **Client-side feature**
   - Create new module in `client-electronapp/meeting/modules/`
   - Integrate in `meeting-sfu-new.js`
   - Update state management if needed

2. **Server-side feature**
   - Add route in `server/routes/` if API endpoint needed
   - Update signaling server in `server/signaling/` if WebSocket message needed
   - Update SFU in `server/ion_sfu/` if media handling needed

3. **Infrastructure changes**
   - Update `docker-compose.yaml` for new services
   - Add configuration files in `configs/`
   - Update scripts if cluster setup needed

### Debugging

- **Client logs**: Check browser DevTools console (Electron)
- **Server logs**: `docker-compose logs <service-name>`
- **Kafka messages**: Use Kafka console consumer
- **Redis data**: Connect with `redis-cli` to specific node

### Testing

- **Client**: Manual testing via Electron app
- **Server**: API testing via Postman/curl
- **WebRTC**: Multiple client instances for peer connection testing
- **Load testing**: Multiple concurrent meetings

## Key Design Decisions

1. **SFU Architecture**: Chosen for scalability over mesh/P2P
2. **Kafka for Signaling**: Decouples signaling servers from SFUs, enables scaling
3. **Dual Redis Clusters**: Separates concerns (general data vs SFU-specific)
4. **Modular Client**: Easier maintenance and testing
5. **Go for SFU**: Performance-critical media routing requires low latency
6. **Electron**: Cross-platform desktop app with web technologies

## Future Enhancements

- Integration of AI pipeline with live meetings
- Screen sharing improvements
- Recording and playback functionality
- Mobile client support
- Enhanced security (TURN servers, encryption)
- Analytics and monitoring dashboard
- Meeting recording and transcription
- Breakout rooms

## Contributing

[Add contribution guidelines]

## License

[Add license information]

---

**Note**: This is a comprehensive overview. For detailed API documentation, see `docs/` directory. For AI pipeline specifics, see `conversational-ai-pipeline/README.md`.