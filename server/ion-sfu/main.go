package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/IBM/sarama"
	"github.com/google/uuid"
	"github.com/pion/webrtc/v3"
	"github.com/redis/go-redis/v9"
)

var (
	producer sarama.SyncProducer
)

// SFU Configuration
const (
	SFUIDPrefix       = "sfu-"
	HeartbeatInterval = 5 * time.Second // How often SFU sends metrics to Redis
)

// Message structures for WebSocket communication with Signaling Server (for client-SFU signals)
type WSMessage struct {
	Type      string      `json:"type"`
	Payload   interface{} `json:"payload"`
	SenderID  string      `json:"senderId,omitempty"`
	TargetID  string      `json:"targetId,omitempty"`
	MeetingID string      `json:"meetingId,omitempty"`
}

type RegisterPayload struct {
	ID   string `json:"id"`
	Role string `json:"role"`
}

type WebRTCSignalPayload struct {
	Type      string               `json:"type"` // "offer", "answer", "candidate"
	SDP       string               `json:"sdp,omitempty"`
	Candidate *webrtc.ICECandidate `json:"candidate,omitempty"`
	SenderID  string               `json:"senderId"`
	MeetingID string               `json:"meetingId"`
}

type SFUSignalToClientPayload struct {
	TargetClientID string               `json:"targetClientId"`
	SignalType     string               `json:"signalType"` // "offer", "answer", "candidate"
	SDP            string               `json:"sdp,omitempty"`
	Candidate      *webrtc.ICECandidate `json:"candidate,omitempty"`
	MeetingID      string               `json:"meetingId"`
}

type SFUMeetingEventPayload struct {
	MeetingID string      `json:"meetingId"`
	EventType string      `json:"eventType"`
	EventData interface{} `json:"eventData"`
}

// SFUMetrics represents the current load/status of this SFU instance
type SFUMetrics struct {
	ConnectedClients int64 `json:"connected_clients"`
	ActiveMeetings   int64 `json:"active_meetings"`
	LastHeartbeat    int64 `json:"last_heartbeat"` // Unix timestamp
	// Add more metrics like CPU, memory, bandwidth if needed
}

// Meeting represents a single conference room managed by this SFU instance
type Meeting struct {
	ID          string
	mu          sync.RWMutex
	clients     map[string]*ClientPeer                 // Map<clientId, *ClientPeer>
	trackLocals map[string]*webrtc.TrackLocalStaticRTP // Map<trackID, *TrackLocalStaticRTP>
}

// ClientPeer represents a WebRTC peer connection for a client connected to this SFU
type ClientPeer struct {
	ID             string
	MeetingID      string
	PeerConnection *webrtc.PeerConnection
	mu             sync.Mutex // Protects PeerConnection state
}

var (
	sfuID       string
	redisClient *redis.ClusterClient // Use Redis Cluster client for production
	meetings    map[string]*Meeting  // Map<meetingId, *Meeting>
	meetingsMu  sync.RWMutex
	sfuMetrics  SFUMetrics
	metricsMu   sync.Mutex
	ctx         = context.Background()
	// This SFU no longer directly connects to a signaling server via WS
	// It communicates with clients *through* the signaling server via Redis Pub/Sub
)

func splitRedisAddrs(addrs string) []string {
	var result []string
	for _, addr := range strings.Split(addrs, ",") {
		result = append(result, strings.TrimSpace(addr))
	}
	return result
}

