package main

import (
	"log"

	"github.com/pion/webrtc/v3"
)

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
