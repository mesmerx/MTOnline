package main

import "database/sql"

const defaultUIConfig = `
{
  "top menu": {
    "card": [
      {
        "text": "Card",
        "submenu": [
          { "text": "Tap", "command": "tap" },
          { "text": "Transform", "command": "flip" },
          { "text": "Change print", "command": "changePrint" },
          { "text": "Create copy", "command": "createCopy" },
          { "text": "Set commander", "command": "setCommander" },
          { "text": "Send to commander zone", "command": "sendCommander" },
          { "text": "Remove", "command": "remove" }
        ]
      },
      {
        "text": "Move",
        "submenu": [
          { "text": "Battlefield", "command": "moveZone:battlefield" },
          { "text": "Hand", "command": "moveZone:hand" },
          { "text": "Cemetery", "command": "moveZone:cemetery" },
          { "text": "Exile", "command": "moveZone:exile" },
          { "text": "Commander", "command": "moveZone:commander" },
          { "text": "Tokens", "command": "moveZone:tokens" }
        ]
      },
      {
        "text": "Library",
        "submenu": [
          { "text": "Move to top", "command": "libraryPlace:top" },
          { "text": "Move to random", "command": "libraryPlace:random" },
          { "text": "Move to bottom", "command": "libraryPlace:bottom" },
          { "text": "Draw", "command": "draw" },
          { "text": "Shuffle", "command": "shuffle" },
          { "text": "Mulligan", "command": "mulligan" },
          {
            "text": "Cascade",
            "submenu": [
              { "text": "Show each card", "command": "cascadeShow" },
              { "text": "Fast reveal", "command": "cascadeFast" }
            ]
          }
        ]
      }
    ],
    "library": [
      { "text": "Draw", "command": "draw" },
      { "text": "Shuffle", "command": "shuffle" },
      { "text": "Mulligan", "command": "mulligan" },
      {
        "text": "Cascade",
        "submenu": [
          { "text": "Show each card", "command": "cascadeShow" },
          { "text": "Fast reveal", "command": "cascadeFast" }
        ]
      }
    ]
  },
  "aliases": {
    "select": "select",
    "tap": "tap",
    "flip": "flip",
    "changePrint": "changePrint",
    "createCopy": "createCopy",
    "setCommander": "setCommander",
    "sendCommander": "sendCommander",
    "remove": "remove",
    "draw": "draw",
    "shuffle": "shuffle",
    "mulligan": "mulligan",
    "cascadeShow": "cascadeShow",
    "cascadeFast": "cascadeFast",
    "playFromHand": "playFromHand",
    "moveToBattlefield": "moveToBattlefield",
    "openContextMenu": "openContextMenu",
    "openBoardMenu": "openBoardMenu",
    "moveZone": "moveZone",
    "libraryPlace": "libraryPlace"
  },
  "entities": {
    "battlefield": {
      "selectable": true,
      "showSelection": true,
      "actions": {
        "leftClick": ["select"],
        "rightClick": ["openContextMenu"],
        "doubleClick": ["tap"]
      }
    },
    "hand": {
      "selectable": true,
      "showSelection": true,
      "actions": {
        "leftClick": ["select"],
        "rightClick": ["openContextMenu"],
        "doubleClick": ["playFromHand"]
      }
    },
    "library": {
      "selectable": true,
      "showSelection": true,
      "actions": {
        "leftClick": ["select"],
        "rightClick": ["openContextMenu"],
        "doubleClick": ["draw"]
      }
    },
    "cemetery": {
      "selectable": true,
      "showSelection": true,
      "actions": {
        "leftClick": ["select"],
        "rightClick": ["openContextMenu"],
        "doubleClick": ["moveToBattlefield"]
      }
    },
    "exile": {
      "selectable": true,
      "showSelection": true,
      "actions": {
        "leftClick": ["select"],
        "rightClick": ["openContextMenu"],
        "doubleClick": ["moveToBattlefield"]
      }
    },
    "commander": {
      "selectable": true,
      "showSelection": true,
      "actions": {
        "leftClick": ["select"],
        "rightClick": ["openContextMenu"]
      }
    },
    "tokens": {
      "selectable": true,
      "showSelection": true,
      "actions": {
        "leftClick": ["select"],
        "rightClick": ["openContextMenu"]
      }
    }
  }
}
`

func ensureUIConfig(db *sql.DB) error {
	if db == nil {
		return nil
	}
	_, err := db.Exec(`
		INSERT INTO ui_configs (name, payload)
		VALUES ('default', ?)
		ON CONFLICT(name) DO NOTHING
	`, defaultUIConfig)
	return err
}




