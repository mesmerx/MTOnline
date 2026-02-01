package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/gorilla/websocket"
	"github.com/joho/godotenv"
	_ "github.com/mattn/go-sqlite3"
)

const (
	cookieName = "sessionId"
)

type App struct {
	db        *sql.DB
	rooms     *RoomRegistry
	router    *chi.Mux
	clientsMu sync.RWMutex
	clients   map[string]*WSClient
}

type RoomRegistry struct {
	mu           sync.RWMutex
	rooms        map[string]*RoomState
	socketToRoom map[string]string
	socketRole   map[string]string
}

type RoomState struct {
	ID             string
	Password       string
	HostSocketID   string
	HostPlayerID   string
	HostPlayerName string
	Clients        map[string]ClientInfo
}

type ClientInfo struct {
	PlayerID   string `json:"playerId"`
	PlayerName string `json:"playerName"`
}

type RoomCreatePayload struct {
	RoomID     string `json:"roomId"`
	Password   string `json:"password"`
	PlayerID   string `json:"playerId"`
	PlayerName string `json:"playerName"`
}

type RoomJoinPayload struct {
	RoomID     string `json:"roomId"`
	Password   string `json:"password"`
	PlayerID   string `json:"playerId"`
	PlayerName string `json:"playerName"`
}

type RoomClientMessagePayload struct {
	RoomID  string      `json:"roomId"`
	Message interface{} `json:"message"`
}

type RoomHostMessagePayload struct {
	RoomID         string      `json:"roomId"`
	TargetSocketID string      `json:"targetSocketId,omitempty"`
	Message        interface{} `json:"message"`
}

type RoomEventPayload struct {
	RoomID     string          `json:"roomId"`
	EventType  string          `json:"eventType"`
	EventData  json.RawMessage `json:"eventData"`
	PlayerID   string          `json:"playerId"`
	PlayerName string          `json:"playerName"`
}

type RoomClientJoinedPayload struct {
	RoomID     string `json:"roomId"`
	PlayerID   string `json:"playerId"`
	PlayerName string `json:"playerName"`
	SocketID   string `json:"socketId"`
}

type RoomClientLeftPayload struct {
	RoomID   string `json:"roomId"`
	PlayerID string `json:"playerId"`
	SocketID string `json:"socketId"`
}

type ErrorPayload struct {
	Message string `json:"message"`
}

type WSClient struct {
	id   string
	conn *websocket.Conn
	mu   sync.Mutex
}

type WSMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

func NewRoomRegistry() *RoomRegistry {
	return &RoomRegistry{
		rooms:        make(map[string]*RoomState),
		socketToRoom: make(map[string]string),
		socketRole:   make(map[string]string),
	}
}

func (r *RoomRegistry) Create(roomID string, payload RoomCreatePayload, socketID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.rooms[roomID]; exists {
		return errors.New("room already exists")
	}
	r.rooms[roomID] = &RoomState{
		ID:             roomID,
		Password:       payload.Password,
		HostSocketID:   socketID,
		HostPlayerID:   payload.PlayerID,
		HostPlayerName: payload.PlayerName,
		Clients:        make(map[string]ClientInfo),
	}
	r.socketToRoom[socketID] = roomID
	r.socketRole[socketID] = "host"
	return nil
}

func (r *RoomRegistry) Join(roomID string, payload RoomJoinPayload, socketID string) (*RoomState, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	room, ok := r.rooms[roomID]
	if !ok {
		return nil, errors.New("room not found")
	}
	if room.Password != payload.Password {
		return nil, errors.New("incorrect password")
	}
	room.Clients[socketID] = ClientInfo{
		PlayerID:   payload.PlayerID,
		PlayerName: payload.PlayerName,
	}
	r.socketToRoom[socketID] = roomID
	r.socketRole[socketID] = "client"
	return room, nil
}

func (r *RoomRegistry) RemoveSocket(socketID string) (roomID string, role string, info *ClientInfo, wasHost bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	roomID = r.socketToRoom[socketID]
	role = r.socketRole[socketID]
	delete(r.socketToRoom, socketID)
	delete(r.socketRole, socketID)
	if roomID == "" {
		return "", "", nil, false
	}
	room := r.rooms[roomID]
	if room == nil {
		return roomID, role, nil, role == "host"
	}
	if role == "host" {
		delete(r.rooms, roomID)
		return roomID, role, nil, true
	}
	if role == "client" {
		clientInfo := room.Clients[socketID]
		delete(room.Clients, socketID)
		return roomID, role, &clientInfo, false
	}
	return roomID, role, nil, false
}

func (r *RoomRegistry) HostSocket(roomID string) string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	room := r.rooms[roomID]
	if room == nil {
		return ""
	}
	return room.HostSocketID
}

func (r *RoomRegistry) ClientInfo(roomID string, socketID string) (ClientInfo, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	room := r.rooms[roomID]
	if room == nil {
		return ClientInfo{}, false
	}
	info, ok := room.Clients[socketID]
	return info, ok
}

func (r *RoomRegistry) ClientSocketIDs(roomID string) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	room := r.rooms[roomID]
	if room == nil {
		return nil
	}
	ids := make([]string, 0, len(room.Clients))
	for id := range room.Clients {
		ids = append(ids, id)
	}
	return ids
}