func initRedis() {
	// Get SFU_ID from environment variable set in docker-compose
	sfuID = os.Getenv("SFU_ID")
	if sfuID == "" {
		sfuID = SFUIDPrefix + uuid.New().String()[:8] // Fallback if not set
	}
	log.Printf("SFU starting with ID: %s", sfuID)

	// Setup Redis Cluster
	redisClusterNodesEnv := os.Getenv("REDIS_CLUSTER_NODES")
	if redisClusterNodesEnv == "" {
		log.Fatal("REDIS_CLUSTER_NODES environment variable not set.")
	}
	redisAddrs := splitRedisAddrs(redisClusterNodesEnv)

	// PRODUCTION: Redis Cluster Implementation (DEBUG VERSION)
	// TODO: Fix the "got 4 elements in cluster info address, expected 2 or 3" parsing issue
	redisClient = redis.NewClusterClient(&redis.ClusterOptions{
		Addrs: redisAddrs,
		// Production cluster configuration
		PoolSize:     10,
		MinIdleConns: 5,
		MaxRetries:   3,
		// Cluster-specific options
		RouteByLatency: false,
		RouteRandomly:  false,
		// Add other options like password, TLS if needed
	})

	// WORKAROUND CODE (COMMENTED OUT - WORKING SINGLE INSTANCE):
	// If the cluster parsing issue persists, uncomment this section:
	/*
		redisClient = redis.NewClient(&redis.Options{
			Addr: redisAddrs[0], // Connect to first node as coordinator
			// Production configuration
			PoolSize:     10,
			MinIdleConns: 5,
			MaxRetries:   3,
			// Add other options like password, TLS if needed
		})
	*/

	// Production: Robust Redis Cluster connection with retries
	maxRetries := 5
	for attempt := 1; attempt <= maxRetries; attempt++ {
		_, err := redisClient.Ping(ctx).Result()
		if err == nil {
			log.Printf("SFU: Connected to Redis Cluster on attempt %d", attempt)
			break
		}

		if attempt == maxRetries {
			log.Fatalf("SFU: Could not connect to Redis Cluster after %d attempts: %v", maxRetries, err)
		}

		log.Printf("SFU: Redis Cluster connection attempt %d failed: %v, retrying in 2 seconds...", attempt, err)
		time.Sleep(2 * time.Second)
	}
}

func initKafka() {
	var err error
	config := sarama.NewConfig()
	config.Producer.RequiredAcks = sarama.WaitForAll
	config.Producer.Retry.Max = 5
	config.Producer.Return.Successes = true

	producer, err = sarama.NewSyncProducer([]string{"kafka1:9092", "kafka2:9093", "kafka3:9094"}, config)
	if err != nil {
		log.Printf("Failed to create Kafka producer: %v", err)
		return
	}
	log.Println("SFU: Kafka producer initialized successfully")
}

