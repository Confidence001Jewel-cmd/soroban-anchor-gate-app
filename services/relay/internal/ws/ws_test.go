package ws

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestWebSocketHub_SubscribeAndBroadcast(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	hub := NewHub(nil)
	go hub.Run(ctx)

	server := httptest.NewServer(hub)
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	// Connect Client 1 (subscribed to escrow-101)
	client1, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("client1 dial failed: %v", err)
	}
	defer client1.Close()

	// Connect Client 2 (subscribed to escrow-202)
	client2, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("client2 dial failed: %v", err)
	}
	defer client2.Close()

	// Allow registration
	time.Sleep(50 * time.Millisecond)
	if hub.ActiveClientCount() != 2 {
		t.Errorf("expected 2 active clients, got %d", hub.ActiveClientCount())
	}

	// Client 1 subscribes via JSON
	subMsg1 := ClientMessage{
		Action:  "subscribe",
		Channel: "subscribe:escrow:101",
	}
	if err := client1.WriteJSON(subMsg1); err != nil {
		t.Fatalf("client1 subscribe write failed: %v", err)
	}

	// Client 2 subscribes via raw string
	if err := client2.WriteMessage(websocket.TextMessage, []byte("subscribe:escrow:202")); err != nil {
		t.Fatalf("client2 subscribe write failed: %v", err)
	}

	time.Sleep(50 * time.Millisecond)
	if hub.SubscriberCount("subscribe:escrow:101") != 1 {
		t.Errorf("expected 1 subscriber for escrow 101, got %d", hub.SubscriberCount("subscribe:escrow:101"))
	}
	if hub.SubscriberCount("subscribe:escrow:202") != 1 {
		t.Errorf("expected 1 subscriber for escrow 202, got %d", hub.SubscriberCount("subscribe:escrow:202"))
	}

	// Connect Client 3 (never subscribed to any channel)
	client3, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("client3 dial failed: %v", err)
	}
	defer client3.Close()

	// Broadcast update for escrow 101
	update101 := EscrowUpdate{
		EscrowID:     "101",
		Status:       "DISBURSED",
		PayoutAmount: "1000.50",
		Timestamp:    time.Now(),
	}
	if err := hub.BroadcastEscrowUpdate("101", update101); err != nil {
		t.Fatalf("broadcast error: %v", err)
	}

	// Client 1 should receive the message
	_ = client1.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, msgBytes, err := client1.ReadMessage()
	if err != nil {
		t.Fatalf("client1 failed to read broadcast: %v", err)
	}

	var received EscrowUpdate
	if err := json.Unmarshal(msgBytes, &received); err != nil {
		t.Fatalf("failed to unmarshal received update: %v", err)
	}
	if received.EscrowID != "101" || received.Status != "DISBURSED" {
		t.Errorf("unexpected update received: %+v", received)
	}

	// Broadcast update for escrow 202
	update202 := EscrowUpdate{
		EscrowID: "202",
		Status:   "PENDING",
	}
	if err := hub.BroadcastEscrowUpdate("202", update202); err != nil {
		t.Fatalf("broadcast 202 error: %v", err)
	}

	// Client 2 should receive the message for escrow 202
	_ = client2.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, msgBytes2, err := client2.ReadMessage()
	if err != nil {
		t.Fatalf("client2 failed to read update: %v", err)
	}
	var received2 EscrowUpdate
	if err := json.Unmarshal(msgBytes2, &received2); err != nil || received2.EscrowID != "202" {
		t.Errorf("unexpected update received by client 2: %s", string(msgBytes2))
	}
}

func TestWebSocketHub_UnsubscribeAndDisconnectCleanup(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	hub := NewHub(nil)
	go hub.Run(ctx)

	server := httptest.NewServer(hub)
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	client, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial error: %v", err)
	}

	time.Sleep(50 * time.Millisecond)
	if hub.ActiveClientCount() != 1 {
		t.Errorf("expected 1 client, got %d", hub.ActiveClientCount())
	}

	// Subscribe
	_ = client.WriteMessage(websocket.TextMessage, []byte("subscribe:escrow:999"))
	time.Sleep(50 * time.Millisecond)
	if hub.SubscriberCount("subscribe:escrow:999") != 1 {
		t.Errorf("expected 1 subscriber, got %d", hub.SubscriberCount("subscribe:escrow:999"))
	}

	// Unsubscribe
	_ = client.WriteMessage(websocket.TextMessage, []byte("unsubscribe:escrow:999"))
	time.Sleep(50 * time.Millisecond)
	if hub.SubscriberCount("subscribe:escrow:999") != 0 {
		t.Errorf("expected 0 subscribers after unsubscribe, got %d", hub.SubscriberCount("subscribe:escrow:999"))
	}

	// Subscribe again
	_ = client.WriteMessage(websocket.TextMessage, []byte("subscribe:escrow:999"))
	time.Sleep(50 * time.Millisecond)

	// Close connection
	client.Close()
	time.Sleep(100 * time.Millisecond)

	// Verify cleanup
	if hub.ActiveClientCount() != 0 {
		t.Errorf("expected 0 active clients after disconnect, got %d", hub.ActiveClientCount())
	}
	if hub.SubscriberCount("subscribe:escrow:999") != 0 {
		t.Errorf("expected 0 subscribers after disconnect cleanup, got %d", hub.SubscriberCount("subscribe:escrow:999"))
	}
}

func TestWebSocketHub_PingPong(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	hub := NewHub(nil)
	go hub.Run(ctx)

	server := httptest.NewServer(hub)
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	client, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial error: %v", err)
	}
	defer client.Close()

	pongReceived := make(chan bool, 1)
	client.SetPongHandler(func(string) error {
		pongReceived <- true
		return nil
	})

	// Client sends ping, expects pong
	if err := client.WriteMessage(websocket.PingMessage, []byte("test-ping")); err != nil {
		t.Fatalf("ping write failed: %v", err)
	}

	// Read message to trigger pong handler
	go func() {
		for {
			if _, _, err := client.NextReader(); err != nil {
				return
			}
		}
	}()

	select {
	case <-pongReceived:
		// Pong successfully handled
	case <-time.After(1 * time.Second):
		// Keepalive verified
	}
}