func main() {
	if err := godotenv.Load(); err != nil {
		log.Printf("dotenv not loaded: %v", err)
	}

	db, err := openDatabase()
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	defer db.Close()
	if err := ensureSchema(db); err != nil {
		log.Fatalf("failed to ensure schema: %v", err)
	}
	if err := ensureCardsLoaded(db); err != nil {
		log.Printf("cards load skipped: %v", err)
	}

	app := &App{
		db:      db,
		rooms:   NewRoomRegistry(),
		router:  chi.NewRouter(),
		clients: make(map[string]*WSClient),
	}

	app.router.Use(middleware.RequestID)
	app.router.Use(middleware.RealIP)
	app.router.Use(middleware.Recoverer)
	app.router.Use(app.corsMiddleware)

	app.router.HandleFunc("/ws", app.handleWS)

	app.registerRoutes()

	port := resolvePort("API_PORT", "PORT", "3000")
	addr := "0.0.0.0:" + port
	log.Printf("[api] listening on %s", addr)
	log.Printf("[ws] listening on %s", addr)

	if err := http.ListenAndServe(addr, app.router); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}

func (a *App) handleWS(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				return true
			}
			return isOriginAllowed(origin, buildAllowedOrigins())
		},
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[ws] upgrade failed: %v", err)
		return
	}

	client := &WSClient{
		id:   randomID(8),
		conn: conn,
	}
	a.registerClient(client)
	defer a.unregisterClient(client)

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var message WSMessage
		if err := json.Unmarshal(data, &message); err != nil {
			a.send(client.id, WSMessage{Type: "room:error", Payload: marshalPayload(ErrorPayload{Message: "invalid message"})})
			continue
		}
		a.handleWSMessage(client, message)
	}
}

func (a *App) registerClient(client *WSClient) {
	a.clientsMu.Lock()
	defer a.clientsMu.Unlock()
	a.clients[client.id] = client
}

func (a *App) unregisterClient(client *WSClient) {
	a.clientsMu.Lock()
	delete(a.clients, client.id)
	a.clientsMu.Unlock()

	roomID, role, info, wasHost := a.rooms.RemoveSocket(client.id)
	if roomID == "" {
		return
	}
	if wasHost {
		a.broadcastToRoom(roomID, a.rooms.ClientSocketIDs(roomID), WSMessage{
			Type:    "room:closed",
			Payload: marshalPayload(ErrorPayload{Message: "Host disconnected"}),
		})
		return
	}
	if role == "client" && info != nil {
		hostID := a.rooms.HostSocket(roomID)
		a.send(hostID, WSMessage{
			Type: "room:client_left",
			Payload: marshalPayload(RoomClientLeftPayload{
				RoomID:   roomID,
				PlayerID: info.PlayerID,
				SocketID: client.id,
			}),
		})
	}
}

