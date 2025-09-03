package main

import (
	"encoding/json"
	"time"

	"github.com/IBM/sarama"
	"github.com/pion/webrtc/v3"
)

// processKafkaMessage handles individual Kafka messages
func processKafkaMessage(msg *sarama.ConsumerMessage, messageCount int64) {
	sfuLogger.Info("KAFKA", "Received Kafka message", map[string]interface{}{
		"messageCount": messageCount,
		"topic":        msg.Topic,
		"partition":    msg.Partition,
		"offset":       msg.Offset,
		"key":          string(msg.Key),
		"valueLength":  len(msg.Value),
		"sfuID":        sfuID,
		"keyMatches":   string(msg.Key) == sfuID,
	})

	sfuCommand, err := parseKafkaCommand(msg.Value)
	if err != nil {
		sfuLogger.Error("KAFKA", "Error unmarshalling Kafka command", err, map[string]interface{}{
			"messageCount": messageCount,
			"rawValue":     string(msg.Value),
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	// Check if this command is for this SFU. Some messages are broadcasts (like client signals)
	// that the signaling server sends, and we need to route them appropriately.
	// The key is often the target (SFU or client).
	if sfuCommand.Type == "sfuSignalToClient" {
		// This is a message produced by an SFU, intended for a client.
		// The key is the clientID. The signaling server should handle this.
		// We are consuming from the same topic, so we might get our own messages.
		// We should ignore them.
		sfuLogger.Warn("KAFKA", "sfuSignalToClient when shouldn't have", map[string]interface{}{
			"commandType": sfuCommand.Type,
			"payload":     sfuCommand.Payload,
		})
		return
	}

	if string(msg.Key) != sfuID {
		sfuLogger.Debug("KAFKA", "Skipping command not meant for this SFU", map[string]interface{}{
			"messageKey":  string(msg.Key),
			"sfuID":       sfuID,
			"commandType": sfuCommand.Type,
		})
		return
	}

	sfuLogger.Info("KAFKA", "Processing SFU command", map[string]interface{}{
		"commandType": sfuCommand.Type,
		"sfuID":       sfuID,
		"payload":     sfuCommand.Payload,
	})

	meetingID, ok := sfuCommand.Payload["meetingId"].(string)
	if !ok {
		sfuLogger.Error("KAFKA", "Missing or invalid meetingId in Kafka message", nil, map[string]interface{}{
			"commandType": sfuCommand.Type,
			"payload":     sfuCommand.Payload,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	meeting := getOrCreateMeeting(meetingID)
	handleSFUCommand(sfuCommand, meeting)
}

// parseKafkaCommand unmarshals a Kafka message into an SFUCommand
func parseKafkaCommand(value []byte) (SFUCommand, error) {
	var sfuCommand SFUCommand
	err := json.Unmarshal(value, &sfuCommand)
	return sfuCommand, err
}

// getOrCreateMeeting retrieves an existing meeting or creates a new one
func getOrCreateMeeting(meetingID string) *Meeting {
	meetingsMu.Lock()
	defer meetingsMu.Unlock()

	meeting, exists := meetings[meetingID]
	if !exists {
		meeting = &Meeting{
			ID:          meetingID,
			clients:     make(map[string]*ClientPeer),
			trackLocals: make(map[string]*webrtc.TrackLocalStaticRTP),
		}
		meetings[meetingID] = meeting
		sfuLogger.Info("KAFKA", "Created new meeting instance", map[string]interface{}{
			"meetingID": meetingID,
			"sfuID":     sfuID,
		})
		sfuState.IncrementCounters(1, 0, 0)
	}

	return meeting
}

// handleSFUCommand routes SFU commands to appropriate handlers
func handleSFUCommand(sfuCommand SFUCommand, meeting *Meeting) {
	switch sfuCommand.Type {
	case "prepareMeeting":
		handlePrepareMeeting(meeting)
	case "clientJoined":
		handleClientJoined(sfuCommand, meeting)
	case "clientLeft":
		handleClientLeft(sfuCommand, meeting)
	case "webrtcSignal":
		handleWebRTCSignal(sfuCommand, meeting)
	default:
		sfuLogger.Warn("KAFKA", "Unhandled SFU command type", map[string]interface{}{
			"commandType": sfuCommand.Type,
			"payload":     sfuCommand.Payload,
		})
	}
}

// handlePrepareMeeting processes prepare meeting commands
func handlePrepareMeeting(meeting *Meeting) {
	meetingID := meeting.ID

	sfuLogger.Info("KAFKA", "Processing prepare meeting command", map[string]interface{}{
		"meetingID": meetingID,
		"sfuID":     sfuID,
	})

	// Validate meeting ID
	if meetingID == "" {
		sfuLogger.Error("KAFKA", "Invalid meeting ID for preparation", nil, map[string]interface{}{
			"meetingID": meetingID,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	// Initialize meeting with metadata
	meeting.mu.Lock()
	meeting.createdAt = time.Now()
	meeting.status = "prepared"
	meeting.maxParticipants = 10
	meeting.mu.Unlock()

	// Update metrics
	metricsMu.Lock()
	sfuMetrics.ActiveMeetings++
	metricsMu.Unlock()

	sfuLogger.Info("KAFKA", "Meeting prepared successfully", map[string]interface{}{
		"meetingID":       meetingID,
		"status":          "prepared",
		"maxParticipants": 10,
		"activeMeetings":  sfuMetrics.ActiveMeetings,
	})
	sfuState.UpdateMetrics(sfuMetrics.ConnectedClients, sfuMetrics.ActiveMeetings)
}

// handleClientJoined processes client joined commands
func handleClientJoined(sfuCommand SFUCommand, meeting *Meeting) {
	clientID, ok := sfuCommand.Payload["clientId"].(string)
	if !ok {
		sfuLogger.Error("KAFKA", "Missing or invalid clientId in clientJoined command", nil, map[string]interface{}{
			"payload": sfuCommand.Payload,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	meetingID := meeting.ID

	sfuLogger.Info("KAFKA", "Client joined meeting", map[string]interface{}{
		"clientID":  clientID,
		"meetingID": meetingID,
		"sfuID":     sfuID,
	})

	sfuLogger.Info("KAFKA", "Setting up client peer connection", map[string]interface{}{
		"clientID":  clientID,
		"meetingID": meetingID,
		"sfuID":     sfuID,
	})
	go setupClientPeerConnection(meeting, clientID, sfuCommand.ReplyTo)
	metricsMu.Lock()
	sfuMetrics.ConnectedClients++
	if len(meeting.clients) == 0 { // First client in this meeting on this SFU
		sfuMetrics.ActiveMeetings++
	}
	metricsMu.Unlock()

	sfuLogger.Info("KAFKA", "Client join processing completed", map[string]interface{}{
		"clientID":         clientID,
		"meetingID":        meetingID,
		"connectedClients": sfuMetrics.ConnectedClients,
		"activeMeetings":   sfuMetrics.ActiveMeetings,
	})
	sfuState.IncrementCounters(0, 1, 0) // New client
	sfuState.UpdateMetrics(sfuMetrics.ConnectedClients, sfuMetrics.ActiveMeetings)
}

// handleClientLeft processes client left commands
func handleClientLeft(sfuCommand SFUCommand, meeting *Meeting) {
	clientID, ok := sfuCommand.Payload["clientId"].(string)
	if !ok {
		sfuLogger.Error("KAFKA", "Missing or invalid clientId in clientLeft command", nil, map[string]interface{}{
			"payload": sfuCommand.Payload,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	meetingID := meeting.ID

	sfuLogger.Info("KAFKA", "Client left meeting", map[string]interface{}{
		"clientID":  clientID,
		"meetingID": meetingID,
		"sfuID":     sfuID,
	})

	meeting.mu.Lock()
	if peer, ok := meeting.clients[clientID]; ok {
		peer.PeerConnection.Close()
		delete(meeting.clients, clientID)
		metricsMu.Lock()
		sfuMetrics.ConnectedClients--
		if len(meeting.clients) == 0 { // Last client in this meeting on this SFU
			sfuMetrics.ActiveMeetings--
		}
		metricsMu.Unlock()

		sfuLogger.Info("KAFKA", "Client cleanup completed", map[string]interface{}{
			"clientID":         clientID,
			"meetingID":        meetingID,
			"remainingClients": len(meeting.clients),
			"connectedClients": sfuMetrics.ConnectedClients,
			"activeMeetings":   sfuMetrics.ActiveMeetings,
		})
	} else {
		sfuLogger.Warn("KAFKA", "Client not found in meeting", map[string]interface{}{
			"clientID":  clientID,
			"meetingID": meetingID,
		})
	}
	meeting.mu.Unlock()

	sfuState.UpdateMetrics(sfuMetrics.ConnectedClients, sfuMetrics.ActiveMeetings)

	// If no clients left in this meeting on this SFU, clean up tracks
	if len(meeting.clients) == 0 {
		meeting.mu.Lock()
		meeting.trackLocals = make(map[string]*webrtc.TrackLocalStaticRTP) // Clear all tracks
		meeting.mu.Unlock()
		sfuLogger.Info("KAFKA", "All clients left meeting, cleared all tracks", map[string]interface{}{
			"meetingID": meetingID,
		})
	}
}

// handleWebRTCSignal processes WebRTC signaling messages
func handleWebRTCSignal(sfuCommand SFUCommand, meeting *Meeting) {
	signalType, ok := sfuCommand.Payload["type"].(string)
	if !ok {
		sfuLogger.Error("KAFKA", "Missing or invalid type in webrtcSignal command", nil, map[string]interface{}{
			"payload": sfuCommand.Payload,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	senderID, ok := sfuCommand.Payload["senderId"].(string)
	if !ok {
		sfuLogger.Error("KAFKA", "Missing or invalid senderId in webrtcSignal command", nil, map[string]interface{}{
			"payload": sfuCommand.Payload,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	meetingID := meeting.ID

	sfuLogger.Debug("KAFKA", "Processing WebRTC signal", map[string]interface{}{
		"signalType": signalType,
		"senderID":   senderID,
		"meetingID":  meetingID,
	})

	peer := waitForPeerConnection(meeting, senderID)
	if peer == nil {
		return
	}

	peer.mu.Lock() // Lock the specific peer connection
	defer peer.mu.Unlock()

	switch signalType {
	case "offer":
		handleOfferSignal(sfuCommand, peer, senderID, meetingID)
	case "answer":
		handleAnswerSignal(sfuCommand, peer, senderID, meetingID)
	case "candidate":
		handleCandidateSignal(sfuCommand, peer, senderID, meetingID)
	}
}

// waitForPeerConnection waits for a peer connection to be available with retry logic
func waitForPeerConnection(meeting *Meeting, senderID string) *ClientPeer {
	maxRetries := 10
	for i := 0; i < maxRetries; i++ {
		meeting.mu.RLock()
		peer, peerExists := meeting.clients[senderID]
		meeting.mu.RUnlock()

		if peerExists {
			return peer
		}

		sfuLogger.Debug("KAFKA", "PeerConnection not found, retrying", map[string]interface{}{
			"senderID":   senderID,
			"meetingID":  meeting.ID,
			"attempt":    i + 1,
			"maxRetries": maxRetries,
		})
		time.Sleep(100 * time.Millisecond) // Wait 100ms before retrying
	}

	sfuLogger.Error("KAFKA", "PeerConnection not found after maximum retries", nil, map[string]interface{}{
		"senderID":   senderID,
		"meetingID":  meeting.ID,
		"maxRetries": maxRetries,
	})
	sfuState.IncrementCounters(0, 0, 1)
	return nil
}

// handleOfferSignal processes offer signals
func handleOfferSignal(sfuCommand SFUCommand, peer *ClientPeer, senderID, meetingID string) {
	sdpStr, ok := sfuCommand.Payload["sdp"].(string)
	if !ok {
		sfuLogger.Error("KAFKA", "Missing or invalid sdp in offer signal", nil, map[string]interface{}{
			"payload": sfuCommand.Payload,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	offer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  sdpStr,
	}

	sfuLogger.Info("KAFKA", "Received offer from client", map[string]interface{}{
		"senderID":  senderID,
		"meetingID": meetingID,
		"sdpLength": len(sdpStr),
	})

	if err := peer.PeerConnection.SetRemoteDescription(offer); err != nil {
		sfuLogger.Error("KAFKA", "Error setting remote description", err, map[string]interface{}{
			"senderID":  senderID,
			"meetingID": meetingID,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	// Process any pending ICE candidates
	processPendingCandidates(peer, senderID)

	answer, err := peer.PeerConnection.CreateAnswer(nil)
	if err != nil {
		sfuLogger.Error("KAFKA", "Error creating answer", err, map[string]interface{}{
			"senderID":  senderID,
			"meetingID": meetingID,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	if err := peer.PeerConnection.SetLocalDescription(answer); err != nil {
		sfuLogger.Error("KAFKA", "Error setting local description", err, map[string]interface{}{
			"senderID":  senderID,
			"meetingID": meetingID,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	// Send answer back to client
	sendSFUSignalToClient(senderID, "answer", answer.SDP, nil, meetingID, sfuCommand.ReplyTo)
	sfuLogger.Info("KAFKA", "Sent answer to client", map[string]interface{}{
		"senderID":        senderID,
		"meetingID":       meetingID,
		"answerSDPLength": len(answer.SDP),
	})
}

// handleAnswerSignal processes answer signals
func handleAnswerSignal(sfuCommand SFUCommand, peer *ClientPeer, senderID, meetingID string) {
	sdpStr, ok := sfuCommand.Payload["sdp"].(string)
	if !ok {
		sfuLogger.Error("KAFKA", "Missing or invalid sdp in answer signal", nil, map[string]interface{}{
			"payload": sfuCommand.Payload,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	answer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeAnswer,
		SDP:  sdpStr,
	}

	sfuLogger.Info("KAFKA", "Received answer from client", map[string]interface{}{
		"senderID":  senderID,
		"meetingID": meetingID,
		"sdpLength": len(sdpStr),
	})

	if err := peer.PeerConnection.SetRemoteDescription(answer); err != nil {
		sfuLogger.Error("KAFKA", "Error setting remote description", err, map[string]interface{}{
			"senderID":  senderID,
			"meetingID": meetingID,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	sfuLogger.Info("KAFKA", "Successfully set remote description", map[string]interface{}{
		"senderID":  senderID,
		"meetingID": meetingID,
	})
}

// handleCandidateSignal processes ICE candidate signals
func handleCandidateSignal(sfuCommand SFUCommand, peer *ClientPeer, senderID, meetingID string) {
	candidateMap, ok := sfuCommand.Payload["candidate"].(map[string]interface{})
	if !ok {
		sfuLogger.Error("KAFKA", "Missing or invalid candidate in candidate signal", nil, map[string]interface{}{
			"payload": sfuCommand.Payload,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	candidateJSON, _ := json.Marshal(candidateMap)
	var iceCandidateInit webrtc.ICECandidateInit
	if err := json.Unmarshal(candidateJSON, &iceCandidateInit); err != nil {
		sfuLogger.Error("KAFKA", "Error unmarshalling ICE candidate", err, map[string]interface{}{
			"senderID":     senderID,
			"candidateMap": candidateMap,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	sfuLogger.Debug("KAFKA", "Received ICE candidate from client", map[string]interface{}{
		"senderID":  senderID,
		"meetingID": meetingID,
		"candidate": iceCandidateInit.Candidate,
	})

	// Check if remote description is set before adding ICE candidate
	if peer.PeerConnection.RemoteDescription() == nil {
		sfuLogger.Debug("KAFKA", "Remote description not set yet, buffering ICE candidate", map[string]interface{}{
			"senderID":  senderID,
			"candidate": iceCandidateInit.Candidate,
		})
		// Store the candidate to be added later when remote description is set
		if peer.pendingCandidates == nil {
			peer.pendingCandidates = make([]webrtc.ICECandidateInit, 0)
		}
		peer.pendingCandidates = append(peer.pendingCandidates, iceCandidateInit)
		return
	}

	if err := peer.PeerConnection.AddICECandidate(iceCandidateInit); err != nil {
		sfuLogger.Error("KAFKA", "Error adding ICE candidate", err, map[string]interface{}{
			"senderID":  senderID,
			"candidate": iceCandidateInit.Candidate,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	sfuLogger.Debug("KAFKA", "Successfully added ICE candidate", map[string]interface{}{
		"senderID":  senderID,
		"candidate": iceCandidateInit.Candidate,
	})
}

// processPendingCandidates processes any pending ICE candidates
func processPendingCandidates(peer *ClientPeer, senderID string) {
	if len(peer.pendingCandidates) > 0 {
		sfuLogger.Info("KAFKA", "Processing pending ICE candidates", map[string]interface{}{
			"senderID":     senderID,
			"pendingCount": len(peer.pendingCandidates),
		})
		for _, candidate := range peer.pendingCandidates {
			if err := peer.PeerConnection.AddICECandidate(candidate); err != nil {
				sfuLogger.Error("KAFKA", "Error adding pending ICE candidate", err, map[string]interface{}{
					"senderID":  senderID,
					"candidate": candidate,
				})
				sfuState.IncrementCounters(0, 0, 1)
			} else {
				sfuLogger.Debug("KAFKA", "Successfully added pending ICE candidate", map[string]interface{}{
					"senderID": senderID,
				})
			}
		}
		// Clear the pending candidates
		peer.pendingCandidates = nil
	}
}

// sendSFUSignalToClient sends signals from SFU to a specific client via Kafka
func sendSFUSignalToClient(clientID string, signalType string, sdp string, candidate *webrtc.ICECandidate, meetingID string, replyTo string) {
	sfuLogger.Debug("KAFKA", "Sending SFU signal to client", map[string]interface{}{
		"clientID":     clientID,
		"signalType":   signalType,
		"meetingID":    meetingID,
		"replyTo":      replyTo,
		"hasSDP":       len(sdp) > 0,
		"hasCandidate": candidate != nil,
	})

	var candidateData interface{}
	if candidate != nil {
		candidateInit := candidate.ToJSON()
		candidateData = map[string]interface{}{
			"candidate":     candidateInit.Candidate,
			"sdpMid":        candidateInit.SDPMid,
			"sdpMLineIndex": candidateInit.SDPMLineIndex,
		}
	}

	msgPayload := SFUSignalToClientPayload{
		TargetClientID: clientID,
		SignalType:     signalType,
		SDP:            sdp,
		Candidate:      candidateData,
		MeetingID:      meetingID,
	}
	wsMsg := WSMessage{
		Type:     "sfuSignalToClient",
		Payload:  msgPayload,
		SenderID: sfuID,
	}

	msgJSON, err := json.Marshal(wsMsg)
	if err != nil {
		sfuLogger.Error("KAFKA", "Error marshalling SFU signal to client", err, map[string]interface{}{
			"clientID":   clientID,
			"signalType": signalType,
			"meetingID":  meetingID,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	topic := "sfu_commands"
	if replyTo != "" {
		topic = replyTo
	}

	msg := &sarama.ProducerMessage{
		Topic: topic,
		Key:   sarama.StringEncoder(clientID),
		Value: sarama.StringEncoder(string(msgJSON)),
	}

	partition, offset, err := producer.SendMessage(msg)
	if err != nil {
		sfuLogger.Error("KAFKA", "Error sending SFU signal to client via Kafka", err, map[string]interface{}{
			"clientID":   clientID,
			"signalType": signalType,
			"meetingID":  meetingID,
			"topic":      topic,
		})
		sfuState.IncrementCounters(0, 0, 1)
	} else {
		sfuLogger.Info("KAFKA", "Successfully sent SFU signal to client via Kafka", map[string]interface{}{
			"clientID":    clientID,
			"signalType":  signalType,
			"meetingID":   meetingID,
			"partition":   partition,
			"offset":      offset,
			"messageSize": len(msgJSON),
		})
	}
}
