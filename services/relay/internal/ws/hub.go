package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// EscrowUpdate represents a real-time state transition event sent to frontend clients.
type EscrowUpdate struct {
	EscrowID       string    `json:"escrow_id"`
	EventID        string    `json:"event_id,omitempty"`
	Status         string    `json:"status"`
	PayoutAmount   string    `json:"payout_amount,omitempty"`
	ProfileHashHex string    `json:"profile_hash_hex,omitempty"`
	Timestamp      time.Time `json:"timestamp"`
}

// ClientMessage represents an incoming message from a connected frontend WebSocket client.
type ClientMessage struct {
	Action  string `json:"action"`            // e.g. "subscribe", "unsubscribe"
	Channel string `json:"channel,omitempty"` // e.g. "subscribe:escrow:123"
}

// BroadcastMessage encapsulates a channel and payload to be distributed to subscribers.
type BroadcastMessage struct {
	Channel string
	Payload []byte
}

// Hub maintains the set of active connected clients and dispatches messages to subscribed channels.
type Hub struct {
	clients       map[*Client]bool
	subscriptions map[string]map[*Client]bool

	register   chan *Client
	unregister chan *Client
	broadcast  chan BroadcastMessage

	mu       sync.RWMutex
	upgrader websocket.Upgrader
	logger   *slog.Logger
}

// NewHub creates a new WebSocket Hub instance.
func NewHub(logger *slog.Logger) *Hub {
	if logger == nil {
		logger = slog.Default()
	}
	return &Hub{
		clients:       make(map[*Client]bool),
		subscriptions: make(map[string]map[*Client]bool),
		register:      make(chan *Client),
		unregister:    make(chan *Client),
		broadcast:     make(chan BroadcastMessage, 256),
		logger:        logger,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				// Allow all origins for API relay service
				return true
			},
		},
	}
}

// Run executes the hub event processing loop until the context is canceled.
func (h *Hub) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			h.mu.Lock()
			for client := range h.clients {
				close(client.send)
				_ = client.conn.Close()
				delete(h.clients, client)
			}
			h.subscriptions = make(map[string]map[*Client]bool)
			h.mu.Unlock()
			return

		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			h.logger.Debug("WebSocket client connected", "remote_addr", client.conn.RemoteAddr().String())

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				// Clean up all channel subscriptions for this client
				for channel, subscribers := range h.subscriptions {
					delete(subscribers, client)
					if len(subscribers) == 0 {
						delete(h.subscriptions, channel)
					}
				}
			}
			h.mu.Unlock()
			h.logger.Debug("WebSocket client disconnected and cleaned up", "remote_addr", client.conn.RemoteAddr().String())

		case msg := <-h.broadcast:
			h.mu.RLock()
			subscribers, exists := h.subscriptions[msg.Channel]
			if exists {
				for client := range subscribers {
					select {
					case client.send <- msg.Payload:
					default:
						// Buffer full: drop slow client
						h.logger.Warn("Dropping slow WebSocket client", "remote_addr", client.conn.RemoteAddr().String())
						go func(c *Client) {
							h.unregister <- c
						}(client)
					}
				}
			}
			h.mu.RUnlock()
		}
	}
}

// Subscribe adds a client to a channel subscription.
func (h *Hub) Subscribe(client *Client, channel string) {
	channel = strings.TrimSpace(channel)
	if channel == "" {
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	if _, ok := h.subscriptions[channel]; !ok {
		h.subscriptions[channel] = make(map[*Client]bool)
	}
	h.subscriptions[channel][client] = true
	client.mu.Lock()
	client.channels[channel] = true
	client.mu.Unlock()

	h.logger.Debug("Client subscribed to channel", "channel", channel, "remote_addr", client.conn.RemoteAddr().String())
}

// Unsubscribe removes a client from a channel subscription.
func (h *Hub) Unsubscribe(client *Client, channel string) {
	channel = strings.TrimSpace(channel)
	if channel == "" {
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	if subscribers, ok := h.subscriptions[channel]; ok {
		delete(subscribers, client)
		if len(subscribers) == 0 {
			delete(h.subscriptions, channel)
		}
	}
	client.mu.Lock()
	delete(client.channels, channel)
	client.mu.Unlock()

	h.logger.Debug("Client unsubscribed from channel", "channel", channel, "remote_addr", client.conn.RemoteAddr().String())
}

// Broadcast sends a JSON-encoded payload to all subscribers of a channel.
func (h *Hub) Broadcast(channel string, payload interface{}) error {
	channel = strings.TrimSpace(channel)
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal broadcast payload: %w", err)
	}

	h.broadcast <- BroadcastMessage{
		Channel: channel,
		Payload: data,
	}
	return nil
}

// BroadcastEscrowUpdate notifies frontend clients subscribed to `subscribe:escrow:<id>`.
func (h *Hub) BroadcastEscrowUpdate(escrowID string, update EscrowUpdate) error {
	if update.Timestamp.IsZero() {
		update.Timestamp = time.Now()
	}
	channel := fmt.Sprintf("subscribe:escrow:%s", escrowID)
	return h.Broadcast(channel, update)
}

// ActiveClientCount returns the number of currently connected WebSocket clients.
func (h *Hub) ActiveClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// SubscriberCount returns the number of active clients subscribed to a given channel.
func (h *Hub) SubscriberCount(channel string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	subscribers, ok := h.subscriptions[channel]
	if !ok {
		return 0
	}
	return len(subscribers)
}

// ServeHTTP upgrades HTTP requests to WebSocket connections and registers them with the Hub.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Error("WebSocket upgrade failed", "error", err)
		return
	}

	client := &Client{
		hub:      h,
		conn:     conn,
		send:     make(chan []byte, 64),
		channels: make(map[string]bool),
	}

	h.register <- client

	go client.writePump()
	go client.readPump()
}
