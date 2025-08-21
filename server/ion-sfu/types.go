package main

import (
	"sync"
	"time"

	"github.com/pion/webrtc/v3"
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

// Command structure for Redis messages from signaling server
type SFUCommand struct {
	Event   string                 `json:"event"`
	Payload map[string]interface{} `json:"payload"`
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