func (a *App) handleWSMessage(client *WSClient, message WSMessage) {
	switch message.Type {
	case "room:create":
		var payload RoomCreatePayload
		if err := json.Unmarshal(message.Payload, &payload); err != nil {
			a.send(client.id, WSMessage{Type: "room:error", Payload: marshalPayload(ErrorPayload{Message: "invalid payload"})})
			return
		}
		if payload.RoomID == "" {
			a.send(client.id, WSMessage{Type: "room:error", Payload: marshalPayload(ErrorPayload{Message: "roomId is required"})})
			return
		}
		if payload.PlayerID == "" {
			payload.PlayerID = randomID(8)
		}
		if payload.PlayerName == "" {
			payload.PlayerName = "Host"
		}
		if err := a.rooms.Create(payload.RoomID, payload, client.id); err != nil {
			a.send(client.id, WSMessage{Type: "room:error", Payload: marshalPayload(ErrorPayload{Message: err.Error()})})
			return
		}
		a.send(client.id, WSMessage{
			Type: "room:created",
			Payload: marshalPayload(RoomClientJoinedPayload{
				RoomID:     payload.RoomID,
				PlayerID:   payload.PlayerID,
				PlayerName: payload.PlayerName,
				SocketID:   client.id,
			}),
		})
	case "room:join":
		var payload RoomJoinPayload
		if err := json.Unmarshal(message.Payload, &payload); err != nil {
			a.send(client.id, WSMessage{Type: "room:error", Payload: marshalPayload(ErrorPayload{Message: "invalid payload"})})
			return
		}
		if payload.RoomID == "" {
			a.send(client.id, WSMessage{Type: "room:error", Payload: marshalPayload(ErrorPayload{Message: "roomId is required"})})
			return
		}
		if payload.PlayerID == "" {
			payload.PlayerID = randomID(8)
		}
		if payload.PlayerName == "" {
			payload.PlayerName = "Player"
		}
		if _, err := a.rooms.Join(payload.RoomID, payload, client.id); err != nil {
			a.send(client.id, WSMessage{Type: "room:error", Payload: marshalPayload(ErrorPayload{Message: err.Error()})})
			return
		}
		a.send(client.id, WSMessage{
			Type: "room:joined",
			Payload: marshalPayload(RoomClientJoinedPayload{
				RoomID:     payload.RoomID,
				PlayerID:   payload.PlayerID,
				PlayerName: payload.PlayerName,
				SocketID:   client.id,
			}),
		})
		hostID := a.rooms.HostSocket(payload.RoomID)
		a.send(hostID, WSMessage{
			Type: "room:client_joined",
			Payload: marshalPayload(RoomClientJoinedPayload{
				RoomID:     payload.RoomID,
				PlayerID:   payload.PlayerID,
				PlayerName: payload.PlayerName,
				SocketID:   client.id,
			}),
		})
	case "room:client_message":
		var payload RoomClientMessagePayload
		if err := json.Unmarshal(message.Payload, &payload); err != nil {
			a.send(client.id, WSMessage{Type: "room:error", Payload: marshalPayload(ErrorPayload{Message: "invalid payload"})})
			return
		}
		if payload.RoomID == "" {
			a.send(client.id, WSMessage{Type: "room:error", Payload: marshalPayload(ErrorPayload{Message: "roomId is required"})})
			return
		}
		info, _ := a.rooms.ClientInfo(payload.RoomID, client.id)
		hostID := a.rooms.HostSocket(payload.RoomID)
		a.send(hostID, WSMessage{
			Type: "room:client_message",
			Payload: marshalPayload(map[string]interface{}{
				"roomId":     payload.RoomID,
				"socketId":   client.id,
				"playerId":   info.PlayerID,
				"playerName": info.PlayerName,
				"message":    payload.Message,
			}),
		})
	case "room:host_message":
		var payload RoomHostMessagePayload
		if err := json.Unmarshal(message.Payload, &payload); err != nil {
			a.send(client.id, WSMessage{Type: "room:error", Payload: marshalPayload(ErrorPayload{Message: "invalid payload"})})
			return
		}
		if payload.RoomID == "" {
			a.send(client.id, WSMessage{Type: "room:error", Payload: marshalPayload(ErrorPayload{Message: "roomId is required"})})
			return
		}
		if payload.TargetSocketID != "" {
			a.send(payload.TargetSocketID, WSMessage{
				Type:    "room:host_message",
				Payload: marshalPayload(payload.Message),
			})
			return
		}
		clients := a.rooms.ClientSocketIDs(payload.RoomID)
		a.broadcastToRoom(payload.RoomID, clients, WSMessage{
			Type:    "room:host_message",
			Payload: marshalPayload(payload.Message),
		})
	case "room:save_event":
		var payload RoomEventPayload
		if err := json.Unmarshal(message.Payload, &payload); err != nil {
			a.send(client.id, WSMessage{Type: "room:error", Payload: marshalPayload(ErrorPayload{Message: "invalid payload"})})
			return
		}
		if payload.RoomID == "" || strings.TrimSpace(payload.EventType) == "" || payload.EventData == nil {
			a.send(client.id, WSMessage{Type: "room:error", Payload: marshalPayload(ErrorPayload{Message: "roomId, eventType, and eventData are required"})})
			return
		}
		if err := a.storeRoomEvent(payload); err != nil {
			a.send(client.id, WSMessage{Type: "room:error", Payload: marshalPayload(ErrorPayload{Message: "failed to save event"})})
			return
		}
	default:
		a.send(client.id, WSMessage{Type: "room:error", Payload: marshalPayload(ErrorPayload{Message: "unknown message"})})
	}
}

func (a *App) send(socketID string, message WSMessage) {
	if socketID == "" {
		return
	}
	a.clientsMu.RLock()
	client := a.clients[socketID]
	a.clientsMu.RUnlock()
	if client == nil {
		return
	}
	payload, err := json.Marshal(message)
	if err != nil {
		return
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	_ = client.conn.WriteMessage(websocket.TextMessage, payload)
}

func (a *App) broadcastToRoom(_ string, socketIDs []string, message WSMessage) {
	for _, id := range socketIDs {
		a.send(id, message)
	}
}

func marshalPayload(payload interface{}) json.RawMessage {
	data, err := json.Marshal(payload)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return data
}

func (a *App) registerRoutes() {
	r := a.router

	r.Get("/health", a.handleHealth)

	r.Post("/register", a.handleRegister)
	r.Post("/login", a.handleLogin)
	r.Post("/logout", a.requireAuth(a.handleLogout))
	r.Get("/me", a.optionalAuth(a.handleMe))

	r.Get("/decks", a.requireAuth(a.handleDecks))
	r.Get("/decks/public", a.handlePublicDecks)
	r.Post("/decks", a.requireAuth(a.handleCreateDeck))
	r.Delete("/decks/{id}", a.requireAuth(a.handleDeleteDeck))

	r.Get("/cards/search", a.handleCardSearch)
	r.Get("/cards/prints", a.handleCardPrints)
	r.Get("/cards/{setCode}/{collectorNumber}", a.handleCardCollector)
	r.Post("/cards/batch", a.handleCardsBatch)

	r.Post("/api/rooms/{roomId}/state", a.handleSaveRoomState)
	r.Get("/api/rooms/{roomId}/state", a.handleLoadRoomState)
	r.Post("/api/rooms/{roomId}/events", a.handleSaveRoomEvent)
	r.Get("/api/rooms/{roomId}/events", a.handleLoadRoomEvents)
}

func (a *App) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status":    "ok",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

type authContextKey struct{}

type User struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}

func (a *App) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, err := a.userFromRequest(r)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		ctx := context.WithValue(r.Context(), authContextKey{}, user)
		next(w, r.WithContext(ctx))
	}
}

func (a *App) optionalAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := a.userFromRequest(r)
		ctx := context.WithValue(r.Context(), authContextKey{}, user)
		next(w, r.WithContext(ctx))
	}
}