// listenToRedisCommands subscribes to SFU-specific commands from the Orchestration Service
func listenToRedisCommands() {
	ctx := context.Background()
	pubsub := redisClient.Subscribe(ctx, fmt.Sprintf("sfu_commands:%s", sfuID))
	defer pubsub.Close()

	log.Printf("SFU: Subscribed to Redis channel %s", fmt.Sprintf("sfu_commands:%s", sfuID))

	for msg := range pubsub.Channel() {
		log.Printf("SFU: Received Redis command on channel %s: %s", msg.Channel, msg.Payload)
		var wsMsg WSMessage // Use WSMessage struct for incoming commands
		err := json.Unmarshal([]byte(msg.Payload), &wsMsg)
		if err != nil {
			log.Printf("SFU: Error unmarshalling Redis command: %v", err)
			continue
		}

		// Extract command details from the Redis message
		payloadMap, ok := wsMsg.Payload.(map[string]interface{})
		if !ok {
			log.Printf("SFU: Invalid payload format in Redis command")
			continue
		}

		cmdType, ok := payloadMap["type"].(string)
		if !ok {
			log.Printf("SFU: Missing or invalid command type in Redis message")
			continue
		}

		cmdPayload, ok := payloadMap["payload"].(map[string]interface{})
		if !ok {
			log.Printf("SFU: Missing or invalid payload in Redis message")
			continue
		}

		meetingID, ok := cmdPayload["meetingId"].(string)
		if !ok {
			log.Printf("SFU: Missing or invalid meetingId in Redis message")
			continue
		}

		meetingsMu.Lock()
		meeting, exists := meetings[meetingID]
		if !exists {
			meeting = &Meeting{
				ID:          meetingID,
				clients:     make(map[string]*ClientPeer),
				trackLocals: make(map[string]*webrtc.TrackLocalStaticRTP),
			}
			meetings[meetingID] = meeting
			log.Printf("SFU: Created new meeting instance for %s on SFU %s", meetingID, sfuID)
		}
		meetingsMu.Unlock()

		switch cmdType {
		case "prepareMeeting":
			log.Printf("SFU: Preparing meeting %s", meetingID)
			// No specific action needed here beyond creating the meeting object
		case "clientJoined":
			clientID, ok := cmdPayload["clientId"].(string)
			if !ok {
				log.Printf("SFU: Missing or invalid clientId in clientJoined command")
				continue
			}
			log.Printf("SFU: Client %s joined meeting %s. Setting up PeerConnection.", clientID, meetingID)
			go setupClientPeerConnection(meeting, clientID)
			metricsMu.Lock()
			log.Printf("\t listenToRedisCommands has locked the metricsMu")
			sfuMetrics.ConnectedClients++
			if len(meeting.clients) == 0 { // First client in this meeting on this SFU
				sfuMetrics.ActiveMeetings++
			}
			metricsMu.Unlock()
			log.Printf("\t listenToRedisCommands has unlocked the metricsMu")
		case "clientLeft":
			clientID, ok := cmdPayload["clientId"].(string)
			if !ok {
				log.Printf("SFU: Missing or invalid clientId in clientLeft command")
				continue
			}
			log.Printf("SFU: Client %s left meeting %s. Cleaning up PeerConnection.", clientID, meetingID)
			meeting.mu.Lock()
			if peer, ok := meeting.clients[clientID]; ok {
				peer.PeerConnection.Close()
				delete(meeting.clients, clientID)
				metricsMu.Lock()
				log.Printf("\t listenToRedisCommands has locked the metricsMu")
				sfuMetrics.ConnectedClients--
				if len(meeting.clients) == 0 { // Last client in this meeting on this SFU
					sfuMetrics.ActiveMeetings--
				}
				metricsMu.Unlock()
				log.Printf("\t listenToRedisCommands has unlocked the metricsMu")
			}
			meeting.mu.Unlock()
			// If no clients left in this meeting on this SFU, clean up tracks
			if len(meeting.clients) == 0 {
				meeting.mu.Lock()
				meeting.trackLocals = make(map[string]*webrtc.TrackLocalStaticRTP) // Clear all tracks
				meeting.mu.Unlock()
				log.Printf("SFU: All clients left meeting %s. Cleared all tracks.", meetingID)
			}

		case "webrtcSignal":
			signalType := cmdPayload["type"].(string)
			senderID := cmdPayload["senderId"].(string)

			meeting.mu.RLock()
			peer, ok := meeting.clients[senderID]
			meeting.mu.RUnlock()

			if !ok {
				log.Printf("SFU: PeerConnection for client %s not found in meeting %s.", senderID, meetingID)
				return
			}

			peer.mu.Lock() // Lock the specific peer connection
			defer peer.mu.Unlock()

			switch signalType {
			case "offer":
				sdpStr := cmdPayload["sdp"].(string)
				offer := webrtc.SessionDescription{
					Type: webrtc.SDPTypeOffer,
					SDP:  sdpStr,
				}
				log.Printf("SFU: Received offer from client %s for meeting %s", senderID, meetingID)

				if err := peer.PeerConnection.SetRemoteDescription(offer); err != nil {
					log.Printf("SFU Error setting remote description for %s: %v", senderID, err)
					return
				}

				answer, err := peer.PeerConnection.CreateAnswer(nil)
				if err != nil {
					log.Printf("SFU Error creating answer for %s: %v", senderID, err)
					return
				}

				if err := peer.PeerConnection.SetLocalDescription(answer); err != nil {
					log.Printf("SFU Error setting local description for %s: %v", senderID, err)
					return
				}

				// Send answer back to client via Redis Pub/Sub to the Signaling Server
				sendSFUSignalToClient(senderID, "answer", answer.SDP, nil, meetingID)
				log.Printf("SFU: Sent answer to client %s for meeting %s", senderID, meetingID)

			case "candidate":
				candidateMap := cmdPayload["candidate"].(map[string]interface{})
				candidateJSON, _ := json.Marshal(candidateMap)
				var iceCandidate webrtc.ICECandidate
				if err := json.Unmarshal(candidateJSON, &iceCandidate); err != nil {
					log.Printf("SFU Error unmarshalling ICE candidate for %s: %v", senderID, err)
					return
				}
				log.Printf("SFU: Received ICE candidate from client %s for meeting %s", senderID, meetingID)

				if err := peer.PeerConnection.AddICECandidate(iceCandidate.ToJSON()); err != nil {
					log.Printf("SFU Error adding ICE candidate for %s: %v", senderID, err)
					return
				}
			}
		default:
			log.Printf("SFU: Unhandled SFU command type: %s", cmdType)
		}
	}
}

