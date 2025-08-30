package main

import (
	"github.com/pion/webrtc/v3"
)

func setupClientPeerConnection(meeting *Meeting, clientID string) {
	sfuLogger.Info("WEBRTC", "Setting up client peer connection", map[string]interface{}{
		"clientID":  clientID,
		"meetingID": meeting.ID,
		"sfuID":     sfuID,
	})

	config := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{URLs: []string{"stun:stun.l.google.com:19302"}},
		},
	}

	sfuLogger.Debug("WEBRTC", "WebRTC configuration", map[string]interface{}{
		"iceServers": config.ICEServers,
		"clientID":   clientID,
	})

	peerConnection, err := webrtc.NewPeerConnection(config)
	if err != nil {
		sfuLogger.Error("WEBRTC", "Error creating PeerConnection", err, map[string]interface{}{
			"clientID":  clientID,
			"meetingID": meeting.ID,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	sfuLogger.Debug("WEBRTC", "PeerConnection created successfully", map[string]interface{}{
		"clientID":  clientID,
		"meetingID": meeting.ID,
	})

	clientPeer := &ClientPeer{
		ID:             clientID,
		MeetingID:      meeting.ID,
		PeerConnection: peerConnection,
	}

	meeting.mu.Lock()
	meeting.clients[clientID] = clientPeer
	meeting.mu.Unlock()

	sfuLogger.Debug("WEBRTC", "Client peer added to meeting", map[string]interface{}{
		"clientID":     clientID,
		"meetingID":    meeting.ID,
		"totalClients": len(meeting.clients),
	})

	peerConnection.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			sfuLogger.Debug("WEBRTC", "ICE candidate gathering complete", map[string]interface{}{
				"clientID":  clientID,
				"meetingID": meeting.ID,
			})
			return
		}
		sfuLogger.Debug("WEBRTC", "Generated ICE candidate", map[string]interface{}{
			"clientID":  clientID,
			"meetingID": meeting.ID,
			"candidate": c.String(),
		})
		sendSFUSignalToClient(clientID, "candidate", "", c, meeting.ID)
	})

	peerConnection.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		sfuLogger.Info("WEBRTC", "Peer connection state changed", map[string]interface{}{
			"clientID":  clientID,
			"meetingID": meeting.ID,
			"state":     s.String(),
		})

		if s == webrtc.PeerConnectionStateFailed || s == webrtc.PeerConnectionStateClosed {
			sfuLogger.Warn("WEBRTC", "PeerConnection closed or failed", map[string]interface{}{
				"clientID":  clientID,
				"meetingID": meeting.ID,
				"state":     s.String(),
			})

			meeting.mu.Lock()
			if _, ok := meeting.clients[clientID]; ok {
				delete(meeting.clients, clientID)
				sfuLogger.Info("WEBRTC", "Client removed from meeting", map[string]interface{}{
					"clientID":         clientID,
					"meetingID":        meeting.ID,
					"remainingClients": len(meeting.clients),
				})

				metricsMu.Lock()
				sfuMetrics.ConnectedClients--
				if len(meeting.clients) == 0 {
					sfuMetrics.ActiveMeetings--
					sfuLogger.Info("WEBRTC", "Meeting became empty", map[string]interface{}{
						"meetingID":      meeting.ID,
						"activeMeetings": sfuMetrics.ActiveMeetings,
					})
				}
				metricsMu.Unlock()

				sfuState.UpdateMetrics(sfuMetrics.ConnectedClients, sfuMetrics.ActiveMeetings)
			}
			meeting.mu.Unlock()
		}
	})

	peerConnection.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		sfuLogger.Info("WEBRTC", "Received remote track", map[string]interface{}{
			"clientID":  clientID,
			"meetingID": meeting.ID,
			"trackID":   remoteTrack.ID(),
			"trackKind": remoteTrack.Kind().String(),
			"streamID":  remoteTrack.StreamID(),
		})

		trackLocal, newTrackErr := webrtc.NewTrackLocalStaticRTP(remoteTrack.Codec().RTPCodecCapability, remoteTrack.ID(), remoteTrack.StreamID())
		if newTrackErr != nil {
			sfuLogger.Error("WEBRTC", "Error creating local track", newTrackErr, map[string]interface{}{
				"clientID":  clientID,
				"meetingID": meeting.ID,
				"trackID":   remoteTrack.ID(),
			})
			sfuState.IncrementCounters(0, 0, 1)
			return
		}

		sfuLogger.Debug("WEBRTC", "Local track created successfully", map[string]interface{}{
			"clientID":  clientID,
			"meetingID": meeting.ID,
			"trackID":   remoteTrack.ID(),
			"trackKind": remoteTrack.Kind().String(),
		})

		meeting.mu.Lock()
		meeting.trackLocals[remoteTrack.ID()] = trackLocal
		meeting.mu.Unlock()

		sfuLogger.Debug("WEBRTC", "Adding track to existing clients", map[string]interface{}{
			"clientID":        clientID,
			"meetingID":       meeting.ID,
			"trackID":         remoteTrack.ID(),
			"existingClients": len(meeting.clients),
		})

		meeting.mu.RLock()
		for _, existingClientPeer := range meeting.clients {
			if existingClientPeer.ID != clientID { // Don't send back to sender
				addTrackToPeer(existingClientPeer.PeerConnection, trackLocal)
			}
		}
		meeting.mu.RUnlock()

		rtpBuf := make([]byte, 1500)
		packetCount := int64(0)

		sfuLogger.Debug("WEBRTC", "Starting RTP packet forwarding", map[string]interface{}{
			"clientID":  clientID,
			"meetingID": meeting.ID,
			"trackID":   remoteTrack.ID(),
		})

		for {
			i, _, readErr := remoteTrack.Read(rtpBuf)
			if readErr != nil {
				sfuLogger.Error("WEBRTC", "Error reading from remote track", readErr, map[string]interface{}{
					"clientID":    clientID,
					"meetingID":   meeting.ID,
					"trackID":     remoteTrack.ID(),
					"packetCount": packetCount,
				})
				sfuState.IncrementCounters(0, 0, 1)

				meeting.mu.Lock()
				delete(meeting.trackLocals, remoteTrack.ID())
				meeting.mu.Unlock()
				return
			}

			if _, writeErr := trackLocal.Write(rtpBuf[:i]); writeErr != nil {
				sfuLogger.Error("WEBRTC", "Error writing to local track", writeErr, map[string]interface{}{
					"clientID":    clientID,
					"meetingID":   meeting.ID,
					"trackID":     remoteTrack.ID(),
					"packetCount": packetCount,
				})
				sfuState.IncrementCounters(0, 0, 1)
				return
			}

			packetCount++
			if packetCount%1000 == 0 { // Log every 1000 packets
				sfuLogger.Debug("WEBRTC", "RTP packet forwarding progress", map[string]interface{}{
					"clientID":    clientID,
					"meetingID":   meeting.ID,
					"trackID":     remoteTrack.ID(),
					"packetCount": packetCount,
				})
			}
		}
	})

	sfuLogger.Debug("WEBRTC", "Adding existing tracks to new client", map[string]interface{}{
		"clientID":       clientID,
		"meetingID":      meeting.ID,
		"existingTracks": len(meeting.trackLocals),
	})

	meeting.mu.RLock()
	for _, trackLocal := range meeting.trackLocals {
		addTrackToPeer(peerConnection, trackLocal)
	}
	meeting.mu.RUnlock()

	sfuLogger.Info("WEBRTC", "Client peer connection setup completed", map[string]interface{}{
		"clientID":     clientID,
		"meetingID":    meeting.ID,
		"totalClients": len(meeting.clients),
		"totalTracks":  len(meeting.trackLocals),
	})
}