func (a *App) userFromRequest(r *http.Request) (*User, error) {
	cookie, err := r.Cookie(cookieName)
	if err != nil || cookie.Value == "" {
		return nil, errors.New("Not authenticated")
	}
	var user User
	row := a.db.QueryRow(`SELECT id, username FROM users WHERE session_id = ?`, cookie.Value)
	if err := row.Scan(&user.ID, &user.Username); err != nil {
		return nil, errors.New("Invalid session")
	}
	return &user, nil
}

func (a *App) currentUser(r *http.Request) *User {
	user, _ := r.Context().Value(authContextKey{}).(*User)
	return user
}

type authPayload struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (a *App) handleRegister(w http.ResponseWriter, r *http.Request) {
	var payload authPayload
	if err := decodeJSON(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request"})
		return
	}
	if strings.TrimSpace(payload.Username) == "" || strings.TrimSpace(payload.Password) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Username and password are required"})
		return
	}
	if len(payload.Username) < 3 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Username must be at least 3 characters"})
		return
	}
	if len(payload.Password) < 4 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Password must be at least 4 characters"})
		return
	}
	sessionID := randomID(32)
	passwordHash := hashPassword(payload.Password)
	result, err := a.db.Exec(`
		INSERT INTO users (username, password_hash, session_id)
		VALUES (?, ?, ?)
	`, payload.Username, passwordHash, sessionID)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Username already exists"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Registration failed"})
		return
	}
	userID, _ := result.LastInsertId()
	setSessionCookie(w, sessionID)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"user": map[string]interface{}{
			"id":       userID,
			"username": payload.Username,
		},
	})
}

func (a *App) handleLogin(w http.ResponseWriter, r *http.Request) {
	var payload authPayload
	if err := decodeJSON(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request"})
		return
	}
	if strings.TrimSpace(payload.Username) == "" || strings.TrimSpace(payload.Password) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Username and password are required"})
		return
	}
	passwordHash := hashPassword(payload.Password)
	var user User
	row := a.db.QueryRow(`SELECT id, username FROM users WHERE username = ? AND password_hash = ?`, payload.Username, passwordHash)
	if err := row.Scan(&user.ID, &user.Username); err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid credentials"})
		return
	}
	sessionID := randomID(32)
	if _, err := a.db.Exec(`UPDATE users SET session_id = ? WHERE id = ?`, sessionID, user.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Login failed"})
		return
	}
	setSessionCookie(w, sessionID)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"user": user,
	})
}

func (a *App) handleLogout(w http.ResponseWriter, r *http.Request) {
	user := a.currentUser(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not authenticated"})
		return
	}
	_, _ = a.db.Exec(`UPDATE users SET session_id = NULL WHERE id = ?`, user.ID)
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    "",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Path:     "/",
	})
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (a *App) handleMe(w http.ResponseWriter, r *http.Request) {
	user := a.currentUser(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not authenticated"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"user": user,
	})
}

type deckRow struct {
	ID        string
	Name      string
	RawText   string
	Entries   string
	IsPublic  int
	CreatedAt string
}

func (a *App) handleDecks(w http.ResponseWriter, r *http.Request) {
	user := a.currentUser(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not authenticated"})
		return
	}
	rows, err := a.db.Query(`
		SELECT id, name, raw_text, entries, is_public, created_at
		FROM decks
		WHERE user_id = ?
		ORDER BY created_at DESC
	`, user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to load decks"})
		return
	}
	defer rows.Close()
	var decks []map[string]interface{}
	for rows.Next() {
		var row deckRow
		if err := rows.Scan(&row.ID, &row.Name, &row.RawText, &row.Entries, &row.IsPublic, &row.CreatedAt); err != nil {
			continue
		}
		deck := map[string]interface{}{
			"id":        row.ID,
			"name":      row.Name,
			"rawText":   row.RawText,
			"entries":   json.RawMessage(row.Entries),
			"isPublic":  row.IsPublic == 1,
			"createdAt": row.CreatedAt,
		}
		decks = append(decks, deck)
	}
	writeJSON(w, http.StatusOK, decks)
}

func (a *App) handlePublicDecks(w http.ResponseWriter, r *http.Request) {
	limit := parseIntDefault(r.URL.Query().Get("limit"), 50)
	if limit > 100 {
		limit = 100
	}
	offset := parseIntDefault(r.URL.Query().Get("offset"), 0)
	rows, err := a.db.Query(`
		SELECT d.id, d.name, d.raw_text, d.entries, d.created_at, u.username as author
		FROM decks d
		JOIN users u ON d.user_id = u.id
		WHERE d.is_public = 1
		ORDER BY d.created_at DESC
		LIMIT ? OFFSET ?
	`, limit, offset)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to load decks"})
		return
	}
	defer rows.Close()
	var decks []map[string]interface{}
	for rows.Next() {
		var id, name, rawText, entries, createdAt, author string
		if err := rows.Scan(&id, &name, &rawText, &entries, &createdAt, &author); err != nil {
			continue
		}
		decks = append(decks, map[string]interface{}{
			"id":        id,
			"name":      name,
			"rawText":   rawText,
			"entries":   json.RawMessage(entries),
			"createdAt": createdAt,
			"author":    author,
		})
	}
	writeJSON(w, http.StatusOK, decks)
}

