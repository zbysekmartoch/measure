// Sync Agent — bidirectional file synchronization client for Measure platform.
//
// Reads sync.json from the current directory, connects to the Measure backend,
// and continuously synchronises local files with the server.
//
// Rules:
//   - Only files that exist on the server are synchronised.
//   - Deleting / creating files can only be done on the server (via the web UI).
//   - When a server file is missing locally it is downloaded automatically.
//   - When both copies differ, the newer one (by mtime) wins.
//
// Works on Windows 10+ and Linux (Ubuntu).
// Build: go build -ldflags "-s -w" -o syncagent.exe .

package main

import (
	"bytes"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

// ── configuration (read from sync.json) ─────────────────────────────────────

type SyncConfig struct {
	Server        string `json:"server"`
	LabID         string `json:"labId"`
	Folder        string `json:"folder"`
	Token         string `json:"token"`
	SyncInterval  int    `json:"syncInterval"` // seconds, default 3
	SkipTLSVerify bool   `json:"skipTlsVerify"`
	Created       string `json:"created"`
}

// ── server manifest types ───────────────────────────────────────────────────

type ServerFile struct {
	Path  string `json:"path"`
	Size  int64  `json:"size"`
	Mtime string `json:"mtime"` // ISO 8601
	Hash  string `json:"hash"`  // SHA-256 hex
}

type ManifestResponse struct {
	Files      []ServerFile `json:"files"`
	ServerTime string       `json:"serverTime"`
}

// ── main ────────────────────────────────────────────────────────────────────

func main() {
	fmt.Println("╔══════════════════════════════════════════╗")
	fmt.Println("║       Measure Sync Agent v1.0            ║")
	fmt.Printf("║       OS: %-10s ARCH: %-14s ║\n", runtime.GOOS, runtime.GOARCH)
	fmt.Println("╚══════════════════════════════════════════╝")
	fmt.Println()

	cfg, err := loadConfig("sync.json")
	if err != nil {
		fmt.Printf("[ERROR] %v\n", err)
		fmt.Println("Place sync.json next to this executable and try again.")
		waitForEnter()
		os.Exit(1)
	}

	if cfg.Server == "" {
		fmt.Println("[ERROR] server URL is empty in sync.json")
		fmt.Println("Edit sync.json and fill in the \"server\" field, e.g.:")
		fmt.Println("  \"server\": \"https://measure.example.com\"")
		waitForEnter()
		os.Exit(1)
	}

	interval := cfg.SyncInterval
	if interval < 1 {
		interval = 3
	}

	// Strip trailing slash from server URL
	cfg.Server = strings.TrimRight(cfg.Server, "/")

	fmt.Printf("  Server:   %s\n", cfg.Server)
	fmt.Printf("  Lab ID:   %s\n", cfg.LabID)
	fmt.Printf("  Folder:   %s\n", folderDisplay(cfg.Folder))
	fmt.Printf("  Interval: %ds\n", interval)
	fmt.Println()

	// Configure HTTP client
	client := &http.Client{Timeout: 60 * time.Second}
	if cfg.SkipTLSVerify {
		client.Transport = &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec — user-opted
		}
		fmt.Println("  [WARN] TLS certificate verification is disabled")
	}

	// Verify connectivity
	fmt.Print("  Connecting... ")
	if err := checkHealth(client, cfg.Server); err != nil {
		fmt.Printf("FAILED\n  %v\n", err)
		waitForEnter()
		os.Exit(1)
	}
	fmt.Println("OK")
	fmt.Println()

	// Graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	fmt.Printf("  Syncing every %d seconds. Press Ctrl+C to stop.\n", interval)
	fmt.Println(strings.Repeat("─", 50))

	// Initial sync
	syncOnce(client, cfg)

	ticker := time.NewTicker(time.Duration(interval) * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			syncOnce(client, cfg)
		case <-stop:
			fmt.Println("\n  Stopped by user. Bye!")
			return
		}
	}
}

// ── sync logic ──────────────────────────────────────────────────────────────

