package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
)

const cardsImportBatchLog = 50000

type scryfallFace struct {
	OracleText string            `json:"oracle_text"`
	ImageUris  map[string]string `json:"image_uris"`
}

type scryfallCard struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	Set             string            `json:"set"`
	SetName         string            `json:"set_name"`
	CollectorNumber string            `json:"collector_number"`
	TypeLine        string            `json:"type_line"`
	ManaCost        string            `json:"mana_cost"`
	OracleText      string            `json:"oracle_text"`
	Layout          string            `json:"layout"`
	PrintsSearchURI string            `json:"prints_search_uri"`
	ImageUris       map[string]string `json:"image_uris"`
	CardFaces       []scryfallFace    `json:"card_faces"`
}

func ensureCardsLoaded(db *sql.DB) error {
	var exists int
	row := db.QueryRow(`SELECT 1 FROM cards LIMIT 1`)
	if err := row.Scan(&exists); err == nil {
		return nil
	}

	path, err := resolveCardsJSONPath()
	if err != nil {
		return err
	}
	log.Printf("[cards] loading from %s", path)
	return loadCardsFromJSON(db, path)
}

func resolveCardsJSONPath() (string, error) {
	if env := strings.TrimSpace(os.Getenv("CARDS_JSON_PATH")); env != "" {
		if fileExists(env) {
			return env, nil
		}
		return "", fmt.Errorf("CARDS_JSON_PATH not found: %s", env)
	}
	backendDir := rootDir()
	candidates := []string{
		filepath.Join(backendDir, "..", "data", "cards.json"),
		filepath.Join(backendDir, "data", "cards.json"),
	}
	for _, candidate := range candidates {
		if fileExists(candidate) {
			return candidate, nil
		}
	}
	return "", errors.New("cards.json not found (set CARDS_JSON_PATH or place it under ../data)")
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func loadCardsFromJSON(db *sql.DB, path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	decoder := json.NewDecoder(file)
	// Expect a top-level array
	tok, err := decoder.Token()
	if err != nil {
		return err
	}
	if delim, ok := tok.(json.Delim); !ok || delim != '[' {
		return errors.New("cards.json must be a top-level array")
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	if _, err = tx.Exec(`DELETE FROM cards`); err != nil {
		return err
	}

	stmt, err := tx.Prepare(`
		INSERT INTO cards (
			id, name, name_normalized, set_code, collector_number, type_line,
			mana_cost, oracle_text, image_url, back_image_url, set_name, layout, prints_search_uri
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			name_normalized = excluded.name_normalized,
			set_code = excluded.set_code,
			collector_number = excluded.collector_number,
			type_line = excluded.type_line,
			mana_cost = excluded.mana_cost,
			oracle_text = excluded.oracle_text,
			image_url = excluded.image_url,
			back_image_url = excluded.back_image_url,
			set_name = excluded.set_name,
			layout = excluded.layout,
			prints_search_uri = excluded.prints_search_uri
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	count := 0
	for decoder.More() {
		var card scryfallCard
		if err = decoder.Decode(&card); err != nil {
			if err == io.EOF {
				break
			}
			return err
		}
		if card.ID == "" || strings.TrimSpace(card.Name) == "" {
			continue
		}

		name := strings.TrimSpace(card.Name)
		nameNormalized := strings.ToLower(name)
		setCode := strings.ToLower(strings.TrimSpace(card.Set))
		if setCode == "" {
			setCode = ""
		}

		imageURL := pickImageURL(card)
		backImageURL := pickBackImageURL(card)
		oracleText := extractOracleText(card)

		if _, err = stmt.Exec(
			card.ID,
			name,
			nameNormalized,
			nullIfEmptyString(setCode),
			nullIfEmptyString(strings.TrimSpace(card.CollectorNumber)),
			nullIfEmptyString(strings.TrimSpace(card.TypeLine)),
			nullIfEmptyString(strings.TrimSpace(card.ManaCost)),
			nullIfEmptyString(oracleText),
			nullIfEmptyString(imageURL),
			nullIfEmptyString(backImageURL),
			nullIfEmptyString(strings.TrimSpace(card.SetName)),
			nullIfEmptyString(strings.TrimSpace(card.Layout)),
			nullIfEmptyString(strings.TrimSpace(card.PrintsSearchURI)),
		); err != nil {
			return err
		}
		count++
		if count%cardsImportBatchLog == 0 {
			log.Printf("[cards] imported %d...", count)
		}
	}

	if err = tx.Commit(); err != nil {
		return err
	}
	log.Printf("[cards] import complete (%d cards)", count)
	return nil
}

func nullIfEmptyString(value string) interface{} {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func hasTwoFaces(card scryfallCard) bool {
	if len(card.CardFaces) > 1 {
		return true
	}
	switch card.Layout {
	case "transform", "modal_dfc", "double_faced_token", "reversible_card":
		return true
	default:
		return false
	}
}

func buildScryfallImageURL(cardID string, face string) string {
	if cardID == "" {
		return ""
	}
	parts := strings.Split(cardID, "-")
	if len(parts) == 0 {
		return ""
	}
	first := parts[0]
	if len(first) < 2 {
		return ""
	}
	return fmt.Sprintf("https://cards.scryfall.io/large/%s/%c/%c/%s.jpg", face, first[0], first[1], cardID)
}

func pickImageURL(card scryfallCard) string {
	if card.ImageUris != nil {
		if url := pickBestImage(card.ImageUris); url != "" {
			return url
		}
	}
	if hasTwoFaces(card) && len(card.CardFaces) > 0 {
		if url := pickBestImage(card.CardFaces[0].ImageUris); url != "" {
			return url
		}
		if card.ID != "" {
			return buildScryfallImageURL(card.ID, "front")
		}
	}
	if card.ID != "" {
		return buildScryfallImageURL(card.ID, "front")
	}
	return ""
}

func pickBackImageURL(card scryfallCard) string {
	if hasTwoFaces(card) && len(card.CardFaces) > 1 {
		if url := pickBestImage(card.CardFaces[1].ImageUris); url != "" {
			return url
		}
		if card.ID != "" {
			return buildScryfallImageURL(card.ID, "back")
		}
	}
	return ""
}

func pickBestImage(uris map[string]string) string {
	if uris == nil {
		return ""
	}
	for _, key := range []string{"normal", "large", "small"} {
		if url := strings.TrimSpace(uris[key]); url != "" {
			return url
		}
	}
	return ""
}

func extractOracleText(card scryfallCard) string {
	if strings.TrimSpace(card.OracleText) != "" {
		return card.OracleText
	}
	if len(card.CardFaces) == 0 {
		return ""
	}
	var parts []string
	for _, face := range card.CardFaces {
		if strings.TrimSpace(face.OracleText) != "" {
			parts = append(parts, strings.TrimSpace(face.OracleText))
		}
	}
	return strings.Join(parts, "\n---\n")
}