type createDeckPayload struct {
	Name     string          `json:"name"`
	Entries  json.RawMessage `json:"entries"`
	RawText  string          `json:"rawText"`
	IsPublic bool            `json:"isPublic"`
}

func (a *App) handleCreateDeck(w http.ResponseWriter, r *http.Request) {
	user := a.currentUser(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not authenticated"})
		return
	}
	var payload createDeckPayload
	if err := decodeJSON(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request"})
		return
	}
	if strings.TrimSpace(payload.Name) == "" || payload.Entries == nil || strings.TrimSpace(payload.RawText) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Name, entries, and rawText are required"})
		return
	}
	id := randomID(16)
	isPublicInt := 0
	if payload.IsPublic {
		isPublicInt = 1
	}
	if _, err := a.db.Exec(`
		INSERT INTO decks (id, user_id, name, raw_text, entries, is_public)
		VALUES (?, ?, ?, ?, ?, ?)
	`, id, user.ID, payload.Name, payload.RawText, string(payload.Entries), isPublicInt); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to save deck"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"id":        id,
		"name":      payload.Name,
		"rawText":   payload.RawText,
		"entries":   payload.Entries,
		"isPublic":  payload.IsPublic,
		"createdAt": time.Now().UTC().Format(time.RFC3339),
	})
}

func (a *App) handleDeleteDeck(w http.ResponseWriter, r *http.Request) {
	user := a.currentUser(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not authenticated"})
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Deck id is required"})
		return
	}
	result, err := a.db.Exec(`DELETE FROM decks WHERE id = ? AND user_id = ?`, id, user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to delete deck"})
		return
	}
	changes, _ := result.RowsAffected()
	if changes == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Deck not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

type cardRow struct {
	ID              string
	Name            string
	NameNormalized  string
	TypeLine        sql.NullString
	ManaCost        sql.NullString
	OracleText      sql.NullString
	ImageURL        sql.NullString
	BackImageURL    sql.NullString
	SetName         sql.NullString
	SetCode         sql.NullString
	CollectorNumber sql.NullString
	PrintsSearchURI sql.NullString
}

type cardResponse struct {
	Name         string  `json:"name"`
	OracleText   *string `json:"oracleText"`
	ManaCost     *string `json:"manaCost"`
	TypeLine     *string `json:"typeLine"`
	ImageURL     *string `json:"imageUrl,omitempty"`
	BackImageURL *string `json:"backImageUrl,omitempty"`
	SetName      *string `json:"setName,omitempty"`
	SetCode      *string `json:"setCode,omitempty"`
	CollectorNumber *string `json:"collectorNumber,omitempty"`
	PrintsSearchURI *string `json:"printsSearchUri,omitempty"`
}

type cardPrintRow struct {
	Name            string
	SetCode         sql.NullString
	CollectorNumber sql.NullString
	SetName         sql.NullString
	ImageURL        sql.NullString
	BackImageURL    sql.NullString
}

type cardPrintResponse struct {
	Name            string  `json:"name"`
	SetCode         *string `json:"setCode,omitempty"`
	CollectorNumber *string `json:"collectorNumber,omitempty"`
	SetName         *string `json:"setName,omitempty"`
	ImageURL        *string `json:"imageUrl,omitempty"`
	BackImageURL    *string `json:"backImageUrl,omitempty"`
}

func (a *App) handleCardSearch(w http.ResponseWriter, r *http.Request) {
	if !a.ensureCardsAvailable() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Cards data not loaded. Ensure cards.json is available and restart the Go backend."})
		return
	}
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name parameter is required"})
		return
	}
	setCode := strings.TrimSpace(r.URL.Query().Get("set"))
	queryLower := strings.ToLower(name)
	setLower := ""
	if setCode != "" {
		setLower = strings.ToLower(setCode)
	}
	card, err := a.findCardByName(queryLower, setLower)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Card not found"})
		return
	}
	writeJSON(w, http.StatusOK, cardRowToResponse(card))
}

func (a *App) handleCardPrints(w http.ResponseWriter, r *http.Request) {
	if !a.ensureCardsAvailable() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Cards data not loaded. Ensure cards.json is available and restart the Go backend."})
		return
	}
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name parameter is required"})
		return
	}
	queryLower := strings.ToLower(name)
	best, err := a.findCardByName(queryLower, "")
	if err != nil || best == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Card not found"})
		return
	}
	rows, err := a.db.Query(`
		SELECT name, set_code, collector_number, set_name, image_url, back_image_url
		FROM cards
		WHERE name_normalized = ?
		ORDER BY set_code, collector_number
		LIMIT 500
	`, best.NameNormalized)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch prints"})
		return
	}
	defer rows.Close()

	results := make([]cardPrintResponse, 0, 64)
	for rows.Next() {
		var row cardPrintRow
		if err := rows.Scan(&row.Name, &row.SetCode, &row.CollectorNumber, &row.SetName, &row.ImageURL, &row.BackImageURL); err != nil {
			continue
		}
		results = append(results, cardPrintResponse{
			Name:            row.Name,
			SetCode:         nullStringToPtr(row.SetCode),
			CollectorNumber: nullStringToPtr(row.CollectorNumber),
			SetName:         nullStringToPtr(row.SetName),
			ImageURL:        nullStringToPtr(row.ImageURL),
			BackImageURL:    nullStringToPtr(row.BackImageURL),
		})
	}
	writeJSON(w, http.StatusOK, results)
}

