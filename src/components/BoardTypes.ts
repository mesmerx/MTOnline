import type { RefObject } from 'react';
import type { CardOnBoard, PlayerSummary } from '../store/useGameStore';
import type { Point } from '../store/useGameStore';

export interface BoardViewProps {
  boardRef: RefObject<HTMLDivElement>;
  board: CardOnBoard[];
  allPlayers: PlayerSummary[];
  playerId: string;
  battlefieldCards: CardOnBoard[];
  libraryCards: CardOnBoard[];
  cemeteryCards: CardOnBoard[];
  storeLibraryPositions: Record<string, Point>;
  storeCemeteryPositions: Record<string, Point>;
  showHand: boolean;
  dragStateRef: RefObject<{ cardId: string; offsetX: number; offsetY: number; startX: number; startY: number; hasMoved: boolean } | null>;
  draggingLibrary: { playerId: string; offsetX: number; offsetY: number; startX: number; startY: number } | null;
  draggingCemetery: { playerId: string; offsetX: number; offsetY: number; startX: number; startY: number } | null;
  ownerName: (card: CardOnBoard) => string;
  handleCardClick: (card: CardOnBoard, event: React.MouseEvent) => void;
  handleCardContextMenu: (card: CardOnBoard, event: React.MouseEvent) => void;
  handleCardZoom: (card: CardOnBoard, event: React.PointerEvent) => void;
  startDrag: (card: CardOnBoard, event: React.PointerEvent) => void;
  zoomedCard: string | null;
  setZoomedCard: (cardId: string | null) => void;
  startLibraryDrag: (targetPlayerId: string, event: React.PointerEvent) => void;
  startCemeteryDrag: (targetPlayerId: string, event: React.PointerEvent) => void;
  changeCardZone: (cardId: string, newZone: 'battlefield' | 'hand' | 'library' | 'cemetery', position?: Point) => void;
  detectZoneAtPosition: (x: number, y: number) => { zone: 'battlefield' | 'hand' | 'library' | 'cemetery' | null; ownerId?: string };
  reorderHandCard: (cardId: string, newIndex: number) => void;
  dragStartedFromHandRef: RefObject<boolean>;
  handCardPlacedRef: RefObject<boolean>;
  setContextMenu: (menu: { x: number; y: number; card: CardOnBoard } | null) => void;
  setLastTouchedCard: (card: CardOnBoard | null) => void;
  getPlayerArea: (ownerId: string) => { x: number; y: number; width: number; height: number } | null;
  getLibraryPosition: (playerId: string) => Point | null;
  getCemeteryPosition: (playerId: string) => Point | null;
  handDragStateRef: RefObject<{
    draggingHandCard: string | null;
    handCardMoved: boolean;
    previewHandOrder: number | null;
    dragPosition: Point | null;
    dragStartPosition: Point | null;
  }>;
  addEventLog: (type: string, message: string, cardId?: string, cardName?: string, details?: Record<string, unknown>) => void;
  viewMode: 'unified' | 'individual' | 'separated';
  convertMouseToSeparatedCoordinates?: (mouseX: number, mouseY: number, playerId: string, rect: DOMRect) => { x: number; y: number } | null;
  convertMouseToUnifiedCoordinates?: (mouseX: number, mouseY: number, rect: DOMRect) => { x: number; y: number };
}

export const BASE_BOARD_WIDTH = 1920;
export const BASE_BOARD_HEIGHT = 1080;
export const CARD_WIDTH = 150;
export const CARD_HEIGHT = 210;