func syncOnce(client *http.Client, cfg SyncConfig) {
	manifest, err := getManifest(client, cfg)
	if err != nil {
		fmt.Printf("[%s] ERROR getting manifest: %v\n", ts(), err)
		return
	}

	downloaded, uploaded, skipped, errors := 0, 0, 0, 0

	for _, sf := range manifest.Files {
		localPath := filepath.FromSlash(sf.Path)

		localStat, err := os.Stat(localPath)
		if os.IsNotExist(err) {
			// New file — download from server
			if err := downloadFile(client, cfg, sf.Path, localPath); err != nil {
				fmt.Printf("[%s]  x DOWNLOAD FAILED %s: %v\n", ts(), sf.Path, err)
				errors++
			} else {
				fmt.Printf("[%s]  ↓ %s (new)\n", ts(), sf.Path)
				downloaded++
			}
			continue
		}
		if err != nil {
			fmt.Printf("[%s]  x STAT ERROR %s: %v\n", ts(), sf.Path, err)
			errors++
			continue
		}

		// File exists locally — compare content hash
		localHash, err := fileHash(localPath)
		if err != nil {
			fmt.Printf("[%s]  x HASH ERROR %s: %v\n", ts(), sf.Path, err)
			errors++
			continue
		}

		if localHash == sf.Hash {
			skipped++
			continue
		}

		// Content differs — use mtime to decide direction
		serverMtime, _ := time.Parse(time.RFC3339Nano, sf.Mtime)
		localMtime := localStat.ModTime()

		if localMtime.After(serverMtime.Add(1 * time.Second)) {
			// Local is newer → upload
			if err := uploadFile(client, cfg, sf.Path, localPath); err != nil {
				fmt.Printf("[%s]  x UPLOAD FAILED %s: %v\n", ts(), sf.Path, err)
				errors++
			} else {
				fmt.Printf("[%s]  ↑ %s (local newer)\n", ts(), sf.Path)
				uploaded++
			}
		} else if serverMtime.After(localMtime.Add(1 * time.Second)) {
			// Server is newer → download
			if err := downloadFile(client, cfg, sf.Path, localPath); err != nil {
				fmt.Printf("[%s]  x DOWNLOAD FAILED %s: %v\n", ts(), sf.Path, err)
				errors++
			} else {
				fmt.Printf("[%s]  ↓ %s (server newer)\n", ts(), sf.Path)
				downloaded++
			}
		} else {
			// Within 1 second — treat as same, skip
			skipped++
		}
	}

	if downloaded > 0 || uploaded > 0 || errors > 0 {
		fmt.Printf("[%s]  ── ↓%d  ↑%d  =%d  x%d\n", ts(), downloaded, uploaded, skipped, errors)
	}
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

func checkHealth(client *http.Client, server string) error {
	resp, err := client.Get(server + "/api/health")
	if err != nil {
		return fmt.Errorf("cannot reach server: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("health check returned %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

func getManifest(client *http.Client, cfg SyncConfig) (*ManifestResponse, error) {
	u := fmt.Sprintf("%s/api/v1/labs/%s/sync/manifest?folder=%s",
		cfg.Server,
		url.PathEscape(cfg.LabID),
		url.QueryEscape(cfg.Folder))

	req, err := http.NewRequest("GET", u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Token)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("server returned %d: %s", resp.StatusCode, truncate(string(body), 200))
	}

	var m ManifestResponse
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		return nil, fmt.Errorf("invalid manifest JSON: %w", err)
	}
	return &m, nil
}

func downloadFile(client *http.Client, cfg SyncConfig, relativePath, localPath string) error {
	u := fmt.Sprintf("%s/api/v1/labs/%s/sync/download?folder=%s&file=%s",
		cfg.Server,
		url.PathEscape(cfg.LabID),
		url.QueryEscape(cfg.Folder),
		url.QueryEscape(relativePath))

	req, err := http.NewRequest("GET", u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Token)

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncate(string(body), 200))
	}

	// Ensure parent directories exist
	if dir := filepath.Dir(localPath); dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return err
		}
	}

	f, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = io.Copy(f, resp.Body)
	return err
}

func uploadFile(client *http.Client, cfg SyncConfig, relativePath, localPath string) error {
	f, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer f.Close()

	var body bytes.Buffer
	w := multipart.NewWriter(&body)

	if err := w.WriteField("relativePath", relativePath); err != nil {
		return err
	}

	fw, err := w.CreateFormFile("file", filepath.Base(localPath))
	if err != nil {
		return err
	}

	if _, err := io.Copy(fw, f); err != nil {
		return err
	}
	w.Close()

	u := fmt.Sprintf("%s/api/v1/labs/%s/sync/upload?folder=%s",
		cfg.Server,
		url.PathEscape(cfg.LabID),
		url.QueryEscape(cfg.Folder))

	req, err := http.NewRequest("POST", u, &body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Token)
	req.Header.Set("Content-Type", w.FormDataContentType())

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncate(string(respBody), 200))
	}

	return nil
}

// ── utilities ───────────────────────────────────────────────────────────────

func loadConfig(path string) (SyncConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return SyncConfig{}, fmt.Errorf("cannot read %s: %w", path, err)
	}
	var cfg SyncConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return SyncConfig{}, fmt.Errorf("cannot parse %s: %w", path, err)
	}
	return cfg, nil
}

func fileHash(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func ts() string {
	return time.Now().Format("15:04:05")
}

func folderDisplay(f string) string {
	if f == "" {
		return "(scripts root)"
	}
	return f
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

// waitForEnter keeps the console window open on Windows so the user can read
// the error before the window closes.
func waitForEnter() {
	if runtime.GOOS == "windows" {
		fmt.Println("\nPress Enter to exit...")
		fmt.Scanln()
	}
}