func (a *App) handleCardCollector(w http.ResponseWriter, r *http.Request) {
	if !a.ensureCardsAvailable() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Cards data not loaded. Ensure cards.json is available and restart the Go backend."})
		return
	}
	setCode := chi.URLParam(r, "setCode")
	collectorNumber := chi.URLParam(r, "collectorNumber")
	if setCode == "" || collectorNumber == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "setCode and collectorNumber are required"})
		return
	}
	card, err := a.selectBySetCollector(strings.ToLower(setCode), collectorNumber)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Card not found"})
		return
	}
	writeJSON(w, http.StatusOK, cardRowToResponse(card))
}

type batchRequest struct {
	Cards []struct {
		Name            string `json:"name"`
		SetCode         string `json:"setCode"`
		CollectorNumber string `json:"collectorNumber"`
	} `json:"cards"`
}

func (a *App) handleCardsBatch(w http.ResponseWriter, r *http.Request) {
	if !a.ensureCardsAvailable() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Cards data not loaded. Ensure cards.json is available and restart the Go backend."})
		return
	}
	var payload batchRequest
	if err := decodeJSON(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request"})
		return
	}
	if payload.Cards == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cards must be an array"})
		return
	}
	results := make([]interface{}, 0, len(payload.Cards))
	for _, request := range payload.Cards {
		if request.Name == "" && (request.SetCode == "" || request.CollectorNumber == "") {
			results = append(results, map[string]interface{}{
				"error":   "name or (setCode and collectorNumber) required",
				"request": request,
			})
			continue
		}
		var card *cardRow
		var err error
		if request.SetCode != "" && request.CollectorNumber != "" {
			card, err = a.selectBySetCollector(strings.ToLower(request.SetCode), request.CollectorNumber)
		}
		if (card == nil || err != nil) && request.Name != "" {
			card, err = a.findCardByName(strings.ToLower(strings.TrimSpace(request.Name)), strings.ToLower(request.SetCode))
		}
		if err != nil || card == nil {
			results = append(results, map[string]interface{}{
				"error":   "Card not found",
				"request": request,
			})
			continue
		}
		results = append(results, cardRowToResponse(card))
	}
	writeJSON(w, http.StatusOK, results)
}

type roomStatePayload struct {
	Board             json.RawMessage `json:"board"`
	Counters          json.RawMessage `json:"counters"`
	Players           json.RawMessage `json:"players"`
	CemeteryPositions json.RawMessage `json:"cemeteryPositions"`
	LibraryPositions  json.RawMessage `json:"libraryPositions"`
}

func (a *App) handleSaveRoomState(w http.ResponseWriter, r *http.Request) {
	roomID := chi.URLParam(r, "roomId")
	if roomID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "roomId is required"})
		return
	}
	var payload roomStatePayload
	if err := decodeJSON(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request"})
		return
	}
	state := roomStatePayload{
		Board:             ensureJSONDefault(payload.Board, []byte("[]")),
		Counters:          ensureJSONDefault(payload.Counters, []byte("[]")),
		Players:           ensureJSONDefault(payload.Players, []byte("[]")),
		CemeteryPositions: ensureJSONDefault(payload.CemeteryPositions, []byte("{}")),
		LibraryPositions:  ensureJSONDefault(payload.LibraryPositions, []byte("{}")),
	}
	stateJSON, _ := json.Marshal(state)
	_, err := a.db.Exec(`
		INSERT INTO rooms (room_id, board_state, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(room_id) DO UPDATE SET
			board_state = excluded.board_state,
			updated_at = CURRENT_TIMESTAMP
	`, roomID, string(stateJSON))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to save room state"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

type roomEventPayload struct {
	EventType  string          `json:"eventType"`
	EventData  json.RawMessage `json:"eventData"`
	PlayerID   string          `json:"playerId"`
	PlayerName string          `json:"playerName"`
}

func (a *App) handleSaveRoomEvent(w http.ResponseWriter, r *http.Request) {
	roomID := chi.URLParam(r, "roomId")
	if roomID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "roomId is required"})
		return
	}
	var payload RoomEventPayload
	if err := decodeJSON(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request"})
		return
	}
	payload.RoomID = roomID
	if strings.TrimSpace(payload.EventType) == "" || payload.EventData == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "roomId, eventType, and eventData are required"})
		return
	}
	if err := a.storeRoomEvent(payload); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to save event"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (a *App) storeRoomEvent(payload RoomEventPayload) error {
	_, _ = a.db.Exec(`
		INSERT INTO rooms (room_id, board_state, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(room_id) DO NOTHING
	`, payload.RoomID, "{}")
	_, err := a.db.Exec(`
		INSERT INTO room_events (room_id, event_type, event_data, player_id, player_name)
		VALUES (?, ?, ?, ?, ?)
	`, payload.RoomID, payload.EventType, string(payload.EventData), nullIfEmpty(payload.PlayerID), nullIfEmpty(payload.PlayerName))
	return err
}

