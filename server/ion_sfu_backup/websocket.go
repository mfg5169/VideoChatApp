package main

import (
	"net/url"
	"time"

	"github.com/gorilla/websocket"
)

func connectToSignalingServer() {
	sfuLogger.Info("WEBSOCKET", "Attempting to connect to signaling server", map[string]interface{}{
		"signalingURL": signalingURL,
		"sfuID":        sfuID,
	})

	u, err := url.Parse(signalingURL)
	if err != nil {
		sfuLogger.Error("WEBSOCKET", "Invalid signaling server URL", err, map[string]interface{}{
			"signalingURL": signalingURL,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	sfuLogger.Debug("WEBSOCKET", "Parsed signaling server URL", map[string]interface{}{
		"scheme": u.Scheme,
		"host":   u.Host,
		"path":   u.Path,
	})

	// Connect to signaling server
	wsConn, _, err = websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		sfuLogger.Error("WEBSOCKET", "Failed to connect to signaling server", err, map[string]interface{}{
			"signalingURL": signalingURL,
			"parsedURL":    u.String(),
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	sfuLogger.Info("WEBSOCKET", "Successfully connected to signaling server", map[string]interface{}{
		"signalingURL": signalingURL,
		"localAddr":    wsConn.LocalAddr().String(),
		"remoteAddr":   wsConn.RemoteAddr().String(),
	})

	// Register with signaling server
	registerMsg := WSMessage{
		Type: "register",
		Payload: RegisterPayload{
			ID:   sfuID,
			Role: "sfu",
		},
	}

	sfuLogger.Debug("WEBSOCKET", "Sending registration message", map[string]interface{}{
		"sfuID": sfuID,
		"role":  "sfu",
	})

	err = wsConn.WriteJSON(registerMsg)
	if err != nil {
		sfuLogger.Error("WEBSOCKET", "Failed to register with signaling server", err, map[string]interface{}{
			"sfuID":       sfuID,
			"registerMsg": registerMsg,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	sfuLogger.Info("WEBSOCKET", "Successfully registered with signaling server", map[string]interface{}{
		"sfuID": sfuID,
		"role":  "sfu",
	})

	sfuState.UpdateConnections(true, true, true) // Kafka, Redis, WebSocket

	// Start listening for messages from signaling server
	sfuLogger.Info("WEBSOCKET", "Starting message listener", nil)
	go listenToSignalingServer()
}

func listenToSignalingServer() {
	sfuLogger.Info("WEBSOCKET", "Message listener started", map[string]interface{}{
		"sfuID": sfuID,
	})

	messageCount := int64(0)

	for {
		var msg WSMessage
		err := wsConn.ReadJSON(&msg)
		if err != nil {
			sfuLogger.Error("WEBSOCKET", "Error reading from signaling server", err, map[string]interface{}{
				"sfuID":        sfuID,
				"messageCount": messageCount,
			})
			sfuState.IncrementCounters(0, 0, 1)
			sfuState.UpdateConnections(true, true, false) // WebSocket disconnected

			// Try to reconnect
			sfuLogger.Info("WEBSOCKET", "Attempting to reconnect to signaling server", map[string]interface{}{
				"reconnectDelay": "5s",
				"sfuID":          sfuID,
			})
			time.Sleep(5 * time.Second)
			connectToSignalingServer()
			return
		}

		messageCount++
		sfuLogger.Debug("WEBSOCKET", "Received message from signaling server", map[string]interface{}{
			"messageType":  msg.Type,
			"messageCount": messageCount,
			"senderID":     msg.SenderID,
			"targetID":     msg.TargetID,
			"meetingID":    msg.MeetingID,
		})

		// Handle any direct messages from signaling server if needed
		// This could include health checks, configuration updates, etc.
		if msg.Type == "ping" {
			sfuLogger.Debug("WEBSOCKET", "Received ping from signaling server", map[string]interface{}{
				"sfuID": sfuID,
			})
			// Send pong response
			pongMsg := WSMessage{
				Type: "pong",
				Payload: map[string]interface{}{
					"sfuID":     sfuID,
					"timestamp": time.Now().Unix(),
				},
			}
			if err := wsConn.WriteJSON(pongMsg); err != nil {
				sfuLogger.Error("WEBSOCKET", "Failed to send pong response", err, map[string]interface{}{
					"sfuID": sfuID,
				})
			}
		}
	}
}