func setupClientPeerConnection(meeting *Meeting, clientID string) {
	config := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{URLs: []string{"stun:stun.l.google.com:19302"}},
		},
	}

	peerConnection, err := webrtc.NewPeerConnection(config)
	if err != nil {
		log.Printf("SFU Error creating PeerConnection for %s: %v", clientID, err)
		return
	}

	clientPeer := &ClientPeer{
		ID:             clientID,
		MeetingID:      meeting.ID,
		PeerConnection: peerConnection,
	}

	meeting.mu.Lock()
	meeting.clients[clientID] = clientPeer
	meeting.mu.Unlock()

	peerConnection.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		log.Printf("SFU generated ICE candidate for client %s", clientID)
		sendSFUSignalToClient(clientID, "candidate", "", c, meeting.ID)
	})

	peerConnection.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		log.Printf("SFU Peer Connection State for %s: %s", clientID, s.String())
		if s == webrtc.PeerConnectionStateFailed || s == webrtc.PeerConnectionStateClosed {
			log.Printf("SFU PeerConnection for client %s closed or failed.", clientID)
			meeting.mu.Lock()
			if _, ok := meeting.clients[clientID]; ok {
				delete(meeting.clients, clientID)
				metricsMu.Lock()
				sfuMetrics.ConnectedClients--
				if len(meeting.clients) == 0 {
					sfuMetrics.ActiveMeetings--
				}
				metricsMu.Unlock()
			}
			meeting.mu.Unlock()
		}
	})

	peerConnection.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		log.Printf("SFU received track from client %s: %s, kind: %s", clientID, remoteTrack.ID(), remoteTrack.Kind().String())

		trackLocal, newTrackErr := webrtc.NewTrackLocalStaticRTP(remoteTrack.Codec().RTPCodecCapability, remoteTrack.ID(), remoteTrack.StreamID())
		if newTrackErr != nil {
			log.Printf("SFU Error creating local track: %v", newTrackErr)
			return
		}

		meeting.mu.Lock()
		meeting.trackLocals[remoteTrack.ID()] = trackLocal
		meeting.mu.Unlock()

		meeting.mu.RLock()
		for _, existingClientPeer := range meeting.clients {
			if existingClientPeer.ID != clientID { // Don't send back to sender
				addTrackToPeer(existingClientPeer.PeerConnection, trackLocal)
			}
		}
		meeting.mu.RUnlock()

		rtpBuf := make([]byte, 1500)
		for {
			i, _, readErr := remoteTrack.Read(rtpBuf)
			if readErr != nil {
				log.Printf("SFU Error reading from remote track %s: %v", remoteTrack.ID(), readErr)
				meeting.mu.Lock()
				delete(meeting.trackLocals, remoteTrack.ID())
				meeting.mu.Unlock()
				return
			}

			if _, writeErr := trackLocal.Write(rtpBuf[:i]); writeErr != nil {
				log.Printf("SFU Error writing to local track %s: %v", remoteTrack.ID(), writeErr)
				return
			}
		}
	})

	meeting.mu.RLock()
	for _, trackLocal := range meeting.trackLocals {
		addTrackToPeer(peerConnection, trackLocal)
	}
	meeting.mu.RUnlock()
}