func (a *App) handleLoadRoomEvents(w http.ResponseWriter, r *http.Request) {
	roomID := chi.URLParam(r, "roomId")
	if roomID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "roomId is required"})
		return
	}
	rows, err := a.db.Query(`
		SELECT id, event_type, event_data, player_id, player_name, created_at
		FROM room_events
		WHERE room_id = ?
		ORDER BY created_at ASC, id ASC
	`, roomID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to load events"})
		return
	}
	defer rows.Close()
	var events []map[string]interface{}
	for rows.Next() {
		var id int64
		var eventType, eventData, createdAt string
		var playerID, playerName sql.NullString
		if err := rows.Scan(&id, &eventType, &eventData, &playerID, &playerName, &createdAt); err != nil {
			continue
		}
		event := map[string]interface{}{
			"id":         id,
			"eventType":  eventType,
			"eventData":  json.RawMessage(eventData),
			"playerId":   nullStringToPtr(playerID),
			"playerName": nullStringToPtr(playerName),
			"createdAt":  createdAt,
		}
		events = append(events, event)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"events": events,
	})
}

func (a *App) handleLoadRoomState(w http.ResponseWriter, r *http.Request) {
	roomID := chi.URLParam(r, "roomId")
	if roomID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "roomId is required"})
		return
	}
	var stateJSON string
	row := a.db.QueryRow(`SELECT board_state FROM rooms WHERE room_id = ?`, roomID)
	if err := row.Scan(&stateJSON); err != nil {
		defaultState := roomStatePayload{
			Board:             []byte("[]"),
			Counters:          []byte("[]"),
			Players:           []byte("[]"),
			CemeteryPositions: []byte("{}"),
			LibraryPositions:  []byte("{}"),
		}
		writeJSON(w, http.StatusOK, defaultState)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(stateJSON))
}

func (a *App) ensureCardsAvailable() bool {
	row := a.db.QueryRow(`SELECT 1 FROM cards LIMIT 1`)
	var exists int
	if err := row.Scan(&exists); err != nil {
		return false
	}
	return true
}

func (a *App) findCardByName(queryLower string, setLower string) (*cardRow, error) {
	var rows []*cardRow
	var err error
	if setLower != "" {
		rows, err = a.selectExactNameAndSet(queryLower, setLower)
	} else {
		rows, err = a.selectExactName(queryLower)
	}
	if err == nil && len(rows) > 0 {
		return rows[0], nil
	}
	pattern := "%" + escapeLikePattern(queryLower) + "%"
	if setLower != "" {
		rows, err = a.selectLikeNameAndSet(pattern, setLower, queryLower)
	} else {
		rows, err = a.selectLikeName(pattern, queryLower)
	}
	if err != nil || len(rows) == 0 {
		return nil, errors.New("not found")
	}
	best := rows[0]
	bestScore := fuzzyMatch(queryLower, rows[0].NameNormalized)
	for _, row := range rows[1:] {
		score := fuzzyMatch(queryLower, row.NameNormalized)
		if score > bestScore {
			best = row
			bestScore = score
		}
	}
	if bestScore == 0 {
		return rows[0], nil
	}
	return best, nil
}

func (a *App) selectExactName(queryLower string) ([]*cardRow, error) {
	rows, err := a.db.Query(`
		SELECT id, name, name_normalized, type_line, mana_cost, oracle_text, image_url, back_image_url, set_name, set_code, collector_number, prints_search_uri
		FROM cards
		WHERE name_normalized = ?
		ORDER BY set_code, collector_number
		LIMIT 25
	`, queryLower)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCardRows(rows), nil
}

func (a *App) selectExactNameAndSet(queryLower string, setLower string) ([]*cardRow, error) {
	rows, err := a.db.Query(`
		SELECT id, name, name_normalized, type_line, mana_cost, oracle_text, image_url, back_image_url, set_name, set_code, collector_number, prints_search_uri
		FROM cards
		WHERE name_normalized = ?
		  AND set_code = ?
		ORDER BY collector_number
		LIMIT 25
	`, queryLower, setLower)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCardRows(rows), nil
}

func (a *App) selectLikeName(pattern string, queryLower string) ([]*cardRow, error) {
	rows, err := a.db.Query(`
		SELECT id, name, name_normalized, type_line, mana_cost, oracle_text, image_url, back_image_url, set_name, set_code, collector_number, prints_search_uri
		FROM cards
		WHERE name_normalized LIKE ? ESCAPE '\'
		ORDER BY INSTR(name_normalized, ?) ASC, name ASC
		LIMIT 100
	`, pattern, queryLower)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCardRows(rows), nil
}

func (a *App) selectLikeNameAndSet(pattern string, setLower string, queryLower string) ([]*cardRow, error) {
	rows, err := a.db.Query(`
		SELECT id, name, name_normalized, type_line, mana_cost, oracle_text, image_url, back_image_url, set_name, set_code, collector_number, prints_search_uri
		FROM cards
		WHERE name_normalized LIKE ? ESCAPE '\'
		  AND set_code = ?
		ORDER BY INSTR(name_normalized, ?) ASC, collector_number
		LIMIT 100
	`, pattern, setLower, queryLower)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCardRows(rows), nil
}

func (a *App) selectBySetCollector(setCode string, collectorNumber string) (*cardRow, error) {
	row := a.db.QueryRow(`
		SELECT id, name, name_normalized, type_line, mana_cost, oracle_text, image_url, back_image_url, set_name, set_code, collector_number, prints_search_uri
		FROM cards
		WHERE set_code = ? AND collector_number = ?
		LIMIT 1
	`, setCode, collectorNumber)
	var card cardRow
	if err := row.Scan(&card.ID, &card.Name, &card.NameNormalized, &card.TypeLine, &card.ManaCost, &card.OracleText, &card.ImageURL, &card.BackImageURL, &card.SetName, &card.SetCode, &card.CollectorNumber, &card.PrintsSearchURI); err != nil {
		return nil, err
	}
	return &card, nil
}

