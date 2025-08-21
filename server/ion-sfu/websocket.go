package main

import (
	"log"
	"net/url"
	"time"

	"github.com/gorilla/websocket"
)

func connectToSignalingServer() {
	u, err := url.Parse(signalingURL)
	if err != nil {
		log.Printf("SFU: Invalid signaling server URL: %v", err)
		return
	}

	// Connect to signaling server
	wsConn, _, err = websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		log.Printf("SFU: Failed to connect to signaling server: %v", err)
		return
	}

	// Register with signaling server
	registerMsg := WSMessage{
		Type: "register",
		Payload: RegisterPayload{
			ID:   sfuID,
			Role: "sfu",
		},
	}

	err = wsConn.WriteJSON(registerMsg)
	if err != nil {
		log.Printf("SFU: Failed to register with signaling server: %v", err)
		return
	}

	log.Printf("SFU: Successfully connected to signaling server and registered as %s", sfuID)

	// Start listening for messages from signaling server
	go listenToSignalingServer()
}

func listenToSignalingServer() {
	for {
		var msg WSMessage
		err := wsConn.ReadJSON(&msg)
		if err != nil {
			log.Printf("SFU: Error reading from signaling server: %v", err)
			// Try to reconnect
			time.Sleep(5 * time.Second)
			connectToSignalingServer()
			return
		}

		log.Printf("SFU: Received message from signaling server: %s", msg.Type)
		// Handle any direct messages from signaling server if needed
	}
}
