package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	port                   = getEnvAsInt("PORT", 8080)
	defaultSessionTTLSecs  = getEnvAsInt("DEFAULT_SESSION_TTL_SECONDS", 180)
	maxSessionTTLSecs      = getEnvAsInt("MAX_SESSION_TTL_SECONDS", 900)
	maxPayloadBytes        = getEnvAsInt("MAX_PAYLOAD_BYTES", 8192)
	maxQueueMessages       = getEnvAsInt("MAX_QUEUE_MESSAGES", 32)
	sessionSweepMs         = getEnvAsInt("SESSION_SWEEP_MS", 30000)
	allowedOrigins         []string
	allowedOriginsIncludesAny bool
)

func getEnvAsInt(key string, fallback int) int {
	if val, ok := os.LookupEnv(key); ok {
		if intVal, err := strconv.Atoi(val); err == nil {
			return intVal
		}
	}
	return fallback
}

func init() {
	rawOrigins := os.Getenv("ALLOWED_ORIGINS")
	if strings.TrimSpace(rawOrigins) == "" {
		allowedOriginsIncludesAny = true
		allowedOrigins = []string{"*"}
		return
	}

	parts := strings.Split(rawOrigins, ",")
	for _, p := range parts {
		trimmed := strings.TrimSpace(p)
		if trimmed != "" {
			if trimmed == "*" {
				allowedOriginsIncludesAny = true
			}
			allowedOrigins = append(allowedOrigins, trimmed)
		}
	}
	if len(allowedOrigins) == 0 {
		allowedOriginsIncludesAny = true
		allowedOrigins = []string{"*"}
	}
}

type Message struct {
	ID        string      `json:"id"`
	CreatedAt int64       `json:"createdAt"`
	Payload   interface{} `json:"payload"`
}

type Session struct {
	sync.Mutex
	ReadToken   string
	WriteToken  string
	ExpiresAtMs int64
	Queue       []Message
}

var (
	sessions sync.Map
)

func randomToken(bytes int) string {
	b := make([]byte, bytes)
	_, err := rand.Read(b)
	if err != nil {
		log.Printf("Error generating random token: %v", err)
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func nowMs() int64 {
	return time.Now().UnixMilli()
}

func cleanupExpiredSessions() {
	for {
		time.Sleep(time.Duration(sessionSweepMs) * time.Millisecond)
		now := nowMs()
		sessions.Range(func(key, value interface{}) bool {
			sess := value.(*Session)
			if now > sess.ExpiresAtMs {
				sessions.Delete(key)
			}
			return true
		})
	}
}

func getSession(sessionID string) (*Session, int, string) {
	val, ok := sessions.Load(sessionID)
	if !ok {
		return nil, http.StatusNotFound, "Session not found."
	}
	sess := val.(*Session)

	if nowMs() > sess.ExpiresAtMs {
		sessions.Delete(sessionID)
		return nil, http.StatusGone, "Session expired."
	}

	return sess, 0, ""
}

func updateSession(sessionID string, sess *Session) {
	sessions.Store(sessionID, sess)
}

func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		allowedOrigin := ""
		if allowedOriginsIncludesAny && origin != "" {
			allowedOrigin = origin
		} else if allowedOriginsIncludesAny {
			allowedOrigin = "*"
		} else if origin != "" {
			for _, o := range allowedOrigins {
				if o == origin {
					allowedOrigin = origin
					break
				}
			}
		}

		if allowedOrigin != "" {
			w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
		} else if !allowedOriginsIncludesAny && origin != "" {
			http.Error(w, `{"error":"Origin not allowed."}`, http.StatusForbidden)
			return
		}

		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next(w, r)
	}
}

func handleCreateSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		TTLSeconds *float64 `json:"ttlSeconds"`
	}

	// Limit body read to avoid abuse
	r.Body = http.MaxBytesReader(w, r.Body, 32*1024)
	_ = json.NewDecoder(r.Body).Decode(&reqBody) // Ignore errors, use defaults if missing

	ttlSeconds := defaultSessionTTLSecs
	if reqBody.TTLSeconds != nil {
		val := int(*reqBody.TTLSeconds)
		if val < 30 {
			val = 30
		} else if val > maxSessionTTLSecs {
			val = maxSessionTTLSecs
		}
		ttlSeconds = val
	}

	sessionID := randomToken(12)
	readToken := randomToken(24)
	writeToken := randomToken(24)
	expiresAtMs := nowMs() + int64(ttlSeconds*1000)
	expiresAt := time.UnixMilli(expiresAtMs).UTC().Format(time.RFC3339Nano)

	sess := &Session{
		ReadToken:   readToken,
		WriteToken:  writeToken,
		ExpiresAtMs: expiresAtMs,
		Queue:       make([]Message, 0),
	}
	sessions.Store(sessionID, sess)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"sessionId":  sessionID,
		"readToken":  readToken,
		"writeToken": writeToken,
		"expiresAt":  expiresAt,
		"ttlSeconds": ttlSeconds,
	})
}

func handleSendSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	
	r.Body = http.MaxBytesReader(w, r.Body, int64(maxPayloadBytes) + 4096) // allow slightly more for struct

	var reqBody struct {
		SessionID  string      `json:"sessionId"`
		WriteToken string      `json:"writeToken"`
		Payload    interface{} `json:"payload"`
	}

	if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
		if strings.Contains(err.Error(), "http: request body too large") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			w.Write([]byte(fmt.Sprintf(`{"error":"Payload too large (max %d bytes)."}`, maxPayloadBytes)))
			return
		}
		// If other errors, maybe bad json, we can proceed with empty fields and catch them below
	}

	sessionID := strings.TrimSpace(reqBody.SessionID)
	writeToken := strings.TrimSpace(reqBody.WriteToken)

	if sessionID == "" || writeToken == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"sessionId and writeToken are required."}`))
		return
	}

	sess, status, errMsg := getSession(sessionID)
	if sess == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]string{"error": errMsg})
		return
	}

	if writeToken != sess.WriteToken {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"Invalid write token."}`))
		return
	}

	payloadBytes, err := json.Marshal(reqBody.Payload)
	if err != nil || len(payloadBytes) > maxPayloadBytes {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		w.Write([]byte(fmt.Sprintf(`{"error":"Payload too large (max %d bytes)."}`, maxPayloadBytes)))
		return
	}

	sess.Lock()
	sess.Queue = append(sess.Queue, Message{
		ID:        randomToken(9),
		CreatedAt: nowMs(),
		Payload:   reqBody.Payload,
	})

	for len(sess.Queue) > maxQueueMessages {
		sess.Queue = sess.Queue[1:]
	}
	sess.Unlock()

	// Important: sync.Map stores pointers here. We don't strictly need to re-store it, 
	// but keeping the logic clean.
	updateSession(sessionID, sess)  

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":      true,
		"queued":  len(sess.Queue),
	})
}

func handleReceiveSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	query := r.URL.Query()
	sessionID := strings.TrimSpace(query.Get("sid"))
	readToken := strings.TrimSpace(query.Get("rt"))

	limit := 20
	if rawLimit := query.Get("limit"); rawLimit != "" {
		if parsedLimit, err := strconv.Atoi(rawLimit); err == nil {
			if parsedLimit < 1 {
				parsedLimit = 1
			} else if parsedLimit > 20 {
				parsedLimit = 20
			}
			limit = parsedLimit
		}
	}

	if sessionID == "" || readToken == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"sid and rt are required."}`))
		return
	}

	sess, status, errMsg := getSession(sessionID)
	if sess == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]string{"error": errMsg})
		return
	}

	if readToken != sess.ReadToken {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"Invalid read token."}`))
		return
	}

	// splice equivalent
	sess.Lock()
	take := limit
	if take > len(sess.Queue) {
		take = len(sess.Queue)
	}

	messages := sess.Queue[:take]
	sess.Queue = sess.Queue[take:]
	sess.Unlock()

	updateSession(sessionID, sess)

	// Since Go json.Encoder might encode a nil slice as null, but JS expects [], let's force an empty slice
	if messages == nil {
		messages = make([]Message, 0)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"messages": messages,
	})
}

func main() {
	var staticRoot string
	flag.StringVar(&staticRoot, "static", ".", "Path to static files")
	flag.Parse()

	// Ensure static root is absolute or relative to pwd
	absStaticRoot, err := filepath.Abs(staticRoot)
	if err != nil {
		log.Fatal(err)
	}

	go cleanupExpiredSessions()

	mux := http.NewServeMux()

	mux.HandleFunc("/api/relay/session/create", corsMiddleware(handleCreateSession))
	mux.HandleFunc("/api/relay/session/send", corsMiddleware(handleSendSession))
	mux.HandleFunc("/api/relay/session/receive", corsMiddleware(handleReceiveSession))

	fs := http.FileServer(http.Dir(absStaticRoot))
	
	// Try to match exact file, and fallback to index.html for unknown routes if it's SPA
	// since express app.use(express.static) serves files, and the following app.get('/') and app.use() handle 404s/index
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(absStaticRoot, r.URL.Path)
		fileInfo, err := os.Stat(path)

		if os.IsNotExist(err) || fileInfo.IsDir() {
			// If asking for root / -> go to index.html
			if r.URL.Path == "/" {
				http.ServeFile(w, r, filepath.Join(absStaticRoot, "index.html"))
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte(`{"error":"Not found."}`))
			return
		}
		
		fs.ServeHTTP(w, r)
	})

	fmt.Printf("[relay] listening on :%d\n", port)
	fmt.Printf("[relay] allowed origins: %s\n", strings.Join(allowedOrigins, ", "))

	log.Fatal(http.ListenAndServe(fmt.Sprintf(":%d", port), mux))
}