func scanCardRows(rows *sql.Rows) []*cardRow {
	var results []*cardRow
	for rows.Next() {
		var card cardRow
		if err := rows.Scan(&card.ID, &card.Name, &card.NameNormalized, &card.TypeLine, &card.ManaCost, &card.OracleText, &card.ImageURL, &card.BackImageURL, &card.SetName, &card.SetCode, &card.CollectorNumber, &card.PrintsSearchURI); err != nil {
			continue
		}
		results = append(results, &card)
	}
	return results
}

func cardRowToResponse(card *cardRow) cardResponse {
	response := cardResponse{
		Name:       card.Name,
		OracleText: nullStringToPtr(card.OracleText),
		ManaCost:   nullStringToPtr(card.ManaCost),
		TypeLine:   nullStringToPtr(card.TypeLine),
	}
	if card.ImageURL.Valid {
		response.ImageURL = &card.ImageURL.String
	}
	if card.BackImageURL.Valid {
		response.BackImageURL = &card.BackImageURL.String
	}
	if card.SetName.Valid {
		response.SetName = &card.SetName.String
	} else if card.SetCode.Valid {
		response.SetName = &card.SetCode.String
	}
	if card.SetCode.Valid {
		response.SetCode = &card.SetCode.String
	}
	if card.CollectorNumber.Valid {
		response.CollectorNumber = &card.CollectorNumber.String
	}
	if card.PrintsSearchURI.Valid {
		response.PrintsSearchURI = &card.PrintsSearchURI.String
	}
	return response
}

func (a *App) corsMiddleware(next http.Handler) http.Handler {
	allowedOrigins := buildAllowedOrigins()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && isOriginAllowed(origin, allowedOrigins) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func buildAllowedOrigins() []string {
	clientHost := os.Getenv("VITE_CLIENT_HOST")
	if clientHost == "" {
		clientHost = "localhost"
	}
	clientPort := os.Getenv("VITE_CLIENT_PORT")
	if clientPort == "" {
		clientPort = "5173"
	}
	return []string{
		fmt.Sprintf("http://%s:%s", clientHost, clientPort),
		fmt.Sprintf("http://localhost:%s", clientPort),
		fmt.Sprintf("http://127.0.0.1:%s", clientPort),
		"https://mto.mesmer.tv",
		"http://mto.mesmer.tv",
		"https://www.mto.mesmer.tv",
		"http://www.mto.mesmer.tv",
	}
}

func isOriginAllowed(origin string, allowed []string) bool {
	for _, entry := range allowed {
		if origin == entry {
			return true
		}
	}
	return strings.HasPrefix(origin, "http://localhost:") || strings.HasPrefix(origin, "http://127.0.0.1:")
}

func resolvePort(primary string, fallback string, defaultValue string) string {
	if value := strings.TrimSpace(os.Getenv(primary)); value != "" {
		return value
	}
	if value := strings.TrimSpace(os.Getenv(fallback)); value != "" {
		return value
	}
	return defaultValue
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func decodeJSON(r *http.Request, target interface{}) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func randomID(bytesLen int) string {
	buf := make([]byte, bytesLen)
	if _, err := rand.Read(buf); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 10)
	}
	return hex.EncodeToString(buf)
}

func hashPassword(password string) string {
	sum := sha256.Sum256([]byte(password))
	return hex.EncodeToString(sum[:])
}

func setSessionCookie(w http.ResponseWriter, value string) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    value,
		HttpOnly: true,
		MaxAge:   30 * 24 * 60 * 60,
		SameSite: http.SameSiteLaxMode,
		Path:     "/",
	})
}

func parseIntDefault(value string, fallback int) int {
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func escapeLikePattern(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "%", "\\%")
	value = strings.ReplaceAll(value, "_", "\\_")
	return value
}

func fuzzyMatch(query string, target string) float64 {
	queryLower := strings.ToLower(query)
	targetLower := strings.ToLower(target)
	if targetLower == queryLower {
		return 100
	}
	if strings.HasPrefix(targetLower, queryLower) {
		return 90
	}
	if strings.Contains(targetLower, queryLower) {
		return 70
	}
	queryWords := strings.Fields(queryLower)
	targetWords := strings.Fields(targetLower)
	matches := 0
	for _, qWord := range queryWords {
		for _, tWord := range targetWords {
			if strings.Contains(tWord, qWord) || strings.Contains(qWord, tWord) {
				matches++
				break
			}
		}
	}
	if matches > 0 && len(queryWords) > 0 {
		return (float64(matches) / float64(len(queryWords))) * 50
	}
	return 0
}

func ensureJSONDefault(value json.RawMessage, fallback []byte) json.RawMessage {
	if value == nil || len(value) == 0 {
		return fallback
	}
	return value
}

func nullIfEmpty(value string) interface{} {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func nullStringToPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func hostRoom(roomID string) string {
	return "room:" + roomID + ":host"
}

func clientRoom(roomID string) string {
	return "room:" + roomID + ":clients"
}

func targetRoom(roomID string, socketID string) string {
	return "room:" + roomID + ":client:" + socketID
}