func addTrackToPeer(pc *webrtc.PeerConnection, trackLocal *webrtc.TrackLocalStaticRTP) {
	sfuLogger.Debug("WEBRTC", "Adding track to peer connection", map[string]interface{}{
		"trackID":   trackLocal.ID(),
		"trackKind": trackLocal.Kind().String(),
		"streamID":  trackLocal.StreamID(),
	})

	_, err := pc.AddTransceiverFromKind(trackLocal.Kind(), webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionSendonly,
	})
	if err != nil {
		sfuLogger.Error("WEBRTC", "Error adding transceiver", err, map[string]interface{}{
			"trackID":   trackLocal.ID(),
			"trackKind": trackLocal.Kind().String(),
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	_, err = pc.AddTrack(trackLocal)
	if err != nil {
		sfuLogger.Error("WEBRTC", "Error adding track to peer connection", err, map[string]interface{}{
			"trackID":   trackLocal.ID(),
			"trackKind": trackLocal.Kind().String(),
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	sfuLogger.Debug("WEBRTC", "Track added to peer connection", map[string]interface{}{
		"trackID":   trackLocal.ID(),
		"trackKind": trackLocal.Kind().String(),
	})

	// Trigger renegotiation by creating and sending an offer
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		sfuLogger.Error("WEBRTC", "Error creating offer for renegotiation", err, map[string]interface{}{
			"trackID": trackLocal.ID(),
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	err = pc.SetLocalDescription(offer)
	if err != nil {
		sfuLogger.Error("WEBRTC", "Error setting local description for renegotiation", err, map[string]interface{}{
			"trackID": trackLocal.ID(),
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	// Find the client ID for this PeerConnection and send the offer
	// We need to find which client this PeerConnection belongs to
	meetingsMu.RLock()
	for _, meeting := range meetings {
		meeting.mu.RLock()
		for clientID, clientPeer := range meeting.clients {
			if clientPeer.PeerConnection == pc {
				sendSFUSignalToClient(clientID, "offer", offer.SDP, nil, meeting.ID)
				meeting.mu.RUnlock()
				meetingsMu.RUnlock()

				sfuLogger.Info("WEBRTC", "Sent renegotiation offer to client", map[string]interface{}{
					"clientID":  clientID,
					"meetingID": meeting.ID,
					"trackID":   trackLocal.ID(),
					"offerSDP":  offer.SDP[:100] + "...", // Log first 100 chars of SDP
				})
				return
			}
		}
		meeting.mu.RUnlock()
	}
	meetingsMu.RUnlock()

	sfuLogger.Warn("WEBRTC", "Could not find client for PeerConnection", map[string]interface{}{
		"trackID":   trackLocal.ID(),
		"trackKind": trackLocal.Kind().String(),
	})
}