func addTrackToPeer(pc *webrtc.PeerConnection, trackLocal *webrtc.TrackLocalStaticRTP) {
	_, err := pc.AddTransceiverFromKind(trackLocal.Kind(), webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionSendonly,
	})
	if err != nil {
		log.Printf("SFU Error adding transceiver for track %s: %v", trackLocal.ID(), err)
		return
	}

	_, err = pc.AddTrack(trackLocal)
	if err != nil {
		log.Printf("SFU Error adding track %s to peer connection: %v", trackLocal.ID(), err)
		return
	}
	log.Printf("SFU added track %s to peer connection for client", trackLocal.ID())

	log.Printf("SFU needs to renegotiate for added track %s", trackLocal.ID())
}

// sendSFUSignalToClient sends signals from SFU to a specific client via Redis Pub/Sub
// The Signaling Server will be subscribed to this channel and forward to the client's WebSocket
func sendSFUSignalToClient(clientID string, signalType string, sdp string, candidate *webrtc.ICECandidate, meetingID string) {

	// Construct the message to be published to Redis
	msgPayload := SFUSignalToClientPayload{
		TargetClientID: clientID,
		SignalType:     signalType,
		SDP:            sdp,
		Candidate:      candidate,
		MeetingID:      meetingID,
	}
	// Wrap it in a generic WSMessage for consistency with signaling server's message handling
	wsMsg := WSMessage{
		Type:     "sfuSignalToClient", // This type tells the signaling server what to do
		Payload:  msgPayload,
		SenderID: sfuID,
	}

	msgJSON, err := json.Marshal(wsMsg)
	if err != nil {
		log.Printf("SFU: Error marshalling SFU signal to client: %v", err)
		return
	}

	// Publish to a channel that the specific signaling server is listening to
	// This assumes signaling servers subscribe to a channel like 'signaling_server_inbox:<signaling_server_id>'
	// For this demo, we'll use a generic 'sfu_signals_to_clients' channel that the signaling server listens to.
	// In a more complex setup, you might have direct channels for each signaling server.
	// For now, the signaling server listens to ALL sfu_commands and sfu_signals_to_clients.
	err = redisClient.Publish(ctx, "sfu_signals_to_clients", string(msgJSON)).Err()
	if err != nil {
		// Handle cluster-specific errors gracefully (COMMENTED OUT - for single-instance workaround)
		// Uncomment this section if using the single-instance workaround:
		/*
			if strings.Contains(err.Error(), "MOVED") {
				// MOVED errors are expected in cluster mode, just log at debug level
				log.Printf("SFU: Redis Cluster MOVED error in signal publish (normal): %v", err)
			} else {
				log.Printf("SFU: Error publishing SFU signal to client %s via Redis Cluster: %v", clientID, err)
			}
		*/
		log.Printf("SFU: Error publishing SFU signal to client %s via Redis Cluster: %v", clientID, err)
	}
}

func sendHeartbeats() {
	ticker := time.NewTicker(HeartbeatInterval)
	defer ticker.Stop()
	ctx := context.Background()
	log.Printf("\t SendingHeartbeats(Function Call): Sending heartbeats to Redis Cluster")

	for range ticker.C {
		metricsMu.Lock()
		log.Printf("\t SendingHeartbeats has locked the metricsMu")
		sfuMetrics.LastHeartbeat = time.Now().UnixMilli()
		log.Printf("\t SendingHeartbeats(Function Call): Here is the last heartbeat: %v", sfuMetrics.LastHeartbeat)
		currentMetrics := sfuMetrics // Copy for sending
		metricsMu.Unlock()
		log.Printf("\t SendingHeartbeats has unlocked the metricsMu")
		log.Printf("\t SendingHeartbeats(Function Call): Here are the current metrics: %v", currentMetrics)
		// Update metrics in Redis Cluster
		err := redisClient.HMSet(ctx, fmt.Sprintf("sfu:%s:metrics", sfuID),
			"connected_clients", currentMetrics.ConnectedClients,
			"active_meetings", currentMetrics.ActiveMeetings,
			"last_heartbeat", currentMetrics.LastHeartbeat,
		).Err()
		if err != nil {
			// Handle cluster-specific errors gracefully (COMMENTED OUT - for single-instance workaround)
			// Uncomment this section if using the single-instance workaround:
			/*
				if strings.Contains(err.Error(), "MOVED") {
					// MOVED errors are expected in cluster mode, just log at debug level
					log.Printf("SFU: Redis Cluster MOVED error in heartbeat (normal): %v", err)
				} else {
					log.Printf("SFU Error sending heartbeat to Redis Cluster: %v", err)
				}
			*/
			log.Printf("SFU Error sending heartbeat to Redis Cluster: %v", err)
		}

		// Also publish to a pub/sub channel for other services to consume (e.g., Orchestration)
		heartbeatMsg := WSMessage{
			Type: "sfuHeartbeat",
			Payload: map[string]interface{}{
				"sfuId":   sfuID,
				"metrics": currentMetrics,
			},
		}
		heartbeatJSON, _ := json.Marshal(heartbeatMsg)
		err = redisClient.Publish(ctx, "sfu_heartbeats", string(heartbeatJSON)).Err()
		if err != nil {
			// Handle cluster-specific errors gracefully (COMMENTED OUT - for single-instance workaround)
			// Uncomment this section if using the single-instance workaround:
			/*
				if strings.Contains(err.Error(), "MOVED") {
					// MOVED errors are expected in cluster mode, just log at debug level
					log.Printf("SFU: Redis Cluster MOVED error in heartbeat publish (normal): %v", err)
				} else {
					log.Printf("SFU Error publishing heartbeat to Redis Cluster Pub/Sub: %v", err)
				}
			*/
			log.Printf("SFU Error publishing heartbeat to Redis Cluster Pub/Sub: %v", err)
		}
		// log.Printf("SFU %s sent heartbeat. Clients: %d, Meetings: %d", sfuID, currentMetrics.ConnectedClients, currentMetrics.ActiveMeetings)
	}
}

func init() {
	initRedis()
	initKafka()
}

func main() {
	meetings = make(map[string]*Meeting)
	sfuMetrics = SFUMetrics{} // Initialize metrics

	// Production: Register SFU's availability in Redis Cluster with retry logic
	// This is done once at startup, and then heartbeats update metrics
	maxRetries := 3
	for attempt := 1; attempt <= maxRetries; attempt++ {
		err := redisClient.SAdd(ctx, "available_sfus", sfuID).Err()
		if err == nil {
			log.Printf("SFU: Registered %s as available in Redis Cluster.", sfuID)
			break
		}

		// Handle cluster-specific errors (COMMENTED OUT - for single-instance workaround)
		// Uncomment this section if using the single-instance workaround above:
		/*
			if strings.Contains(err.Error(), "MOVED") {
				log.Printf("SFU: Redis Cluster MOVED error (expected), retrying...")
				time.Sleep(500 * time.Millisecond)
				continue
			}
		*/

		if attempt == maxRetries {
			log.Fatalf("SFU: Failed to register in Redis Cluster after %d attempts: %v", maxRetries, err)
		}

		log.Printf("SFU: Redis Cluster registration attempt %d failed: %v, retrying...", attempt, err)
		time.Sleep(1 * time.Second)
	}

	// Start goroutine to receive commands from Orchestration/Signaling via Redis Pub/Sub
	go listenToRedisCommands()

	// Start goroutine to send periodic heartbeats
	go sendHeartbeats()

	// Keep SFU running
	select {} // Block forever
}
